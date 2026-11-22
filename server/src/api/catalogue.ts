import type { Request, Response } from 'express';
import { openSpace, readCustomExercises } from '../space/store.js';
import type { ApiRequest } from './auth.js';
import { fail } from './errors.js';
import {
  EQUIPMENT_IDS,
  EXERCISE_CATEGORY_IDS,
  MUSCLE_GROUP_IDS,
} from '../trainer/catalogue/groups.js';
import { loadCatalogue, searchExercises } from '../trainer/catalogue/wger.js';
import type { EquipmentId, Exercise, ExerciseCategory, MuscleGroupId } from '../trainer/types.js';

const MUSCLES = new Set<string>(MUSCLE_GROUP_IDS);
const EQUIPMENT = new Set<string>(EQUIPMENT_IDS);
const CATEGORIES = new Set<string>(EXERCISE_CATEGORY_IDS);

function compact(exercise: Exercise) {
  return {
    id: exercise.id,
    name: exercise.name,
    category: exercise.category,
    primaryMuscles: exercise.primaryMuscles,
    secondaryMuscles: exercise.secondaryMuscles,
    equipment: exercise.equipment,
    source: exercise.source,
  };
}

export async function exercisesHandler(req: Request, res: Response): Promise<void> {
  const query = req.query.query;
  if (query !== undefined && (typeof query !== 'string' || query.length > 100)) {
    fail(400, 'invalid_query', 'query must be a string of at most 100 characters.', { field: 'query' });
  }

  const muscle = req.query.muscle;
  if (muscle !== undefined && (typeof muscle !== 'string' || !MUSCLES.has(muscle))) {
    fail(400, 'invalid_query', 'muscle is not a valid muscle id.', { field: 'muscle' });
  }

  const equipment = req.query.equipment;
  if (equipment !== undefined && (typeof equipment !== 'string' || !EQUIPMENT.has(equipment))) {
    fail(400, 'invalid_query', 'equipment is not a valid equipment id.', { field: 'equipment' });
  }

  const category = req.query.category;
  if (category !== undefined && (typeof category !== 'string' || !CATEGORIES.has(category))) {
    fail(400, 'invalid_query', 'category is not a valid category id.', { field: 'category' });
  }

  let limit = 50;
  if (req.query.limit !== undefined) {
    if (typeof req.query.limit !== 'string' || !/^\d+$/.test(req.query.limit)) {
      fail(400, 'invalid_limit', 'limit must be between 1 and 100.', { field: 'limit' });
    }
    limit = Number(req.query.limit);
    if (limit < 1 || limit > 100) {
      fail(400, 'invalid_limit', 'limit must be between 1 and 100.', { field: 'limit' });
    }
  }

  const { user, keys } = (req as ApiRequest).apiAuth;
  const space = await openSpace(user, keys);
  const catalogue = await loadCatalogue(readCustomExercises(space));

  const exercises = searchExercises(catalogue, {
    query: typeof query === 'string' ? query : '',
    muscle: (muscle as MuscleGroupId | undefined) ?? null,
    equipment: (equipment as EquipmentId | undefined) ?? null,
    category: (category as ExerciseCategory | undefined) ?? null,
    limit,
  }).map(compact);

  res.json({ exercises });
}
