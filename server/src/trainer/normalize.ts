/**
 * Boundary normalization.
 *
 * IndexedDB reads, backup imports, API writes and sync application all pass
 * records through these functions. They return new objects and never mutate
 * their input, so a malformed row can never leak into React state.
 */

import {
  deviceTimezone,
  isValidIsoDate,
  isValidTimezone,
  isoWeekday,
  todayIso,
} from './date.js';
import {
  EQUIPMENT_IDS,
  EXERCISE_CATEGORY_IDS,
  MUSCLE_GROUP_IDS,
} from './catalogue/groups.js';
import type {
  EquipmentId,
  Exercise,
  ExerciseCategory,
  IsoDate,
  IsoDateTime,
  MuscleGroupId,
  Routine,
  RoutineSlot,
  Session,
  SessionExercise,
  SessionSource,
  SessionStatus,
  SetLog,
  Settings,
  ThemeSetting,
  Weekday,
} from './types.js';

const MUSCLE_IDS = new Set<string>(MUSCLE_GROUP_IDS);
const EQUIPMENT_ID_SET = new Set<string>(EQUIPMENT_IDS);
const CATEGORY_ID_SET = new Set<string>(EXERCISE_CATEGORY_IDS);
const STATUSES: SessionStatus[] = ['planned', 'completed', 'skipped'];
const SOURCES: SessionSource[] = ['ai', 'manual', 'auto'];

export const DEFAULT_SETTINGS: Settings = {
  theme: 'nordic-light',
  soundEnabled: false,
  hapticsEnabled: true,
  timezone: deviceTimezone(),
  weightUnit: 'kg',
  heightCm: null,
  bodyWeightKg: null,
};

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function text(value: unknown, fallback = '', max = 10_000): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  return (trimmed || fallback).slice(0, max);
}

function id(value: unknown): string {
  if (typeof value === 'string' && value.trim()) return value.trim();
  return crypto.randomUUID();
}

function integer(value: unknown, fallback: number, min: number, max: number): number {
  const number = typeof value === 'number' ? value : Number.NaN;
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
}

function decimal(value: unknown, fallback: number, min: number, max: number): number {
  const number = typeof value === 'number' ? value : Number.NaN;
  if (!Number.isFinite(number)) return fallback;
  return Math.round(Math.min(max, Math.max(min, number)) * 100) / 100;
}

function timestamp(value: unknown): IsoDateTime {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  }
  return new Date().toISOString();
}

function optionalTimestamp(value: unknown): IsoDateTime | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  }
  return null;
}

function date(value: unknown, fallback: IsoDate): IsoDate {
  return typeof value === 'string' && isValidIsoDate(value) ? value : fallback;
}

function dedupe<T>(values: T[], key: (value: T) => string): T[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const itemKey = key(value);
    if (seen.has(itemKey)) return false;
    seen.add(itemKey);
    return true;
  });
}

function muscles(value: unknown): MuscleGroupId[] {
  if (!Array.isArray(value)) return [];
  const valid = value.filter(
    (item): item is MuscleGroupId => typeof item === 'string' && MUSCLE_IDS.has(item),
  );
  return dedupe(valid, (item) => item);
}

function equipment(value: unknown): EquipmentId[] {
  if (!Array.isArray(value)) return [];
  const valid = value.filter(
    (item): item is EquipmentId => typeof item === 'string' && EQUIPMENT_ID_SET.has(item),
  );
  return dedupe(valid, (item) => item);
}

function category(value: unknown): ExerciseCategory {
  if (typeof value === 'string' && CATEGORY_ID_SET.has(value)) {
    return value as ExerciseCategory;
  }
  return 'full-body';
}

function theme(value: unknown): ThemeSetting {
  return value === 'nordic-dark' ? 'nordic-dark' : 'nordic-light';
}

function weekday(value: unknown, fallback: Weekday): Weekday {
  return value === 1 || value === 2 || value === 3 || value === 4 || value === 5 || value === 6 || value === 7
    ? value
    : fallback;
}

function weekdayOrNull(value: unknown): Weekday | null {
  return value === 1 || value === 2 || value === 3 || value === 4 || value === 5 || value === 6 || value === 7
    ? value
    : null;
}

