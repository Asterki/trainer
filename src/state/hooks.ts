/** Small UI hooks shared across the shell. */

import { useEffect, useMemo, useState } from 'react';
import { todayIso } from '../domain/date';
import { sessionSummaries, type SessionSummary } from '../domain/metrics';
import { resolveSlot, type ResolvedSlot } from '../domain/routine';
import { lastPerformance, type LastPerformance } from '../domain/session';
import type { IsoDate, Routine, Session } from '../domain/types';
import { useTrainer } from './store';

/** Returns `value` only after it has stopped changing for `delay` ms. */
export function useDebouncedValue<T>(value: T, delay = 200): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

/** Reactive CSS media query. */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window === 'undefined' ? false : window.matchMedia(query).matches,
  );

  useEffect(() => {
    const list = window.matchMedia(query);
    const listener = (event: MediaQueryListEvent) => setMatches(event.matches);
    setMatches(list.matches);
    list.addEventListener('change', listener);
    return () => list.removeEventListener('change', listener);
  }, [query]);

  return matches;
}

/** The routine currently scheduling sessions, if any. */
export function useActiveRoutine(): Routine | null {
  const { routines } = useTrainer();
  return useMemo(() => routines.find((routine) => routine.active) ?? null, [routines]);
}

/** A routine by id, or null when it no longer exists. */
export function useRoutine(id: string | null): Routine | null {
  const { routines } = useTrainer();
  return useMemo(
    () => (id === null ? null : routines.find((routine) => routine.id === id) ?? null),
    [id, routines],
  );
}

export function useSessionByDate(date: IsoDate | null): Session | null {
  const { sessions } = useTrainer();
  return useMemo(
    () => (date === null ? null : sessions.find((session) => session.date === date) ?? null),
    [date, sessions],
  );
}

export function useTodaySession(date: IsoDate = todayIso()): Session | null {
  return useSessionByDate(date);
}

export function useTodaySlot(): ResolvedSlot | null {
  const routine = useActiveRoutine();
  return useMemo(() => (routine ? resolveSlot(routine, todayIso()) : null), [routine]);
}

export function useLastPerformance(exerciseId: string): LastPerformance | null {
  const { sessions } = useTrainer();
  return useMemo(() => lastPerformance(sessions, exerciseId), [exerciseId, sessions]);
}

/** Sets, volume and exercise counts by session id. */
export function useSessionSummaries(): Map<string, SessionSummary> {
  const { sessions } = useTrainer();
  return useMemo(() => sessionSummaries(sessions), [sessions]);
}

/** Completed sessions containing each exercise, newest first. */
export function useExerciseIndex(): Map<string, Session[]> {
  const { sessions } = useTrainer();
  return useMemo(() => {
    const index = new Map<string, Session[]>();
    const completed = sessions
      .filter((session) => session.status === 'completed')
      .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));

    for (const session of completed) {
      const seen = new Set<string>();
      for (const row of session.exercises) {
        if (seen.has(row.exerciseId)) continue;
        seen.add(row.exerciseId);
        const rows = index.get(row.exerciseId) ?? [];
        rows.push(session);
        index.set(row.exerciseId, rows);
      }
    }
    return index;
  }, [sessions]);
}
