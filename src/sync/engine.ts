/**
 * The sync engine: connect, poll, push, pull and merge.
 *
 * Everything here is optional. With no saved config the engine does nothing and
 * the app stays purely local. When connected, domain writes are recorded by
 * `recorder.ts`, and this module moves them to the relay in the background.
 */

import {
  clearOutboxForEntity,
  clearSyncStores,
  deleteEntitySilently,
  getVersion,
  listOutbox,
  loadSnapshot,
  putOutbox,
  putVersion,
  readEntity,
  readSyncState,
  removeOutbox,
  writeEntitySilently,
  writeSyncState,
  type OutboxRecord,
  type SyncEntityKind,
} from '../db/database';
import {
  normalizeCustomExercise,
  normalizeRoutine,
  normalizeSession,
  normalizeSettings,
} from '../db/normalize';
import type { Routine, Session, Settings } from '../domain/types';
import { decryptPayload, deriveKeys, encryptPayload } from './crypto';
import { compareHlc, epochHlc, HlcClock } from './hlc';
import { configureRecorder, entityPayload } from './recorder';
import {
  NewSyncSpaceError,
  type ChangesPage,
  type RemoteChange,
  type RemoteEntity,
  type SnapshotPage,
  type SyncConfig,
  type SyncInfo,
  type SyncStatus,
} from './types';

const ENTITY_KINDS: SyncEntityKind[] = ['routine', 'session', 'exercise', 'settings'];
const BATCH = 200;
const POLL_MS = 20_000;
const TIMEOUT_MS = 20_000;

const idleStatus: SyncStatus = {
  configured: false,
  state: 'off',
  pending: 0,
  lastSyncAt: 0,
  error: null,
};

let status: SyncStatus = { ...idleStatus };
let runtime: { config: SyncConfig; clock: HlcClock } | null = null;
let applyHandler: (() => void) | null = null;
let syncPromise: Promise<void> | null = null;
let pollTimer: number | null = null;
let bound = false;
let failures = 0;
let retryAt = 0;

const listeners = new Set<(status: SyncStatus) => void>();

/* ── Status ───────────────────────────────────────────────────────────────── */

function publish(patch: Partial<SyncStatus>): void {
  status = { ...status, ...patch };
  for (const listener of listeners) listener({ ...status });
}

export function getSyncStatus(): SyncStatus {
  return { ...status };
}

export function subscribeSync(listener: (status: SyncStatus) => void): () => void {
  listeners.add(listener);
  listener({ ...status });
  return () => {
    listeners.delete(listener);
  };
}

export function registerApplyHandler(handler: (() => void) | null): void {
  applyHandler = handler;
}

export async function getSyncInfo(): Promise<SyncInfo | null> {
  const config = await readSyncState<SyncConfig>('app');
  if (!config?.enabled) return null;
  return {
    serverUrl: config.serverUrl,
    fingerprint: config.fingerprint,
    deviceName: config.deviceName ?? 'Trainer device',
    lastSyncAt: config.lastSyncAt,
  };
}

async function pendingCount(): Promise<number> {
  return (await listOutbox()).length;
}

/* ── HTTP ─────────────────────────────────────────────────────────────────── */

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = 'HttpError';
  }
}

async function request<T>(
  serverUrl: string,
  authKey: string,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), TIMEOUT_MS);
  const headers = new Headers(init.headers);
  headers.set('authorization', `Bearer ${authKey}`);
  if (init.body) headers.set('content-type', 'application/json');

  try {
    const response = await fetch(`${serverUrl}${path}`, {
      ...init,
      signal: controller.signal,
      headers,
    });
    const text = await response.text();
    if (!response.ok) {
      let detail = text;
      try {
        detail = (JSON.parse(text) as { error?: string }).error ?? text;
      } catch {
        /* keep the raw body */
      }
      throw new HttpError(response.status, detail || `Request failed (${response.status})`);
    }
    return (text ? JSON.parse(text) : {}) as T;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('Sync server timed out.');
    }
    throw new Error('Could not reach the sync server.');
  } finally {
    window.clearTimeout(timer);
  }
}

/* ── Connect / disconnect ─────────────────────────────────────────────────── */

