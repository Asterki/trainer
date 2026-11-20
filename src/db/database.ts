/**
 * IndexedDB persistence for Trainer.
 *
 * The `trainer` database is the only local store. The legacy `tasker`
 * database is never opened, migrated, cleared or deleted.
 */

import type { Routine, Session, Settings } from '../domain/types';
import { normalizeExerciseText } from '../domain/catalogue/wger';
import {
  normalizeCustomExercise,
  normalizeCustomExercises,
  normalizeRoutine,
  normalizeRoutines,
  normalizeSession,
  normalizeSessions,
  normalizeSettings,
} from './normalize';

const DB_NAME = 'trainer';
const DB_VERSION = 1;
const SETTINGS_KEY = 'app';

export const STORE = {
  routines: 'routines',
  sessions: 'sessions',
  exercises: 'exercises',
  settings: 'settings',
  outbox: 'outbox',
  versions: 'versions',
  syncState: 'sync_state',
} as const;

export type DomainEntityKind = 'routine' | 'session' | 'exercise' | 'settings';
export type SyncEntityKind = DomainEntityKind;

export interface DatabaseSnapshot {
  routines: Routine[];
  sessions: Session[];
  customExercises: ReturnType<typeof normalizeCustomExercise>[];
  settings: Settings;
}

export interface OutboxRecord {
  seq?: number;
  entityType: SyncEntityKind;
  entityId: string;
  hlc: string;
  deleted: boolean;
  payload: unknown;
}

export interface VersionRecord {
  entityType: SyncEntityKind;
  entityId: string;
  hlc: string;
  deleted: boolean;
}

let dbPromise: Promise<IDBDatabase> | null = null;
let persistenceRequested = false;

export function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export function openDatabase(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const open = indexedDB.open(DB_NAME, DB_VERSION);

    open.onupgradeneeded = () => {
      const database = open.result;

      if (!database.objectStoreNames.contains(STORE.routines)) {
        const routines = database.createObjectStore(STORE.routines, { keyPath: 'id' });
        // IndexedDB cannot index booleans, so routines store a 0/1 mirror.
        routines.createIndex('active', 'activeKey');
        routines.createIndex('updatedAt', 'updatedAt');
      }
      if (!database.objectStoreNames.contains(STORE.sessions)) {
        const sessions = database.createObjectStore(STORE.sessions, { keyPath: 'id' });
        sessions.createIndex('date', 'date');
        sessions.createIndex('status', 'status');
        sessions.createIndex('routineId', 'routineId');
        sessions.createIndex('dateStatus', ['date', 'status']);
      }
      if (!database.objectStoreNames.contains(STORE.exercises)) {
        const exercises = database.createObjectStore(STORE.exercises, { keyPath: 'id' });
        exercises.createIndex('nameNormalized', 'nameNormalized');
      }
      if (!database.objectStoreNames.contains(STORE.settings)) {
        database.createObjectStore(STORE.settings);
      }
      if (!database.objectStoreNames.contains(STORE.outbox)) {
        const outbox = database.createObjectStore(STORE.outbox, {
          keyPath: 'seq',
          autoIncrement: true,
        });
        outbox.createIndex('entity', ['entityType', 'entityId']);
      }
      if (!database.objectStoreNames.contains(STORE.versions)) {
        database.createObjectStore(STORE.versions, { keyPath: ['entityType', 'entityId'] });
      }
      if (!database.objectStoreNames.contains(STORE.syncState)) {
        database.createObjectStore(STORE.syncState, { keyPath: 'key' });
      }
    };

    open.onsuccess = () => {
      const database = open.result;
      database.onversionchange = () => {
        database.close();
        dbPromise = null;
      };
      resolve(database);
    };

    open.onerror = () => {
      dbPromise = null;
      reject(open.error);
    };

    open.onblocked = () => {
      dbPromise = null;
      reject(new Error('Trainer storage is open in another tab. Close it and try again.'));
    };
  });

  return dbPromise;
}

/** IndexedDB keys cannot be booleans; mirror `active` for the index only. */
function storedRoutine(routine: Routine): Routine & { activeKey: number } {
  return { ...routine, activeKey: routine.active ? 1 : 0 };
}

function storeForKind(kind: DomainEntityKind): string {
  if (kind === 'routine') return STORE.routines;
  if (kind === 'session') return STORE.sessions;
  if (kind === 'exercise') return STORE.exercises;
  return STORE.settings;
}