function normalizeSlot(value: unknown, weekCount: number): RoutineSlot | null {
  const source = record(value);
  const rawWeekIndex =
    typeof source.weekIndex === 'number' && Number.isFinite(source.weekIndex)
      ? Math.round(source.weekIndex)
      : -1;
  // Out-of-range holes are dropped, not clamped onto a real week.
  if (rawWeekIndex < 0 || rawWeekIndex >= weekCount) return null;
  const weekIndex = rawWeekIndex;
  const day = weekdayOrNull(source.weekday);
  if (day === null) return null;
  const kind = source.kind === 'workout' ? 'workout' : 'rest';
  return {
    weekIndex,
    weekday: day,
    kind,
    focus: kind === 'rest' ? '' : text(source.focus, '', 40),
    note: text(source.note, '', 200),
  };
}

export function normalizeRoutine(value: unknown): Routine {
  const source = record(value);
  const startDate = date(source.startDate, todayIso());
  const weekCount = integer(source.weekCount, 1, 1, 12);

  const supplied = Array.isArray(source.slots)
    ? source.slots.map((slot) => normalizeSlot(slot, weekCount)).filter((slot): slot is RoutineSlot => slot !== null)
    : [];
  const byKey = new Map<string, RoutineSlot>();
  for (const slot of supplied) byKey.set(`${slot.weekIndex}:${slot.weekday}`, slot);
  const slots: RoutineSlot[] = [];
  for (let weekIndex = 0; weekIndex < weekCount; weekIndex += 1) {
    for (let day = 1; day <= 7; day += 1) {
      const weekdayValue = day as Weekday;
      slots.push(
        byKey.get(`${weekIndex}:${weekdayValue}`) ?? {
          weekIndex,
          weekday: weekdayValue,
          kind: 'rest',
          focus: '',
          note: '',
        },
      );
    }
  }

  const createdAt = timestamp(source.createdAt);
  return {
    id: id(source.id),
    name: text(source.name, 'Untitled routine', 60),
    notes: text(source.notes, '', 2000),
    startDate,
    weekCount,
    slots,
    active: source.active === true,
    createdAt,
    updatedAt: timestamp(source.updatedAt ?? createdAt),
  };
}

export function normalizeRoutines(value: unknown): Routine[] {
  if (!Array.isArray(value)) return [];
  const routines = dedupe(value.map(normalizeRoutine), (routine) => routine.id);

  // The data layer guarantees one active routine. If malformed data contains
  // more, keep the most recently updated one.
  const active = routines
    .filter((routine) => routine.active)
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  const keep = active[0]?.id;
  return routines.map((routine) =>
    routine.active && routine.id !== keep ? { ...routine, active: false } : routine,
  );
}

function normalizeSet(value: unknown): SetLog | null {
  const source = record(value);
  const reps = integer(source.reps, 0, 0, 999);
  if (reps < 1) return null;
  return {
    id: id(source.id),
    weight: decimal(source.weight, 0, 0, 1000),
    reps,
  };
}

function normalizeSets(value: unknown): SetLog[] {
  if (!Array.isArray(value)) return [];
  const sets = value.map(normalizeSet).filter((set): set is SetLog => set !== null);
  return dedupe(sets, (set) => set.id);
}

function normalizeSessionExercise(value: unknown): SessionExercise {
  const source = record(value);
  const primary = muscles(source.primaryMuscles);
  const primarySet = new Set(primary);
  const secondary = muscles(source.secondaryMuscles).filter((muscle) => !primarySet.has(muscle));
  const targetRepMin = integer(source.targetRepMin, 8, 1, 50);
  const targetRepMax = Math.max(targetRepMin, integer(source.targetRepMax, 12, 1, 50));

  return {
    id: id(source.id),
    exerciseId: text(source.exerciseId, 'unknown', 200),
    name: text(source.name, 'Exercise', 80),
    primaryMuscles: primary,
    secondaryMuscles: secondary,
    order: integer(source.order, 0, 0, 999),
    targetSets: integer(source.targetSets, 3, 1, 12),
    targetRepMin,
    targetRepMax,
    note: text(source.note, '', 500),
    sets: normalizeSets(source.sets),
  };
}