export async function connectSync(
  rawUrl: string,
  passphrase: string,
  allowCreate: boolean,
  deviceName = 'Trainer device',
): Promise<{ created: boolean }> {
  const serverUrl = rawUrl.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(serverUrl)) {
    throw new Error('Enter the full relay URL, starting with http:// or https://.');
  }
  if (passphrase.trim().length < 8) {
    throw new Error('Use a passphrase of at least 8 characters.');
  }

  const keys = await deriveKeys(passphrase.trim());
  const head = await request<{ exists: boolean; head: number }>(
    serverUrl,
    keys.authKey,
    '/v1/sync/head',
  );
  if (!head.exists && !allowCreate) throw new NewSyncSpaceError();

  if (runtime) await disconnectSync();
  stopLoop();

  const config: SyncConfig = {
    key: 'app',
    serverUrl,
    clientId: crypto.randomUUID(),
    authKey: keys.authKey,
    encKey: keys.encKey,
    fingerprint: keys.fingerprint,
    deviceName: deviceName.trim() || 'Trainer device',
    cursor: 0,
    enabled: true,
    lastSyncAt: 0,
    lastHlc: '',
  };

  await writeSyncState('app', config);
  runtime = { config, clock: new HlcClock(config.clientId, null) };
  configureRecorder(config, runtime.clock);
  publish({ configured: true, state: 'syncing', pending: 0, lastSyncAt: 0, error: null });

  try {
    // Joining an existing space: seed at the epoch so remote history wins.
    // Creating a space: seed with real timestamps so these rows are canonical.
    await seedLocal(config, head.exists ? () => epochHlc(config.clientId) : () => runtime!.clock.next());
    await writeSyncState('app', config);
    if (head.exists) await snapshotPull(config);
    await pushPending(config);
    await pullAll(config);
    config.lastSyncAt = Date.now();
    await writeSyncState('app', config);
    // The initial snapshot may have filled the local database before the
    // regular sync loop publishes a change callback.
    applyHandler?.();
    publish({
      state: 'idle',
      pending: await pendingCount(),
      lastSyncAt: config.lastSyncAt,
      error: null,
    });
    startLoop();
    return { created: !head.exists };
  } catch (error) {
    publish({
      state: 'error',
      error: error instanceof Error ? error.message : 'Could not start syncing.',
    });
    startLoop();
    throw error;
  }
}

export async function disconnectSync(): Promise<void> {
  stopLoop();
  configureRecorder(null, null);
  runtime = null;
  syncPromise = null;
  failures = 0;
  retryAt = 0;
  await clearSyncStores();
  publish({ ...idleStatus });
}

/**
 * Queues every local entity at the epoch HLC. The relay only accepts a change
 * when it is newer than what it already holds, so an old local copy can never
 * outrank a newer remote one.
 */
async function seedLocal(config: SyncConfig, nextHlc: () => string): Promise<void> {
  const snapshot = await loadSnapshot();
  const groups: Array<{ kind: SyncEntityKind; values: unknown[] }> = [
    { kind: 'routine', values: snapshot.routines },
    { kind: 'session', values: snapshot.sessions },
    { kind: 'exercise', values: snapshot.customExercises },
    { kind: 'settings', values: [snapshot.settings] },
  ];

  for (const group of groups) {
    for (const value of group.values) {
      const id = group.kind === 'settings' ? 'app' : (value as { id?: string }).id;
      if (!id) continue;
      if (await getVersion(group.kind, id)) continue;

      const hlc = nextHlc();
      const record: OutboxRecord = {
        changeId: crypto.randomUUID(),
        entityType: group.kind,
        entityId: id,
        hlc,
        deleted: false,
        payload: entityPayload(group.kind, value),
      };
      await putOutbox(record);
      await putVersion({ entityType: group.kind, entityId: id, hlc, deleted: false });
      config.lastHlc = hlc;
    }
  }
}

/* ── Loop ─────────────────────────────────────────────────────────────────── */

function wake(): void {
  if (typeof document !== 'undefined' && document.hidden) return;
  void syncNow();
}

function bindEvents(): void {
  if (bound) return;
  bound = true;
  window.addEventListener('online', wake);
  window.addEventListener('focus', wake);
  document.addEventListener('visibilitychange', wake);
}

function unbindEvents(): void {
  if (!bound) return;
  bound = false;
  window.removeEventListener('online', wake);
  window.removeEventListener('focus', wake);
  document.removeEventListener('visibilitychange', wake);
}

export function startLoop(): void {
  stopLoop();
  if (!runtime) return;
  bindEvents();
  pollTimer = window.setInterval(() => {
    if (document.hidden) return;
    void syncNow();
  }, POLL_MS);
}

export function stopLoop(): void {
  if (pollTimer !== null) {
    window.clearInterval(pollTimer);
    pollTimer = null;
  }
  unbindEvents();
}