function normalizeEntity(kind: 'routine', value: unknown): Routine;
function normalizeEntity(kind: 'session', value: unknown): Session;
function normalizeEntity(kind: 'exercise', value: unknown): ReturnType<typeof normalizeCustomExercise>;
function normalizeEntity(kind: 'settings', value: unknown): Settings;
function normalizeEntity(kind: DomainEntityKind, value: unknown): Routine | Session | ReturnType<typeof normalizeCustomExercise> | Settings;
function normalizeEntity(
  kind: DomainEntityKind,
  value: unknown,
): Routine | Session | ReturnType<typeof normalizeCustomExercise> | Settings {
  if (kind === 'routine') return normalizeRoutine(value);
  if (kind === 'session') return normalizeSession(value);
  if (kind === 'exercise') return normalizeCustomExercise(value);
  return normalizeSettings(value);
}

async function persist(kind: DomainEntityKind, value: unknown): Promise<void> {
  const normalized = normalizeEntity(kind, value);
  let stored: unknown = normalized;
  if (kind === 'routine') {
    stored = storedRoutine(normalized as Routine);
  } else if (kind === 'exercise') {
    const exercise = normalized as ReturnType<typeof normalizeCustomExercise>;
    stored = { ...exercise, nameNormalized: normalizeExerciseText(exercise.name) };
  }
  const database = await openDatabase();
  const tx = database.transaction(storeForKind(kind), 'readwrite');
  tx.objectStore(storeForKind(kind)).put(
    stored as unknown as object,
    kind === 'settings' ? SETTINGS_KEY : undefined,
  );
  await transactionDone(tx);
}

/** Writes a complete routine list in one transaction. */
async function persistRoutines(routines: Routine[]): Promise<void> {
  const database = await openDatabase();
  const tx = database.transaction(STORE.routines, 'readwrite');
  const store = tx.objectStore(STORE.routines);
  for (const routine of routines) store.put(storedRoutine(routine));
  await transactionDone(tx);
}

export async function loadSnapshot(): Promise<DatabaseSnapshot> {
  const database = await openDatabase();
  const tx = database.transaction(
    [STORE.routines, STORE.sessions, STORE.exercises, STORE.settings],
    'readonly',
  );

  const [routines, sessions, exercises, settings] = await Promise.all([
    request(tx.objectStore(STORE.routines).getAll()),
    request(tx.objectStore(STORE.sessions).getAll()),
    request(tx.objectStore(STORE.exercises).getAll()),
    request(tx.objectStore(STORE.settings).get(SETTINGS_KEY)),
  ]);

  const normalizedRoutines = normalizeRoutines(routines);
  // Imported or synced data can arrive with two active routines. Repair the
  // stored rows immediately so the invariant survives the next reload too.
  if (routines.filter((row) => row && (row as Routine).active === true).length > 1) {
    await persistRoutines(normalizedRoutines);
  }

  return {
    routines: normalizedRoutines,
    sessions: normalizeSessions(sessions),
    customExercises: normalizeCustomExercises(exercises),
    settings: normalizeSettings(settings),
  };
}

export async function readEntity<T>(kind: DomainEntityKind, entityId: string): Promise<T | undefined> {
  const database = await openDatabase();
  const tx = database.transaction(storeForKind(kind), 'readonly');
  const key = kind === 'settings' ? SETTINGS_KEY : entityId;
  const row = await request(tx.objectStore(storeForKind(kind)).get(key));
  return row === undefined ? undefined : (normalizeEntity(kind, row) as T);
}

/** Normalized write used by domain actions. */
export async function writeEntity<T>(kind: DomainEntityKind, value: T): Promise<T> {
  await persist(kind, value);
  return normalizeEntity(kind, value) as T;
}

/** Applies remote data without echo. Stage 7 uses this after a merge. */
export async function writeEntitySilently(kind: DomainEntityKind, value: unknown): Promise<void> {
  await persist(kind, value);
}

/** Creates a session only if its calendar date has no existing session. */
export async function writeSessionNew(value: unknown): Promise<Session> {
  const database = await openDatabase();
  const tx = database.transaction(STORE.sessions, 'readwrite');
  const session = normalizeEntity('session', value);
  const sameDate = await request(tx.objectStore(STORE.sessions).index('date').getAll(session.date));
  if (sameDate.length > 0) {
    throw new Error('A session already exists for this date.');
  }
  tx.objectStore(STORE.sessions).put(session);
  await transactionDone(tx);
  return session;
}

