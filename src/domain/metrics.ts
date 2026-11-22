/**
 * Derived training metrics.
 *
 * Every function here is pure: metrics are recomputed from completed sessions,
 * never stored. Local calendar dates and ISO week keys drive all grouping.
 */

import { addDays, isoWeekKey, isoWeekday } from './date';
import { sessionSetCount, sessionVolume } from './session';
import type {
  IsoDate,
  MuscleGroupId,
  Session,
  SessionExercise,
  SetLog,
} from './types';

export interface PrEntry {
  exerciseId: string;
  name: string;
  reps: number;
  weight: number;
  date: IsoDate;
  sessionId: string;
}

export interface ExerciseSessionPoint {
  date: IsoDate;
  sessionId: string;
  sets: SetLog[];
  topWeight: number;
  topRepsAtTop: number;
  volume: number;
  estimated1rm: number | null;
}

export interface MuscleWeek {
  week: string;
  muscles: Partial<Record<MuscleGroupId, number>>;
  sets: Partial<Record<MuscleGroupId, number>>;
}

export interface AdherenceBucket {
  week: string;
  scheduled: number;
  completed: number;
  skipped: number;
}

export interface AdherenceSummary {
  weeks: number;
  scheduled: number;
  completed: number;
  skipped: number;
  rate: number | null;
  adHocCompleted: number;
}

export interface SessionSummary {
  sets: number;
  volume: number;
  exercises: number;
}

export interface TrainingStreak {
  current: number;
  best: number;
}

export const FEELINGS = ['Drained', 'Tired', 'OK', 'Strong', 'Fresh'] as const;

/** Human label for the 1–5 session feel rating. */
export function sessionFeeling(rating: number | null): string | null {
  if (rating === null) return null;
  return FEELINGS[rating - 1] ?? null;
}

/**
 * Consecutive completed scheduled workouts. A skipped scheduled workout breaks
 * the run; rest days and ad-hoc sessions are not scheduled workouts so they do
 * not participate.
 */
export function trainingStreak(sessions: Session[], today: IsoDate): TrainingStreak {
  const scheduled = sessions
    .filter(
      (session) =>
        session.source !== 'manual' &&
        session.date <= today &&
        (session.status === 'completed' || session.status === 'skipped'),
    )
    .sort((a, b) => a.date.localeCompare(b.date));

  let best = 0;
  let run = 0;
  for (const session of scheduled) {
    if (session.status === 'completed') {
      run += 1;
      best = Math.max(best, run);
    } else {
      run = 0;
    }
  }

  return { current: run, best };
}

function completedAscending(sessions: Session[]): Session[] {
  return sessions
    .filter((session) => session.status === 'completed')
    .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt));
}

