/**
 * Seeded wger catalogue and exercise search.
 *
 * The JSON is imported dynamically so the 300-row catalogue is a separate
 * chunk. It is loaded on first use, cached for the session and never written
 * to IndexedDB; only custom exercises live in the database.
 */

import type { EquipmentId, Exercise, ExerciseCategory, MuscleGroupId } from '../types';

interface CatalogueRow {
  wgerId: number;
  name: string;
  category: ExerciseCategory;
  primary: MuscleGroupId[];
  secondary: MuscleGroupId[];
  equipment: EquipmentId[];
  instructions: string;
}

export interface ExerciseSearchQuery {
  query?: string;
  muscle?: MuscleGroupId | null;
  equipment?: EquipmentId | null;
  category?: ExerciseCategory | null;
  limit?: number;
}

interface IndexedExercise {
  exercise: Exercise;
  name: string;
  aliases: string[];
}

const indexCache = new WeakMap<Exercise[], IndexedExercise[]>();
let seededPromise: Promise<Exercise[]> | null = null;

/** Lower-case, strip diacritics and punctuation, collapse whitespace. */
export function normalizeExerciseText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function fromRow(row: CatalogueRow): Exercise {
  return {
    id: `wger:${row.wgerId}`,
    name: row.name,
    aliases: [],
    category: row.category,
    primaryMuscles: row.primary,
    secondaryMuscles: row.secondary,
    equipment: row.equipment,
    instructions: row.instructions,
    source: 'wger',
    createdAt: null,
  };
}

async function loadSeeded(): Promise<Exercise[]> {
  if (!seededPromise) {
    seededPromise = import('./wger-exercises.json').then((module) => {
      const rows = (module.default ?? module) as unknown as CatalogueRow[];
      return rows.map(fromRow);
    });
  }
  return seededPromise;
}

/** Seeded rows merged with custom rows supplied by the store. */
export async function loadCatalogue(customExercises: Exercise[] = []): Promise<Exercise[]> {
  const seeded = await loadSeeded();
  if (customExercises.length === 0) return seeded;

  const merged = new Map<string, Exercise>();
  for (const exercise of seeded) merged.set(exercise.id, exercise);
  for (const exercise of customExercises) merged.set(exercise.id, exercise);
  return [...merged.values()];
}

function indexed(exercises: Exercise[]): IndexedExercise[] {
  const cached = indexCache.get(exercises);
  if (cached) return cached;
  const rows = exercises.map((exercise) => ({
    exercise,
    name: normalizeExerciseText(exercise.name),
    aliases: exercise.aliases.map(normalizeExerciseText).filter(Boolean),
  }));
  indexCache.set(exercises, rows);
  return rows;
}

function matchScore(value: string, query: string): number {
  if (!query) return 0;
  if (value === query) return 4;
  if (value.startsWith(query)) return 3;
  if (value.includes(` ${query}`)) return 2;
  if (value.includes(query)) return 1;
  return -1;
}

function bestScore(value: string, aliases: string[], query: string): number {
  if (!query) return 0;
  let score = matchScore(value, query);
  for (const alias of aliases) {
    const aliasScore = matchScore(alias, query);
    // Alias hits rank just below the equivalent name hit.
    if (aliasScore > 0) score = Math.max(score, aliasScore - 0.1);
  }
  return score;
}

export function searchExercises(
  exercises: Exercise[],
  { query = '', muscle, equipment, category, limit = 50 }: ExerciseSearchQuery = {},
): Exercise[] {
  const normalizedQuery = normalizeExerciseText(query);
  const results: Array<{ exercise: Exercise; score: number }> = [];

  for (const row of indexed(exercises)) {
    const exercise = row.exercise;
    if (muscle && !exercise.primaryMuscles.includes(muscle) && !exercise.secondaryMuscles.includes(muscle)) {
      continue;
    }
    if (equipment && !exercise.equipment.includes(equipment)) continue;
    if (category && exercise.category !== category) continue;

    const score = bestScore(row.name, row.aliases, normalizedQuery);
    if (normalizedQuery && score < 0) continue;
    results.push({ exercise, score });
  }

  results.sort(
    (a, b) =>
      b.score - a.score ||
      a.exercise.name.localeCompare(b.exercise.name, undefined, { sensitivity: 'base' }),
  );

  return results.slice(0, Math.max(0, limit)).map((result) => result.exercise);
}

export function getExerciseById(exercises: Exercise[], exerciseId: string): Exercise | undefined {
  return exercises.find((exercise) => exercise.id === exerciseId);
}
