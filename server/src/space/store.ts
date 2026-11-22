/**
 * Encrypted Trainer space access for the relay.
 *
 * The relay decrypts in memory so /api/v1 can build reports and validate
 * writes. Nothing here logs payloads, passphrases or keys.
 */

import { randomUUID } from 'node:crypto';
import {
  currentHead,
  pushChanges,
  snapshot,
  type StoredEntity,
  type UserRow,
} from '../db.js';
import {
  normalizeCustomExercise,
  normalizeRoutine,
  normalizeSession,
  normalizeSettings,
} from '../trainer/normalize.js';
import type { Exercise, Routine, Session, Settings } from '../trainer/types.js';
import { decryptPayload, encryptPayload, type SyncKeys } from './crypto.js';
import { HlcClock } from './hlc.js';

export type TrainerEntityKind = 'routine' | 'session' | 'exercise' | 'settings';

export interface SpaceEntity {
  entityType: TrainerEntityKind;
  entityId: string;
  hlc: string;
  payload: unknown;
}

export interface Space {
  user: UserRow;
  keys: SyncKeys;
  clientId: string;
  clock: HlcClock;
  entities: Map<string, SpaceEntity>;
}

const clocks = new Map<string, HlcClock>();

function entityKey(kind: TrainerEntityKind, id: string): string {
  return `${kind}:${id}`;
}

function normalize(kind: TrainerEntityKind, value: unknown): Routine | Session | Exercise | Settings {
  if (kind === 'routine') return normalizeRoutine(value);
  if (kind === 'session') return normalizeSession(value);
  if (kind === 'exercise') return normalizeCustomExercise(value);
  return normalizeSettings(value);
}

export async function openSpace(user: UserRow, keys: SyncKeys): Promise<Space> {
  let clock = clocks.get(user.key_hash);
  if (!clock) {
    clock = new HlcClock(`relay-${randomUUID()}`, null);
    clocks.set(user.key_hash, clock);
  }

  const head = currentHead(user.key_hash);
  const entities = new Map<string, SpaceEntity>();
  let after: { type: string; id: string } | null = null;

  for (;;) {
    const page = snapshot(user.key_hash, head, after, 200);
    for (const row of page.entities as StoredEntity[]) {
      clock.observe(row.hlc);
      if (row.deleted) continue;
      const entityType = row.entity_type as TrainerEntityKind;
      if (!['routine', 'session', 'exercise', 'settings'].includes(entityType)) continue;
      let payload: unknown;
      try {
        payload = await decryptPayload<unknown>(row.payload, keys.encKey);
      } catch {
        throw new Error('The sync space contains data that could not be decrypted.');
      }
      entities.set(entityKey(entityType, row.entity_id), {
        entityType,
        entityId: row.entity_id,
        hlc: row.hlc,
        payload,
      });
    }
    if (!page.next) break;
    after = page.next;
  }

  return { user, keys, clientId: `relay-${randomUUID()}`, clock, entities };
}

export function entitiesByKind<T>(space: Space, kind: TrainerEntityKind): T[] {
  return [...space.entities.values()]
    .filter((entity) => entity.entityType === kind)
    .map((entity) => normalize(kind, entity.payload) as T);
}

export function readRoutine(space: Space, id?: string): Routine | null {
  if (id) {
    const entity = space.entities.get(entityKey('routine', id));
    return entity ? normalizeRoutine(entity.payload) : null;
  }
  const routines = entitiesByKind<Routine>(space, 'routine');
  return (
    routines
      .filter((routine) => routine.active)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] ?? null
  );
}

export function findSessionByDate(space: Space, date: string): Session | null {
  return (
    entitiesByKind<Session>(space, 'session')
      .filter((session) => session.date === date)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] ?? null
  );
}

export function readCustomExercises(space: Space): Exercise[] {
  return entitiesByKind<Exercise>(space, 'exercise');
}

export async function writeEncryptedEntity(
  space: Space,
  kind: TrainerEntityKind,
  entityId: string,
  value: unknown,
  deleted = false,
): Promise<SpaceEntity> {
  const normalized = deleted ? null : normalize(kind, value);
  const hlc = space.clock.next();
  const payload = deleted ? '' : await encryptPayload(normalized, space.keys.encKey);
  pushChanges(space.user.key_hash, [
    {
      changeId: randomUUID(),
      clientId: space.clientId,
      entityType: kind,
      entityId,
      hlc,
      deleted,
      payload,
    },
  ]);

  const key = entityKey(kind, entityId);
  if (deleted) {
    space.entities.delete(key);
    return { entityType: kind, entityId, hlc, payload: null };
  }

  const entity = { entityType: kind, entityId, hlc, payload: normalized };
  space.entities.set(key, entity);
  return entity;
}