function round(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

/** Monday at the start of a range of whole weeks ending with the current week. */
export function weeksRangeStart(today: IsoDate, weeks: number): IsoDate {
  const currentMonday = addDays(today, -(isoWeekday(today) - 1));
  return addDays(currentMonday, -(Math.max(1, weeks) - 1) * 7);
}

function weekKeys(today: IsoDate, weeks: number): string[] {
  const first = weeksRangeStart(today, weeks);
  return Array.from({ length: weeks }, (_, index) => isoWeekKey(addDays(first, index * 7)));
}

function uniqueMuscles(muscles: MuscleGroupId[]): MuscleGroupId[] {
  return [...new Set(muscles)];
}

/**
 * Muscle attribution for one exercise: primary muscles split the full set
 * volume, secondary muscles split half. With no primary muscles, secondary
 * muscles receive the full credit.
 */
function addMuscleAttribution(
  row: SessionExercise,
  weight: number,
  reps: number,
  volume: Partial<Record<MuscleGroupId, number>>,
  sets: Partial<Record<MuscleGroupId, number>>,
): void {
  const primary = uniqueMuscles(row.primaryMuscles);
  const secondary = uniqueMuscles(row.secondaryMuscles).filter(
    (muscle) => !primary.includes(muscle),
  );
  const setVolume = weight * reps;

  if (primary.length > 0) {
    const primaryVolume = setVolume / primary.length;
    const primarySets = 1 / primary.length;
    for (const muscle of primary) {
      volume[muscle] = (volume[muscle] ?? 0) + primaryVolume;
      sets[muscle] = (sets[muscle] ?? 0) + primarySets;
    }

    if (secondary.length > 0) {
      const secondaryVolume = (setVolume * 0.5) / secondary.length;
      const secondarySets = 0.5 / secondary.length;
      for (const muscle of secondary) {
        volume[muscle] = (volume[muscle] ?? 0) + secondaryVolume;
        sets[muscle] = (sets[muscle] ?? 0) + secondarySets;
      }
    }
    return;
  }

  if (secondary.length > 0) {
    const secondaryVolume = setVolume / secondary.length;
    const secondarySets = 1 / secondary.length;
    for (const muscle of secondary) {
      volume[muscle] = (volume[muscle] ?? 0) + secondaryVolume;
      sets[muscle] = (sets[muscle] ?? 0) + secondarySets;
    }
  }
}

export function sessionMuscleVolume(session: Session): Partial<Record<MuscleGroupId, number>> {
  const volume: Partial<Record<MuscleGroupId, number>> = {};
  for (const row of session.exercises) {
    for (const set of row.sets) {
      addMuscleAttribution(row, set.weight, set.reps, volume, {});
    }
  }
  for (const muscle of Object.keys(volume) as MuscleGroupId[]) {
    volume[muscle] = round(volume[muscle] ?? 0, 2);
  }
  return volume;
}

export function computePrs(sessions: Session[]): PrEntry[] {
  const entries = new Map<string, PrEntry>();
  const latestNames = new Map<string, string>();

  for (const session of completedAscending(sessions)) {
    for (const row of session.exercises) {
      latestNames.set(row.exerciseId, row.name);
      for (const set of row.sets) {
        if (set.weight <= 0 || set.reps <= 0) continue;
        const key = `${row.exerciseId}\u0000${set.reps}`;
        const existing = entries.get(key);
        if (
          !existing ||
          set.weight > existing.weight ||
          (set.weight === existing.weight && session.date < existing.date)
        ) {
          entries.set(key, {
            exerciseId: row.exerciseId,
            name: row.name,
            reps: set.reps,
            weight: round(set.weight, 2),
            date: session.date,
            sessionId: session.id,
          });
        }
      }
    }
  }

  return [...entries.values()]
    .map((entry) => ({
      ...entry,
      name: latestNames.get(entry.exerciseId) ?? entry.name,
    }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.reps - b.reps);
}

export function prsForExercise(sessions: Session[], exerciseId: string): PrEntry[] {
  return computePrs(sessions).filter((entry) => entry.exerciseId === exerciseId);
}

export function exerciseHistory(sessions: Session[], exerciseId: string): ExerciseSessionPoint[] {
  const points: ExerciseSessionPoint[] = [];

  for (const session of completedAscending(sessions)) {
    const rows = session.exercises.filter((row) => row.exerciseId === exerciseId);
    if (rows.length === 0) continue;

    const sets = rows.flatMap((row) => row.sets);
    if (sets.length === 0) continue;

    let topWeight = 0;
    let topRepsAtTop = 0;
    let volume = 0;
    for (const set of sets) {
      volume += set.weight * set.reps;
      if (
        set.weight > topWeight ||
        (set.weight === topWeight && set.reps > topRepsAtTop)
      ) {
        topWeight = set.weight;
        topRepsAtTop = set.reps;
      }
    }

    points.push({
      date: session.date,
      sessionId: session.id,
      sets,
      topWeight,
      topRepsAtTop,
      volume: round(volume, 2),
      estimated1rm:
        topWeight > 0 ? round(topWeight * (1 + topRepsAtTop / 30), 1) : null,
    });
  }

  return points;
}

export function muscleWeeks(sessions: Session[], weeks: number, today: IsoDate): MuscleWeek[] {
  const count = Math.max(1, weeks);
  const first = weeksRangeStart(today, count);
  const rows = new Map<string, MuscleWeek>();

  for (const week of weekKeys(today, count)) {
    rows.set(week, { week, muscles: {}, sets: {} });
  }

  for (const session of completedAscending(sessions)) {
    if (session.date < first || session.date > today) continue;
    const row = rows.get(isoWeekKey(session.date));
    if (!row) continue;

    for (const exercise of session.exercises) {
      for (const set of exercise.sets) {
        addMuscleAttribution(exercise, set.weight, set.reps, row.muscles, row.sets);
      }
    }
  }

  return [...rows.values()].map((row) => {
    for (const muscle of Object.keys(row.muscles) as MuscleGroupId[]) {
      row.muscles[muscle] = round(row.muscles[muscle] ?? 0, 2);
    }
    for (const muscle of Object.keys(row.sets) as MuscleGroupId[]) {
      row.sets[muscle] = round(row.sets[muscle] ?? 0, 1);
    }
    return row;
  });
}

export function adherence(
  sessions: Session[],
  weeks: number,
  today: IsoDate,
): { buckets: AdherenceBucket[]; summary: AdherenceSummary } {
  const count = Math.max(1, weeks);
  const first = weeksRangeStart(today, count);
  const bucketMap = new Map<string, AdherenceBucket>();

  for (const week of weekKeys(today, count)) {
    bucketMap.set(week, { week, scheduled: 0, completed: 0, skipped: 0 });
  }

  let adHocCompleted = 0;
  for (const session of sessions) {
    if (session.date < first || session.date > today) continue;
    if (session.status !== 'completed' && session.status !== 'skipped') continue;

    if (session.source === 'manual') {
      if (session.status === 'completed') adHocCompleted += 1;
      continue;
    }

    const bucket = bucketMap.get(isoWeekKey(session.date));
    if (!bucket) continue;
    bucket.scheduled += 1;
    if (session.status === 'completed') bucket.completed += 1;
    else bucket.skipped += 1;
  }

  const buckets = [...bucketMap.values()];
  const completed = buckets.reduce((total, bucket) => total + bucket.completed, 0);
  const skipped = buckets.reduce((total, bucket) => total + bucket.skipped, 0);
  const scheduled = completed + skipped;

  return {
    buckets,
    summary: {
      weeks: count,
      scheduled,
      completed,
      skipped,
      rate: scheduled === 0 ? null : completed / scheduled,
      adHocCompleted,
    },
  };
}

export function recentPrs(sessions: Session[], days: number, today: IsoDate): PrEntry[] {
  const first = addDays(today, -(Math.max(1, days) - 1));
  return computePrs(sessions)
    .filter((entry) => entry.date >= first && entry.date <= today)
    .sort(
      (a, b) =>
        b.date.localeCompare(a.date) ||
        a.name.localeCompare(b.name) ||
        a.reps - b.reps,
    );
}

export function sessionSummaries(sessions: Session[]): Map<string, SessionSummary> {
  return new Map(
    sessions.map((session) => [
      session.id,
      {
        sets: sessionSetCount(session),
        volume: sessionVolume(session),
        exercises: session.exercises.length,
      },
    ]),
  );
}
