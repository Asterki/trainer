/**
 * GET /api/v1/sessions and PUT /api/v1/sessions/{date}.
 *
 * The PUT path is the AI write. It reuses the relay's encrypted entity writer,
 * so the app merges the plan through its normal sync cycle.
 */

import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';
import {
  entitiesByKind,
  findSessionByDate,
  openSpace,
  readCustomExercises,
  readRoutine,
  writeEncryptedEntity,
} from '../space/store.js';
import type { ApiRequest } from './auth.js';
import { fail } from './errors.js';
import { loadCatalogue, normalizeExerciseText } from '../trainer/catalogue/wger.js';
import { addDays, isValidIsoDate } from '../trainer/date.js';
import { resolveSlot } from '../trainer/routine.js';
import type {
  Exercise,
  IsoDate,
  Session,
  SessionExercise,
  SessionStatus,
} from '../trainer/types.js';
import { relayToday } from './time.js';

const STATUSES: SessionStatus[] = ['planned', 'completed', 'skipped'];

function textParam(value: unknown, max: number): string | null {
  if (value === undefined) return null;
  if (typeof value !== 'string' || value.length > max) return null;
  return value;
}

function intParam(value: unknown): number | null {
  if (value === undefined) return null;
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return null;
  const number = Number(value);
  return Number.isInteger(number) ? number : null;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

interface PlanExercise {
  exerciseId?: string;
  name?: string;
  targetSets: number;
  targetRepMin: number;
  targetRepMax: number;
  note: string;
}

function bodyError(field: string, message: string): never {
  fail(400, 'invalid_body', message, { field });
}

function requiredInt(value: unknown, min: number, max: number, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    bodyError(field, `Must be an integer between ${min} and ${max}.`);
  }
  return value;
}

function parsePlan(body: unknown): { focus: string | null; notes: string | null; exercises: PlanExercise[] } {
  const source = record(body);
  if (!source) bodyError('body', 'Expected a JSON object.');
  if (!Array.isArray(source.exercises) || source.exercises.length < 1 || source.exercises.length > 30) {
    bodyError('exercises', 'Provide between 1 and 30 exercises.');
  }
  if (source.source !== undefined && source.source !== 'ai') {
    bodyError('source', 'Only source "ai" is accepted.');
  }

  const focus = textParam(source.focus, 40);
  if (source.focus !== undefined && focus === null) {
    bodyError('focus', 'Must be a string of at most 40 characters.');
  }
  const notes = textParam(source.notes, 2000);
  if (source.notes !== undefined && notes === null) {
    bodyError('notes', 'Must be a string of at most 2000 characters.');
  }

  const exercises = source.exercises.map((raw, index): PlanExercise => {
    const item = record(raw);
    const prefix = `exercises[${index}]`;
    if (!item) bodyError(prefix, 'Expected an object.');

    const exerciseId = typeof item.exerciseId === 'string' ? item.exerciseId.trim() : '';
    const name = typeof item.name === 'string' ? item.name.trim() : '';
    if (!exerciseId && !name) bodyError(prefix, 'exerciseId or name is required.');

    const targetSets = requiredInt(item.targetSets, 1, 12, `${prefix}.targetSets`);
    const targetRepMin = requiredInt(item.targetRepMin, 1, 50, `${prefix}.targetRepMin`);
    const targetRepMax = requiredInt(item.targetRepMax, 1, 50, `${prefix}.targetRepMax`);
    if (targetRepMax < targetRepMin) {
      bodyError(`${prefix}.targetRepMax`, 'Must be greater than or equal to targetRepMin.');
    }

    if (item.note !== undefined && (typeof item.note !== 'string' || item.note.length > 500)) {
      bodyError(`${prefix}.note`, 'Must be a string of at most 500 characters.');
    }

    return {
      ...(exerciseId ? { exerciseId } : { name }),
      targetSets,
      targetRepMin,
      targetRepMax,
      note: typeof item.note === 'string' ? item.note : '',
    };
  });

  return { focus, notes, exercises };
}

function resolveExercise(input: PlanExercise, catalogue: Exercise[], byName: Map<string, Exercise[]>): Exercise {
  const byId = new Map(catalogue.map((exercise) => [exercise.id, exercise]));

  if (input.exerciseId) {
    const exercise = byId.get(input.exerciseId);
    if (!exercise) {
      fail(422, 'unknown_exercise', 'The exercise id is not in the catalogue.', {
        exerciseId: input.exerciseId,
      });
    }
    return exercise;
  }

  const normalized = normalizeExerciseText(input.name ?? '');
  const matches = normalized ? byName.get(normalized) ?? [] : [];
  if (matches.length === 0) {
    fail(422, 'unknown_exercise', 'The exercise name did not match any catalogue exercise.', {
      name: input.name,
    });
  }
  if (matches.length > 1) {
    fail(409, 'ambiguous_exercise', 'The exercise name matches more than one exercise.', {
      name: input.name,
      candidates: matches.slice(0, 5).map((exercise) => ({
        exerciseId: exercise.id,
        name: exercise.name,
      })),
    });
  }
  return matches[0];
}

