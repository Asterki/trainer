/**
 * GET /api/v1/context — the compact training report consumed by n8n.
 *
 * Caps are deliberate: the report must stay well below the n8n payload limit
 * with eight weeks of history.
 */

import type { Request, Response } from 'express';
import {
  entitiesByKind,
  openSpace,
  readCustomExercises,
  readRoutine,
  type Space,
} from '../space/store.js';
import type { ApiRequest } from './auth.js';
import { fail } from './errors.js';
import { EXERCISE_CATEGORY_IDS } from '../trainer/catalogue/groups.js';
import { loadCatalogue } from '../trainer/catalogue/wger.js';
import { isValidIsoDate } from '../trainer/date.js';
import { adherence, computePrs, exerciseHistory, muscleWeeks } from '../trainer/metrics.js';
import { resolveSlot } from '../trainer/routine.js';
import { lastPerformance } from '../trainer/session.js';
import type {
  Exercise,
  ExerciseCategory,
  IsoDate,
  MuscleGroupId,
  Session,
  SessionExercise,
} from '../trainer/types.js';
import { relayToday } from './time.js';

interface ContextSet {
  weight: number;
  reps: number;
}

interface RecentExercise {
  exerciseId: string;
  name: string;
  primaryMuscles: MuscleGroupId[];
  sets: ContextSet[];
  topWeight: number;
  volume: number;
}

interface RecentSession {
  date: IsoDate;
  focus: string;
  status: 'completed' | 'skipped';
  exercises: RecentExercise[];
}

interface ExerciseStats {
  exerciseId: string;
  name: string;
  primaryMuscles: MuscleGroupId[];
  last: { date: IsoDate; sets: ContextSet[] } | null;
  prs: Record<string, number>;
  volumeTrend: number[];
}

