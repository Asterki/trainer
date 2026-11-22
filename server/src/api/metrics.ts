import type { Request, Response } from 'express';
import { entitiesByKind, openSpace } from '../space/store.js';
import type { ApiRequest } from './auth.js';
import { fail } from './errors.js';
import { computePrs, muscleWeeks, prsForExercise } from '../trainer/metrics.js';
import type { Session } from '../trainer/types.js';
import { relayToday } from './time.js';

export async function prsHandler(req: Request, res: Response): Promise<void> {
  const exerciseId = req.query.exerciseId;
  if (exerciseId !== undefined && (typeof exerciseId !== 'string' || exerciseId.length < 1)) {
    fail(400, 'invalid_query', 'exerciseId must be a non-empty string.', { field: 'exerciseId' });
  }

  const { user, keys } = (req as ApiRequest).apiAuth;
  const space = await openSpace(user, keys);
  const sessions = entitiesByKind<Session>(space, 'session');

  res.json({
    prs: typeof exerciseId === 'string' ? prsForExercise(sessions, exerciseId) : computePrs(sessions),
  });
}

export async function muscleVolumeHandler(req: Request, res: Response): Promise<void> {
  let weeks = 12;
  if (req.query.weeks !== undefined) {
    const raw = req.query.weeks;
    if (typeof raw !== 'string' || !/^\d+$/.test(raw)) {
      fail(400, 'invalid_limit', 'weeks must be between 1 and 52.', { field: 'weeks' });
    }
    weeks = Number(raw);
    if (weeks < 1 || weeks > 52) {
      fail(400, 'invalid_limit', 'weeks must be between 1 and 52.', { field: 'weeks' });
    }
  }

  const { user, keys } = (req as ApiRequest).apiAuth;
  const space = await openSpace(user, keys);
  const sessions = entitiesByKind<Session>(space, 'session');

  res.json({ weeks: muscleWeeks(sessions, weeks, relayToday()) });
}
