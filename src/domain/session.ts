import type {
  IsoDate,
  IsoDateTime,
  Routine,
  Session,
  SessionSource,
  SessionStatus,
  SetLog,
} from './types';
import { addDays, todayIso } from './date';
import { resolveSlot, type ResolvedSlot } from './routine';

export const BACKFILL_DAYS = 13;

export interface SessionBootstrapPlan {
  creates: Session[];
  updates: Session[];
}

export type DerivedSessionStatus = SessionStatus | 'in-progress';

function nowIso(now: Date): IsoDateTime {
  return now.toISOString();
}

export function createSessionForSlot(
  slot: ResolvedSlot,
  routine: Routine,
  status: SessionStatus,
  source: SessionSource,
  now = new Date(),
): Session {
  const timestamp = nowIso(now);
  return {
    id: crypto.randomUUID(),
    date: slot.date,
    routineId: routine.id,
    routineName: routine.name,
    weekIndex: slot.weekIndex,
    weekday: slot.weekday,
    focus: slot.focus.trim() || 'Workout',
    status,
    source,
    exercises: [],
    notes: '',
    rating: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    completedAt: null,
    skippedAt: status === 'skipped' ? timestamp : null,
  };
}

/**
 * Computes the sessions bootstrap would create or mark skipped. Pure: callers
 * persist the plan inside one date-guarded transaction.
 */
export function planSessionBootstrap(
  routine: Routine | null,
  sessions: Session[],
  today: IsoDate = todayIso(),
  now = new Date(),
): SessionBootstrapPlan {
  const creates: Session[] = [];
  const updates: Session[] = [];
  const byDate = new Map(sessions.map((session) => [session.date, session]));

  if (routine?.active) {
    const anchor = routine.startDate;
    const first = anchor > addDays(today, -BACKFILL_DAYS) ? anchor : addDays(today, -BACKFILL_DAYS);
    let date = first;

    while (date < today) {
      if (!byDate.has(date)) {
        const slot = resolveSlot(routine, date);
        if (slot?.kind === 'workout') {
          const session = createSessionForSlot(slot, routine, 'skipped', 'auto', now);
          creates.push(session);
          byDate.set(date, session);
        }
      }
      date = addDays(date, 1);
    }

    if (!byDate.has(today)) {
      const slot = resolveSlot(routine, today);
      if (slot?.kind === 'workout') {
        creates.push(createSessionForSlot(slot, routine, 'planned', 'auto', now));
      }
    }
  }

  const timestamp = nowIso(now);
  for (const session of sessions) {
    if (session.status === 'planned' && session.date < today) {
      updates.push({
        ...session,
        status: 'skipped',
        skippedAt: timestamp,
        updatedAt: timestamp,
      });
    }
  }

  return { creates, updates };
}

export function deriveSessionStatus(session: Session): DerivedSessionStatus {
  if (session.status !== 'planned') return session.status;
  return session.exercises.some((exercise) => exercise.sets.length > 0) ? 'in-progress' : 'planned';
}

export function isSessionEditable(session: Session, today: IsoDate = todayIso()): boolean {
  return session.date === today && session.status !== 'skipped';
}

/** Future planned sessions accept exercise planning, but never set logging. */
export function isSessionPlanEditable(
  session: Session,
  today: IsoDate = todayIso(),
): boolean {
  return session.date >= today && session.status === 'planned';
}

export function sessionSetCount(session: Session): number {
  return session.exercises.reduce((total, exercise) => total + exercise.sets.length, 0);
}

export function sessionTargetSets(session: Session): number {
  return session.exercises.reduce((total, exercise) => total + exercise.targetSets, 0);
}

export function sessionVolume(session: Session): number {
  const total = session.exercises.reduce(
    (sum, exercise) => sum + exercise.sets.reduce((setSum, set) => setSum + set.weight * set.reps, 0),
    0,
  );
  return Math.round(total * 100) / 100;
}

export function trainedExerciseCount(session: Session): number {
  return session.exercises.filter((exercise) => exercise.sets.length > 0).length;
}

export interface LastPerformance {
  date: IsoDate;
  sets: SetLog[];
}

/** Most recent completed performance of an exercise, excluding today. */
export function lastPerformance(
  sessions: Session[],
  exerciseId: string,
  today: IsoDate = todayIso(),
): LastPerformance | null {
  const completed = sessions
    .filter((session) => session.status === 'completed' && session.date < today)
    .sort((a, b) => b.date.localeCompare(a.date) || b.updatedAt.localeCompare(a.updatedAt));

  for (const session of completed) {
    const row = session.exercises.find(
      (exercise) => exercise.exerciseId === exerciseId && exercise.sets.length > 0,
    );
    if (row) return { date: session.date, sets: row.sets.slice(0, 3) };
  }

  return null;
}