/**
 * Persists a bootstrap plan. Updates are applied first; creates are guarded by
 * the date index so a concurrent tab can never produce two sessions per date.
 */
export async function applySessionBootstrap(
  creates: Session[],
  updates: Session[],
): Promise<Session[]> {
  const database = await openDatabase();
  const tx = database.transaction(STORE.sessions, 'readwrite');
  const store = tx.objectStore(STORE.sessions);
  const dateIndex = store.index('date');

  for (const update of updates) {
    const current = await request(store.get(update.id));
    if (current !== undefined) store.put(normalizeEntity('session', update));
  }

  for (const create of creates) {
    const session = normalizeEntity('session', create);
    const sameDate = await request(dateIndex.getAll(session.date));
    if (sameDate.length === 0) store.put(session);
  }

  await transactionDone(tx);

  const readTx = database.transaction(STORE.sessions, 'readonly');
  return normalizeSessions(await request(readTx.objectStore(STORE.sessions).getAll()));
}

export async function deleteEntity(kind: DomainEntityKind, entityId: string): Promise<void> {
  const database = await openDatabase();
  const tx = database.transaction(storeForKind(kind), 'readwrite');
  tx.objectStore(storeForKind(kind)).delete(kind === 'settings' ? SETTINGS_KEY : entityId);
  await transactionDone(tx);
}

/** Ensures the singleton settings row exists. Existing settings are untouched. */
export async function ensureSettings(initial?: Partial<Settings>): Promise<Settings> {
  const database = await openDatabase();
  const readTx = database.transaction(STORE.settings, 'readonly');
  const existing = await request(readTx.objectStore(STORE.settings).get(SETTINGS_KEY));
  if (existing !== undefined) return normalizeSettings(existing);

  const settings = normalizeSettings(initial);
  const writeTx = database.transaction(STORE.settings, 'readwrite');
  writeTx.objectStore(STORE.settings).put(settings, SETTINGS_KEY);
  await transactionDone(writeTx);
  return settings;
}

export async function clearAllData(): Promise<void> {
  const database = await openDatabase();
  const tx = database.transaction(
    [STORE.routines, STORE.sessions, STORE.exercises, STORE.settings],
    'readwrite',
  );
  tx.objectStore(STORE.routines).clear();
  tx.objectStore(STORE.sessions).clear();
  tx.objectStore(STORE.exercises).clear();
  tx.objectStore(STORE.settings).clear();
  await transactionDone(tx);
}

/** Replaces all domain rows in a single transaction, used by backup import. */
export async function replaceAllData(data: {
  routines: Routine[];
  sessions: Session[];
  customExercises: ReturnType<typeof normalizeCustomExercise>[];
  settings: Settings;
}): Promise<void> {
  const database = await openDatabase();
  const tx = database.transaction(
    [STORE.routines, STORE.sessions, STORE.exercises, STORE.settings],
    'readwrite',
  );
  const routines = tx.objectStore(STORE.routines);
  const sessions = tx.objectStore(STORE.sessions);
  const exercises = tx.objectStore(STORE.exercises);
  const settings = tx.objectStore(STORE.settings);

  routines.clear();
  sessions.clear();
  exercises.clear();
  settings.clear();
  for (const routine of data.routines) routines.put(storedRoutine(routine));
  for (const session of data.sessions) sessions.put(session);
  for (const exercise of data.customExercises) {
    exercises.put({ ...exercise, nameNormalized: normalizeExerciseText(exercise.name) });
  }
  settings.put(data.settings, SETTINGS_KEY);
  await transactionDone(tx);
}

/** Activates one routine and deactivates the rest in a single transaction. */
export async function setActiveRoutineAtomic(entityId: string): Promise<Routine[]> {
  const database = await openDatabase();
  const tx = database.transaction(STORE.routines, 'readwrite');
  const store = tx.objectStore(STORE.routines);
  const rows = normalizeRoutines(await request(store.getAll()));
  if (!rows.some((routine) => routine.id === entityId)) {
    tx.abort();
    throw new Error('That routine no longer exists.');
  }

  const now = new Date().toISOString();
  const next = rows.map((routine) =>
    routine.id === entityId
      ? { ...routine, active: true, updatedAt: now }
      : routine.active
        ? { ...routine, active: false }
        : routine,
  );
  for (const routine of next) store.put(storedRoutine(routine));
  await transactionDone(tx);
  return next;
}