export async function loadSyncRuntime(): Promise<void> {
  const config = await readSyncState<SyncConfig>('app');
  if (!config?.enabled) {
    publish({ ...idleStatus });
    return;
  }

  runtime = { config, clock: new HlcClock(config.clientId, config.lastHlc) };
  configureRecorder(config, runtime.clock);
  publish({
    configured: true,
    state: 'idle',
    pending: await pendingCount(),
    lastSyncAt: config.lastSyncAt,
    error: null,
  });
  startLoop();
  void syncNow();
}

export function syncNow(): Promise<void> {
  if (!runtime) return Promise.resolve();
  if (syncPromise) return syncPromise;
  if (Date.now() < retryAt) return Promise.resolve();
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    publish({ state: 'idle', error: 'Offline — changes are queued.' });
    return Promise.resolve();
  }

  syncPromise = withLock(async () => {
    if (!runtime) return;
    publish({ state: 'syncing', error: null });
    try {
      // Pull first so a terminal result can cancel a stale local plan before
      // that plan is pushed back to the relay.
      const changed = await pullAll(runtime.config);
      await pushPending(runtime.config);
      runtime.config.lastSyncAt = Date.now();
      await writeSyncState('app', runtime.config);
      failures = 0;
      retryAt = 0;
      publish({
        state: 'idle',
        pending: await pendingCount(),
        lastSyncAt: runtime.config.lastSyncAt,
        error: null,
      });
      if (changed) applyHandler?.();
    } catch (error) {
      failures += 1;
      retryAt = Date.now() + Math.min(300_000, 5_000 * 2 ** Math.min(failures - 1, 6));
      publish({
        state: 'error',
        error: error instanceof Error ? error.message : 'Sync failed.',
      });
    }
  }).finally(() => {
    syncPromise = null;
  });

  return syncPromise;
}

async function withLock(task: () => Promise<void>): Promise<void> {
  if (typeof navigator === 'undefined' || !('locks' in navigator)) {
    await task();
    return;
  }
  await navigator.locks.request('tasker-sync', { ifAvailable: true }, async (lock) => {
    if (!lock) return;
    await task();
  });
}

/* ── Push / pull ──────────────────────────────────────────────────────────── */

async function pushPending(config: SyncConfig): Promise<void> {
  for (let round = 0; round < 50; round += 1) {
    const pending = await listOutbox();
    if (pending.length === 0) return;
    const batch = pending.slice(0, BATCH);

    const changes = await Promise.all(
      batch.map(async (row) => ({
        changeId: row.changeId,
        entityType: row.entityType,
        entityId: row.entityId,
        hlc: row.hlc,
        deleted: row.deleted,
        payload: row.deleted ? '' : await encryptPayload(row.payload, config.encKey),
      })),
    );

    await request(config.serverUrl, config.authKey, '/v1/sync/push', {
      method: 'POST',
      body: JSON.stringify({ clientId: config.clientId, changes }),
    });
    await removeOutbox(batch.flatMap((row) => (row.seq === undefined ? [] : [row.seq])));
    if (pending.length <= BATCH) return;
  }
}

async function pullAll(config: SyncConfig): Promise<boolean> {
  let changed = false;
  try {
    for (;;) {
      const page = await request<ChangesPage>(
        config.serverUrl,
        config.authKey,
        `/v1/sync/changes?since=${config.cursor}&limit=${BATCH}`,
      );
      for (const change of page.changes) {
        if (await applyRemote(config, change)) changed = true;
      }
      config.cursor = Math.max(config.cursor, page.cursor);
      await writeSyncState('app', config);
      if (!page.hasMore) break;
    }
  } catch (error) {
    if (error instanceof HttpError && error.status === 410) {
      // The relay purged history past our cursor; start again from a snapshot.
      changed = await snapshotPull(config);
    } else {
      throw error;
    }
  }
  return changed;
}

async function snapshotPull(config: SyncConfig): Promise<boolean> {
  let changed = false;
  let afterType = '';
  let afterId = '';
  let head = config.cursor;

  for (;;) {
    const query = new URLSearchParams({ limit: String(BATCH) });
    if (afterType && afterId) {
      query.set('afterType', afterType);
      query.set('afterId', afterId);
    }
    const page = await request<SnapshotPage>(
      config.serverUrl,
      config.authKey,
      `/v1/sync/snapshot?${query.toString()}`,
    );
    head = page.head;

    for (const entity of page.entities) {
      if (await applyRemote(config, entity)) changed = true;
    }

    if (!page.next) break;
    afterType = page.next.type;
    afterId = page.next.id;
  }

  config.cursor = Math.max(config.cursor, head);
  await writeSyncState('app', config);
  return changed;
}