function normalizeSessionExercises(value: unknown): SessionExercise[] {
  if (!Array.isArray(value)) return [];
  const rows = dedupe(value.map(normalizeSessionExercise), (row) => row.id);
  rows.sort((a, b) => a.order - b.order);
  return rows.map((row, index) => ({ ...row, order: index }));
}

export function normalizeSession(value: unknown): Session {
  const source = record(value);
  const sessionDate = date(source.date, todayIso());
  const status = STATUSES.find((item) => item === source.status) ?? 'planned';
  const sessionSource = SOURCES.find((item) => item === source.source) ?? 'manual';
  const weekIndexValue = typeof source.weekIndex === 'number' ? Math.round(source.weekIndex) : -1;
  const createdAt = timestamp(source.createdAt);

  return {
    id: id(source.id),
    date: sessionDate,
    routineId: typeof source.routineId === 'string' && source.routineId.trim() ? source.routineId.trim() : null,
    routineName: text(source.routineName, 'Ad-hoc', 80),
    weekIndex: weekIndexValue >= 0 ? weekIndexValue : null,
    weekday: weekday(source.weekday, isoWeekday(sessionDate)),
    focus: text(source.focus, 'Ad-hoc', 40),
    status,
    source: sessionSource,
    exercises: normalizeSessionExercises(source.exercises),
    notes: text(source.notes, '', 2000),
    rating: integer(source.rating, 0, 0, 5) || null,
    createdAt,
    updatedAt: timestamp(source.updatedAt ?? createdAt),
    completedAt: optionalTimestamp(source.completedAt),
    skippedAt: optionalTimestamp(source.skippedAt),
  };
}

export function normalizeSessions(value: unknown): Session[] {
  if (!Array.isArray(value)) return [];
  const sessions = dedupe(value.map(normalizeSession), (session) => session.id);
  // One session per calendar date is an invariant. Malformed imports keep the
  // most recently updated record for a duplicated date.
  const byDate = new Map<string, Session>();
  for (const session of sessions) {
    const current = byDate.get(session.date);
    if (!current || session.updatedAt > current.updatedAt) byDate.set(session.date, session);
  }
  return [...byDate.values()];
}

export function normalizeSettings(value: unknown): Settings {
  const source = record(value);
  return {
    theme: theme(source.theme),
    soundEnabled: source.soundEnabled === true,
    hapticsEnabled: source.hapticsEnabled !== false,
    timezone:
      typeof source.timezone === 'string' && isValidTimezone(source.timezone)
        ? source.timezone
        : deviceTimezone(),
    weightUnit: source.weightUnit === 'lb' ? 'lb' : 'kg',
    heightCm:
      typeof source.heightCm === 'number' && Number.isFinite(source.heightCm)
        ? Math.min(250, Math.max(50, Math.round(source.heightCm)))
        : null,
    bodyWeightKg:
      typeof source.bodyWeightKg === 'number' && Number.isFinite(source.bodyWeightKg)
        ? Math.min(500, Math.max(20, Math.round(source.bodyWeightKg * 10) / 10))
        : null,
  };
}

export function normalizeCustomExercise(value: unknown): Exercise {
  const source = record(value);
  const primary = muscles(source.primaryMuscles);
  const primarySet = new Set(primary);
  const secondary = muscles(source.secondaryMuscles).filter((muscle) => !primarySet.has(muscle));
  const aliases = Array.isArray(source.aliases)
    ? dedupe(
        source.aliases
          .filter((alias): alias is string => typeof alias === 'string')
          .map((alias) => alias.trim())
          .filter(Boolean)
          .map((alias) => alias.slice(0, 40)),
        (alias) => alias.toLocaleLowerCase(),
      ).slice(0, 5)
    : [];

  return {
    id: id(source.id),
    name: text(source.name, 'Custom exercise', 80),
    aliases,
    category: category(source.category),
    primaryMuscles: primary,
    secondaryMuscles: secondary,
    equipment: equipment(source.equipment),
    instructions: text(source.instructions, '', 1200),
    source: 'custom',
    createdAt: optionalTimestamp(source.createdAt) ?? new Date().toISOString(),
  };
}

export function normalizeCustomExercises(value: unknown): Exercise[] {
  if (!Array.isArray(value)) return [];
  return dedupe(value.map(normalizeCustomExercise), (exercise) => exercise.id);
}