export async function deleteDatabase(): Promise<void> {
  if (dbPromise) {
    try {
      const database = await dbPromise;
      database.close();
    } catch {
      /* opening already failed; deletion can still proceed */
    }
  }
  dbPromise = null;

  await new Promise<void>((resolve, reject) => {
    const deletion = indexedDB.deleteDatabase(DB_NAME);
    deletion.onsuccess = () => resolve();
    deletion.onerror = () => reject(deletion.error);
    deletion.onblocked = () =>
      reject(new Error('Trainer storage is open in another tab. Close it and delete again.'));
  });
}

/** Asks the browser for persistent storage once. Failure never blocks boot. */
export async function requestPersistentStorage(): Promise<void> {
  if (persistenceRequested) return;
  persistenceRequested = true;
  if (!navigator.storage?.persist) return;
  try {
    const granted = await navigator.storage.persist();
    console.info(`Trainer persistent storage: ${granted ? 'granted' : 'best effort'}`);
  } catch (error) {
    console.info('Trainer persistent storage request failed', error);
  }
}

/* ── Sync metadata (created now, used by Stage 7) ─────────────────────────── */

export async function listOutbox(): Promise<OutboxRecord[]> {
  const database = await openDatabase();
  const tx = database.transaction(STORE.outbox, 'readonly');
  const rows = await request(tx.objectStore(STORE.outbox).getAll());
  return rows as OutboxRecord[];
}

export async function putOutbox(record: OutboxRecord): Promise<number> {
  const database = await openDatabase();
  const tx = database.transaction(STORE.outbox, 'readwrite');
  const key = await request(tx.objectStore(STORE.outbox).put(record));
  await transactionDone(tx);
  return Number(key);
}

export async function removeOutbox(seqs: number[]): Promise<void> {
  if (seqs.length === 0) return;
  const database = await openDatabase();
  const tx = database.transaction(STORE.outbox, 'readwrite');
  const store = tx.objectStore(STORE.outbox);
  for (const seq of seqs) store.delete(seq);
  await transactionDone(tx);
}

export async function clearOutboxForEntity(kind: SyncEntityKind, entityId: string): Promise<void> {
  const database = await openDatabase();
  const tx = database.transaction(STORE.outbox, 'readwrite');
  const store = tx.objectStore(STORE.outbox);
  const index = store.index('entity');
  const keys = await request(index.getAllKeys([kind, entityId]));
  for (const key of keys) store.delete(key);
  await transactionDone(tx);
}

export async function readSyncState<T>(key: string): Promise<T | undefined> {
  const database = await openDatabase();
  const tx = database.transaction(STORE.syncState, 'readonly');
  const row = await request(
    tx.objectStore(STORE.syncState).get(key) as IDBRequest<{ key: string; value: T } | undefined>,
  );
  return row?.value;
}

export async function writeSyncState<T>(key: string, value: T): Promise<void> {
  const database = await openDatabase();
  const tx = database.transaction(STORE.syncState, 'readwrite');
  tx.objectStore(STORE.syncState).put({ key, value });
  await transactionDone(tx);
}

export async function deleteSyncState(key: string): Promise<void> {
  const database = await openDatabase();
  const tx = database.transaction(STORE.syncState, 'readwrite');
  tx.objectStore(STORE.syncState).delete(key);
  await transactionDone(tx);
}

export async function clearSyncStores(): Promise<void> {
  const database = await openDatabase();
  const tx = database.transaction(
    [STORE.outbox, STORE.versions, STORE.syncState],
    'readwrite',
  );
  tx.objectStore(STORE.outbox).clear();
  tx.objectStore(STORE.versions).clear();
  tx.objectStore(STORE.syncState).clear();
  await transactionDone(tx);
}

export async function putVersion(version: VersionRecord): Promise<void> {
  const database = await openDatabase();
  const tx = database.transaction(STORE.versions, 'readwrite');
  tx.objectStore(STORE.versions).put(version);
  await transactionDone(tx);
}