/* ── Merge ────────────────────────────────────────────────────────────────── */

async function applyRemote(
  config: SyncConfig,
  change: RemoteChange | RemoteEntity,
): Promise<boolean> {
  if (!ENTITY_KINDS.includes(change.entityType)) return false;
  runtime?.clock.observe(change.hlc);

  const stored = await getVersion(change.entityType, change.entityId);

  if (change.deleted) {
    if (stored && compareHlc(change.hlc, stored.hlc) <= 0) return false;
    await deleteEntitySilently(change.entityType, change.entityId);
    await putVersion({
      entityType: change.entityType,
      entityId: change.entityId,
      hlc: change.hlc,
      deleted: true,
    });
    return true;
  }

  let payload: unknown;
  try {
    payload = await decryptPayload<unknown>(change.payload, config.encKey);
  } catch {
    // A payload from a different passphrase can never decrypt; skip it rather
    // than blocking every later change behind a poison record.
    console.warn('Skipping a sync change that could not be decrypted.');
    return false;
  }

  const newer = !stored || compareHlc(change.hlc, stored.hlc) > 0;

  if (change.entityType === 'session') {
    const local = await readEntity<Session>('session', change.entityId);
    const remote = normalizeSession({ ...(payload as Session), id: change.entityId });
    const localDone = local?.status === 'completed' || local?.status === 'skipped';
    const remoteDone = remote.status === 'completed' || remote.status === 'skipped';

    // A finished workout beats any late plan, even a plan with a newer HLC.
    if (localDone && !remoteDone) {
      await enqueueEntity('session', change.entityId, local);
      return true;
    }
    // A terminal result from another device is authoritative over a local
    // plan, even when that plan has a newer HLC. Two terminal records still
    // resolve by HLC.
    if (!remoteDone && !newer) return false;
    if (localDone && remoteDone && !newer) return false;

    // The remote terminal record wins; discard any queued local session edit
    // so a later push cannot downgrade the relay copy back to planned.
    if (remoteDone) await clearOutboxForEntity('session', change.entityId);
    await writeEntitySilently('session', remote);
    await putVersion({
      entityType: 'session',
      entityId: change.entityId,
      hlc: stored && compareHlc(stored.hlc, change.hlc) > 0 ? stored.hlc : change.hlc,
      deleted: false,
    });
    return true;
  }

  if (!newer) return false;
  await writeMerged(change.entityType, change.entityId, payload);
  // writeMerged may have published a newer local version (routine activation).
  const after = await getVersion(change.entityType, change.entityId);
  if (!after || compareHlc(change.hlc, after.hlc) > 0) {
    await putVersion({
      entityType: change.entityType,
      entityId: change.entityId,
      hlc: change.hlc,
      deleted: false,
    });
  }
  return true;
}

async function writeMerged(kind: SyncEntityKind, id: string, payload: unknown): Promise<void> {
  if (kind === 'settings') {
    await writeEntitySilently('settings', normalizeSettings(payload as Partial<Settings>));
    return;
  }

  if (kind === 'routine') {
    await writeEntitySilently('routine', normalizeRoutine({ ...(payload as Routine), id }));
    await enforceSingleActive();
    return;
  }

  if (kind === 'exercise') {
    await writeEntitySilently('exercise', normalizeCustomExercise({ ...(payload as object), id }));
    return;
  }

  if (kind === 'session') {
    await writeEntitySilently('session', normalizeSession({ ...(payload as Session), id }));
  }
}

async function enforceSingleActive(): Promise<void> {
  const snapshot = await loadSnapshot();
  const active = snapshot.routines
    .filter((routine) => routine.active)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id));
  for (const routine of active.slice(1)) {
    const next = { ...routine, active: false, updatedAt: new Date().toISOString() };
    await writeEntitySilently('routine', next);
    await enqueueEntity('routine', routine.id, next);
  }
}

async function enqueueEntity(kind: SyncEntityKind, id: string, value: unknown): Promise<void> {
  if (!runtime) return;
  const hlc = runtime.clock.next();
  await clearOutboxForEntity(kind, id);
  await putOutbox({
    changeId: crypto.randomUUID(),
    entityType: kind,
    entityId: kind === 'settings' ? 'app' : id,
    hlc,
    deleted: false,
    payload: entityPayload(kind, value),
  });
  await putVersion({ entityType: kind, entityId: kind === 'settings' ? 'app' : id, hlc, deleted: false });
  runtime.config.lastHlc = hlc;
  await writeSyncState('app', runtime.config);
}