export async function listSessionsHandler(req: Request, res: Response): Promise<void> {
  const today = relayToday();

  const rawTo = req.query.to;
  const rawFrom = req.query.from;
  let to = today;
  let from = addDays(today, -29);

  if (rawTo !== undefined) {
    if (typeof rawTo !== 'string' || !isValidIsoDate(rawTo)) {
      fail(400, 'invalid_date', 'to must be a calendar date in YYYY-MM-DD format.', { field: 'to' });
    }
    to = rawTo;
  }
  if (rawFrom !== undefined) {
    if (typeof rawFrom !== 'string' || !isValidIsoDate(rawFrom)) {
      fail(400, 'invalid_date', 'from must be a calendar date in YYYY-MM-DD format.', { field: 'from' });
    }
    from = rawFrom;
  }

  const status = req.query.status;
  if (status !== undefined && (typeof status !== 'string' || !STATUSES.includes(status as SessionStatus))) {
    fail(400, 'invalid_query', 'status must be planned, completed or skipped.', { field: 'status' });
  }

  const focus = req.query.focus;
  if (focus !== undefined && (typeof focus !== 'string' || focus.length > 40)) {
    fail(400, 'invalid_query', 'focus must be a string of at most 40 characters.', { field: 'focus' });
  }

  let limit = 50;
  if (req.query.limit !== undefined) {
    const parsed = intParam(req.query.limit);
    if (parsed === null || parsed < 1 || parsed > 200) {
      fail(400, 'invalid_limit', 'limit must be between 1 and 200.', { field: 'limit' });
    }
    limit = parsed;
  }

  const { user, keys } = (req as ApiRequest).apiAuth;
  const space = await openSpace(user, keys);
  const focusValue = typeof focus === 'string' ? focus.trim().toLocaleLowerCase() : '';

  const sessions = entitiesByKind<Session>(space, 'session')
    .filter((session) => session.date >= from && session.date <= to)
    .filter((session) => status === undefined || session.status === status)
    .filter((session) => !focusValue || session.focus.trim().toLocaleLowerCase() === focusValue)
    .sort((a, b) => a.date.localeCompare(b.date) || a.updatedAt.localeCompare(b.updatedAt))
    .slice(0, limit);

  res.json({ sessions });
}

export async function putSessionHandler(req: Request, res: Response): Promise<void> {
  const rawDate = req.params.date;
  if (typeof rawDate !== 'string' || !isValidIsoDate(rawDate)) {
    fail(400, 'invalid_date', 'The date must be a calendar date in YYYY-MM-DD format.', { field: 'date' });
  }

  const today = relayToday();
  if (rawDate < addDays(today, -1) || rawDate > addDays(today, 14)) {
    fail(400, 'date_out_of_range', 'The relay accepts writes from yesterday through 14 days ahead.', {
      date: rawDate,
      today,
    });
  }

  const plan = parsePlan(req.body as unknown);
  const date: IsoDate = rawDate;

  const { user, keys } = (req as ApiRequest).apiAuth;
  const space = await openSpace(user, keys);
  const routine = readRoutine(space);
  const slot = routine ? resolveSlot(routine, date) : null;

  if (!routine || !slot || slot.kind !== 'workout') {
    fail(409, 'no_scheduled_workout', 'No workout is scheduled for this date.', { date });
  }

  const existing = findSessionByDate(space, date);
  if (existing) {
    if (existing.status === 'completed' || existing.status === 'skipped') {
      fail(409, 'session_closed', 'This session is already complete.', { date });
    }
    if (existing.exercises.some((exercise) => exercise.sets.some((set) => set.reps > 0))) {
      fail(409, 'session_in_progress', 'At least one set is already logged.', { date });
    }
    if (existing.source === 'manual') {
      fail(409, 'manual_session', 'Ad-hoc manual sessions cannot be replaced by a plan.', { date });
    }
  }

  const catalogue = await loadCatalogue(readCustomExercises(space));
  const byName = new Map<string, Exercise[]>();
  for (const exercise of catalogue) {
    const key = normalizeExerciseText(exercise.name);
    const rows = byName.get(key);
    if (rows) rows.push(exercise);
    else byName.set(key, [exercise]);
  }

  const resolved = plan.exercises.map((input) => resolveExercise(input, catalogue, byName));
  const now = new Date().toISOString();

  const exercises: SessionExercise[] = resolved.map((exercise, index) => {
    const input = plan.exercises[index];
    return {
      id: randomUUID(),
      exerciseId: exercise.id,
      name: exercise.name,
      primaryMuscles: exercise.primaryMuscles,
      secondaryMuscles: exercise.secondaryMuscles,
      order: index,
      targetSets: input.targetSets,
      targetRepMin: input.targetRepMin,
      targetRepMax: input.targetRepMax,
      note: input.note,
      sets: [],
    };
  });

  const focus = (plan.focus ?? '').trim() || slot.focus.trim() || 'Workout';

  const session: Session = {
    id: existing?.id ?? randomUUID(),
    date,
    routineId: existing?.routineId ?? routine.id,
    routineName: existing?.routineName ?? routine.name,
    weekIndex: existing?.weekIndex ?? slot.weekIndex,
    weekday: existing?.weekday ?? slot.weekday,
    focus,
    status: 'planned',
    source: 'ai',
    exercises,
    notes: plan.notes ?? existing?.notes ?? '',
    rating: existing?.rating ?? null,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    completedAt: null,
    skippedAt: null,
  };

  const written = await writeEncryptedEntity(space, 'session', session.id, session);
  res.json(written.payload as Session);
}