interface Candidate {
  exerciseId: string;
  name: string;
  primaryMuscles: MuscleGroupId[];
  secondaryMuscles: MuscleGroupId[];
  equipment: Exercise['equipment'];
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function recentExercises(session: Session): RecentExercise[] {
  const rows = new Map<string, RecentExercise>();

  for (const row of session.exercises) {
    let entry = rows.get(row.exerciseId);
    if (!entry) {
      entry = {
        exerciseId: row.exerciseId,
        name: row.name,
        primaryMuscles: row.primaryMuscles,
        sets: [],
        topWeight: 0,
        volume: 0,
      };
      rows.set(row.exerciseId, entry);
    }
    for (const set of row.sets) {
      entry.sets.push({ weight: set.weight, reps: set.reps });
      entry.topWeight = Math.max(entry.topWeight, set.weight);
      entry.volume = round(entry.volume + set.weight * set.reps);
    }
  }

  return [...rows.values()];
}

function focusCategories(focus: string): ExerciseCategory[] {
  const value = focus.trim().toLocaleLowerCase();
  if (!value) return [];

  const categories = new Set<ExerciseCategory>();
  const add = (...items: ExerciseCategory[]) => items.forEach((item) => categories.add(item));

  if (value.includes('push') || value.includes('chest') || value.includes('shoulder') || value.includes('tricep')) {
    add('chest', 'shoulders', 'arms');
  }
  if (value.includes('pull') || value.includes('back') || value.includes('bicep')) {
    add('back', 'arms');
  }
  if (value.includes('leg') || value.includes('lower')) {
    add('legs', 'calves');
  }
  if (value.includes('upper')) {
    add('chest', 'back', 'shoulders', 'arms');
  }
  if (value.includes('full') || value.includes('body')) {
    add(...(EXERCISE_CATEGORY_IDS as ExerciseCategory[]));
  }

  return [...categories];
}

function sortNewest(sessions: Session[]): Session[] {
  return sessions
    .slice()
    .sort((a, b) => b.date.localeCompare(a.date) || b.updatedAt.localeCompare(a.updatedAt));
}

function buildCandidates(
  focusSessions: Session[],
  catalogue: Exercise[],
  focus: string,
): Candidate[] {
  const byId = new Map(catalogue.map((exercise) => [exercise.id, exercise]));
  const candidates: Candidate[] = [];
  const seen = new Set<string>();

  const add = (exercise: Exercise) => {
    if (candidates.length >= 40 || seen.has(exercise.id)) return;
    seen.add(exercise.id);
    candidates.push({
      exerciseId: exercise.id,
      name: exercise.name,
      primaryMuscles: exercise.primaryMuscles,
      secondaryMuscles: exercise.secondaryMuscles,
      equipment: exercise.equipment,
    });
  };

  const addSnapshot = (row: SessionExercise) => {
    if (candidates.length >= 40 || seen.has(row.exerciseId)) return;
    seen.add(row.exerciseId);
    candidates.push({
      exerciseId: row.exerciseId,
      name: row.name,
      primaryMuscles: row.primaryMuscles,
      secondaryMuscles: row.secondaryMuscles,
      equipment: [],
    });
  };

  const muscles = new Set<MuscleGroupId>();
  for (const session of focusSessions) {
    for (const row of session.exercises) {
      const exercise = byId.get(row.exerciseId);
      if (exercise) add(exercise);
      else addSnapshot(row);
      row.primaryMuscles.forEach((muscle) => muscles.add(muscle));
    }
  }

  for (const exercise of catalogue) {
    if (exercise.primaryMuscles.some((muscle) => muscles.has(muscle))) add(exercise);
  }

  const categories = new Set(focusCategories(focus));
  if (categories.size > 0) {
    for (const exercise of catalogue) {
      if (categories.has(exercise.category)) add(exercise);
    }
  }

  return candidates;
}

/** Shared by GET /context and the read-only MCP `get_context` tool. */
export async function buildContextReport(space: Space, date: IsoDate) {
  const sessions = entitiesByKind<Session>(space, 'session');
  const routine = readRoutine(space);

  const slot = routine ? resolveSlot(routine, date) : null;
  const focus = slot?.kind === 'workout' ? slot.focus : '';

  const outcome = sortNewest(
    sessions.filter(
      (session) =>
        session.date <= date && (session.status === 'completed' || session.status === 'skipped'),
    ),
  );

  const sameFocus = focus
    ? outcome.filter(
        (session) => session.focus.trim().toLocaleLowerCase() === focus.trim().toLocaleLowerCase(),
      )
    : [];

  const recent = (sameFocus.length > 0 ? sameFocus : outcome).slice(0, 6);
  const recentSessions: RecentSession[] = recent.map((session) => ({
    date: session.date,
    focus: session.focus,
    status: session.status === 'completed' ? 'completed' : 'skipped',
    exercises: recentExercises(session),
  }));

  const prs = computePrs(sessions);
  const prsByExercise = new Map<string, Record<string, number>>();
  for (const entry of prs) {
    const map = prsByExercise.get(entry.exerciseId) ?? {};
    map[String(entry.reps)] = entry.weight;
    prsByExercise.set(entry.exerciseId, map);
  }

  const custom = readCustomExercises(space);
  const catalogue = await loadCatalogue(custom);
  const catalogueById = new Map(catalogue.map((exercise) => [exercise.id, exercise]));

  const seenStats = new Set<string>();
  const exerciseStats: ExerciseStats[] = [];

  for (const session of recent) {
    for (const row of session.exercises) {
      if (exerciseStats.length >= 20) break;
      if (seenStats.has(row.exerciseId)) continue;
      seenStats.add(row.exerciseId);

      const exercise = catalogueById.get(row.exerciseId);
      const last = lastPerformance(sessions, row.exerciseId, date);
      const trend = exerciseHistory(sessions, row.exerciseId)
        .filter((point) => point.date <= date)
        .slice(-3)
        .map((point) => point.volume);

      exerciseStats.push({
        exerciseId: row.exerciseId,
        name: row.name || exercise?.name || row.exerciseId,
        primaryMuscles: row.primaryMuscles.length > 0 ? row.primaryMuscles : exercise?.primaryMuscles ?? [],
        last: last ? { date: last.date, sets: last.sets.map((set) => ({ weight: set.weight, reps: set.reps })) } : null,
        prs: prsByExercise.get(row.exerciseId) ?? {},
        volumeTrend: trend,
      });
    }
    if (exerciseStats.length >= 20) break;
  }

  const report = {
    version: 1,
    date,
    generatedAt: new Date().toISOString(),
    routine:
      routine && slot
        ? {
            id: routine.id,
            name: routine.name,
            weekIndex: slot.weekIndex,
            weekday: slot.weekday,
            focus: slot.focus,
            isRest: slot.kind === 'rest',
          }
        : null,
    recentSessions,
    exerciseStats,
    candidates: buildCandidates(sameFocus.slice(0, 6), catalogue, focus),
    muscleVolume: muscleWeeks(sessions, 8, date).map((week) => ({
      week: week.week,
      muscles: week.muscles,
    })),
    adherence: (() => {
      const summary = adherence(sessions, 8, date).summary;
      return {
        weeks: summary.weeks,
        scheduled: summary.scheduled,
        completed: summary.completed,
        skipped: summary.skipped,
        rate: summary.rate,
      };
    })(),
  };

  return report;
}

export async function contextHandler(req: Request, res: Response): Promise<void> {
  const rawDate = req.query.date;
  let date = relayToday();

  if (rawDate !== undefined) {
    if (typeof rawDate !== 'string' || !isValidIsoDate(rawDate)) {
      fail(400, 'invalid_date', 'date must be a calendar date in YYYY-MM-DD format.', { field: 'date' });
    }
    date = rawDate;
  }

  const { user, keys } = (req as ApiRequest).apiAuth;
  const space = await openSpace(user, keys);
  res.json(await buildContextReport(space, date));
}
