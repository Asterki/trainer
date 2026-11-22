/**
 * Mirrors local domain mutations into the sync outbox.
 *
 * The recorder is installed by the sync engine and stays dormant while sync is
 * off, so local-only users never accumulate outbox rows.
 */

import {
  clearOutboxForEntity,
  putOutbox,
  putVersion,
  setMutationListener,
  writeSyncState,
  type MutationEvent,
  type SyncEntityKind,
} from '../db/database';
import {
  normalizeCustomExercise,
  normalizeRoutine,
  normalizeSession,
  normalizeSettings,
} from '../db/normalize';
import type { Settings } from '../domain/types';
import type { HlcClock } from './hlc';
import type { SyncConfig } from './types';

let config: SyncConfig | null = null;
let clock: HlcClock | null = null;
let chain: Promise<void> = Promise.resolve();

export function configureRecorder(nextConfig: SyncConfig | null, nextClock: HlcClock | null): void {
  config = nextConfig;
  clock = nextClock;
  setMutationListener(nextConfig ? recordMutation : null);
}

export function entityPayload(kind: SyncEntityKind, value: unknown): unknown {
  if (kind === 'routine') return normalizeRoutine(value);
  if (kind === 'session') return normalizeSession(value);
  if (kind === 'exercise') return normalizeCustomExercise(value);
  return normalizeSettings(value as Partial<Settings>);
}

async function persist(event: MutationEvent, hlc: string, active: SyncConfig): Promise<void> {
  for (const id of event.deletes) {
    const entityId = event.kind === 'settings' ? 'app' : id;
    await clearOutboxForEntity(event.kind, entityId);
    await putOutbox({
      changeId: crypto.randomUUID(),
      entityType: event.kind,
      entityId,
      hlc,
      deleted: true,
      payload: null,
    });
    await putVersion({ entityType: event.kind, entityId, hlc, deleted: true });
  }

  for (const value of event.puts) {
    const record = value as { id?: string };
    const entityId = event.kind === 'settings' ? 'app' : record.id;
    if (!entityId) continue;

    await clearOutboxForEntity(event.kind, entityId);
    await putOutbox({
      changeId: crypto.randomUUID(),
      entityType: event.kind,
      entityId,
      hlc,
      deleted: false,
      payload: entityPayload(event.kind, value),
    });
    await putVersion({ entityType: event.kind, entityId, hlc, deleted: false });
  }

  active.lastHlc = hlc;
  await writeSyncState('app', active);
}

/** Registered with the database layer; writes are serialized per mutation. */
export function recordMutation(event: MutationEvent): void {
  if (!config || !clock || !config.enabled) return;

  const active = config;
  const hlc = clock.next();

  chain = chain
    .then(() => persist(event, hlc, active))
    .catch((error) => console.error('Could not record sync change', error));
}
