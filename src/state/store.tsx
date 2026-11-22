/**
 * Single Trainer store.
 *
 * Every action follows the same path: normalize, write IndexedDB, then update
 * React state from the normalized record. Stage 7 will add outbox recording
 * after the local write.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { isoWeekday, todayIso } from '../domain/date';
import { loadCatalogue, normalizeExerciseText } from '../domain/catalogue/wger';
import {
  DEFAULT_SETTINGS,
  normalizeCustomExercise,
  normalizeCustomExercises,
  normalizeRoutine,
  normalizeRoutines,
  normalizeSessions,
  normalizeSettings,
} from '../db/normalize';
import {
  applySessionBootstrap,
  deleteDatabase,
  deleteEntity,
  ensureSettings,
  loadSnapshot,
  readSyncState,
  replaceAllData,
  requestPersistentStorage,
  setActiveRoutineAtomic,
  writeEntity,
  writeSessionNew,
} from '../db/database';
import { parseBackup } from '../domain/backup';
import { loadSyncRuntime, registerApplyHandler } from '../sync/engine';
import type { SyncConfig } from '../sync/types';
import {
  createSessionForSlot,
  isSessionEditable,
  isSessionPlanEditable,
  planSessionBootstrap,
} from '../domain/session';
import { resolveSlot } from '../domain/routine';
import type {
  BackupFile,
  CustomExerciseInput,
  CustomExercisePatch,
  Exercise,
  Routine,
  RoutineInput,
  RoutinePatch,
  IsoDate,
  Session,
  SessionExercise,
  SetLog,
  Settings,
  ThemeSetting,
} from '../domain/types';

const LEGACY_THEME_KEY = 'trainer.theme';

interface TrainerState {
  ready: boolean;
  routines: Routine[];
  sessions: Session[];
  customExercises: Exercise[];
  settings: Settings;
  error: string | null;
}

interface TrainerActions {
  updateSettings(patch: Partial<Settings>): Promise<void>;
  createRoutine(input: RoutineInput): Promise<Routine>;
  updateRoutine(id: string, patch: RoutinePatch): Promise<void>;
  deleteRoutine(id: string): Promise<void>;
  setActiveRoutine(id: string): Promise<void>;
  setRoutineActive(id: string, active: boolean): Promise<void>;
  ensureSessions(): Promise<void>;
  ensureSessionForDate(date: IsoDate): Promise<Session | null>;
  createAdHocSession(): Promise<Session>;
  updateSessionNotes(id: string, notes: string): Promise<void>;
  updateSessionRating(id: string, rating: number | null): Promise<void>;
  addSessionExercise(sessionId: string, exercise: Exercise): Promise<void>;
  updateSessionExercise(
    sessionId: string,
    exerciseRowId: string,
    patch: {
      targetSets?: number;
      targetRepMin?: number;
      targetRepMax?: number;
      note?: string;
    },
  ): Promise<void>;
  removeSessionExercise(sessionId: string, exerciseRowId: string): Promise<void>;
  moveSessionExercise(sessionId: string, exerciseRowId: string, direction: -1 | 1): Promise<void>;
  logSet(sessionId: string, exerciseRowId: string, set: SetLog): Promise<void>;
  updateSet(
    sessionId: string,
    exerciseRowId: string,
    setId: string,
    patch: Partial<SetLog>,
  ): Promise<void>;
  removeSet(sessionId: string, exerciseRowId: string, setId: string): Promise<void>;
  completeSession(id: string): Promise<void>;
  reopenSession(id: string): Promise<void>;
  createCustomExercise(input: CustomExerciseInput): Promise<Exercise>;
  updateCustomExercise(id: string, patch: CustomExercisePatch): Promise<void>;
  deleteCustomExercise(id: string): Promise<void>;
  buildBackup(): BackupFile;
  restoreBackup(file: unknown): Promise<void>;
  resetEverything(): Promise<void>;
  clearError(): void;
}

export interface TrainerContextValue extends TrainerState, TrainerActions {}

const TrainerContext = createContext<TrainerContextValue | null>(null);

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong. Try again.';
}

/** One-time migration from the temporary Stage 2 theme key. */
function consumeLegacyTheme(): ThemeSetting | null {
  try {
    const stored = localStorage.getItem(LEGACY_THEME_KEY);
    if (stored !== null) localStorage.removeItem(LEGACY_THEME_KEY);
    if (stored === 'dark') return 'nordic-dark';
    if (stored === 'light') return 'nordic-light';
    if (stored === 'nordic-dark' || stored === 'nordic-light') return stored;
  } catch {
    /* storage can be unavailable in private modes */
  }
  return null;
}

// React StrictMode runs the boot effect twice in development. Read and remove
// the legacy key once per page so both boots agree on the migrated theme.
let migratedTheme: ThemeSetting | null | undefined;

function initialLegacyTheme(): ThemeSetting | null {
  if (migratedTheme === undefined) migratedTheme = consumeLegacyTheme();
  return migratedTheme;
}

async function syncIsConfigured(): Promise<boolean> {
  const config = await readSyncState<SyncConfig>('app');
  return config?.enabled === true;
}

function validateCustomInput(input: CustomExerciseInput, editingId?: string): void {
  const name = input.name.trim();
  if (name.length < 2 || name.length > 80) {
    throw new Error('Exercise names must be 2–80 characters.');
  }
  if (input.primaryMuscles.length === 0) {
    throw new Error('Choose at least one primary muscle.');
  }
  const primary = new Set(input.primaryMuscles);
  if ((input.secondaryMuscles ?? []).some((muscle) => primary.has(muscle))) {
    throw new Error('Secondary muscles cannot overlap primary muscles.');
  }
  if ((input.aliases ?? []).length > 5) {
    throw new Error('Use at most 5 aliases.');
  }
  if ((input.instructions ?? '').length > 1200) {
    throw new Error('Instructions must be 1,200 characters or fewer.');
  }
  if (editingId === undefined && !name) {
    throw new Error('Give the exercise a name.');
  }
}

export function TrainerProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<TrainerState>({
    ready: false,
    routines: [],
    sessions: [],
    customExercises: [],
    settings: DEFAULT_SETTINGS,
    error: null,
  });

  const routinesRef = useRef<Routine[]>([]);
  const sessionsRef = useRef<Session[]>([]);
  const customRef = useRef<Exercise[]>([]);
  const settingsRef = useRef<Settings>(DEFAULT_SETTINGS);
  const settingsQueue = useRef<Promise<void>>(Promise.resolve());
  const bootstrapQueue = useRef<Promise<void>>(Promise.resolve());
  const sessionQueue = useRef<Promise<void>>(Promise.resolve());

  const commitRoutines = useCallback((next: Routine[]) => {
    routinesRef.current = next;
    setState((current) => ({ ...current, routines: next }));
  }, []);

  const commitSessions = useCallback((next: Session[]) => {
    sessionsRef.current = next;
    setState((current) => ({ ...current, sessions: next }));
  }, []);

  const commitCustom = useCallback((next: Exercise[]) => {
    customRef.current = next;
    setState((current) => ({ ...current, customExercises: next }));
  }, []);

  const commitSettings = useCallback((next: Settings) => {
    settingsRef.current = next;
    setState((current) => ({ ...current, settings: next }));
  }, []);

  const clearError = useCallback(() => {
    setState((current) => (current.error === null ? current : { ...current, error: null }));
  }, []);

  const refreshSnapshot = useCallback(async () => {
    const snapshot = await loadSnapshot();
    routinesRef.current = snapshot.routines;
    sessionsRef.current = snapshot.sessions;
    customRef.current = snapshot.customExercises;
    settingsRef.current = snapshot.settings;
    setState({
      ready: true,
      routines: snapshot.routines,
      sessions: snapshot.sessions,
      customExercises: snapshot.customExercises,
      settings: snapshot.settings,
      error: null,
    });
  }, []);

  useEffect(() => {
    registerApplyHandler(() => {
      void refreshSnapshot().catch((error) => {
        console.warn('Could not refresh Trainer after sync', error);
      });
    });
    return () => registerApplyHandler(null);
  }, [refreshSnapshot]);

  useEffect(() => {
    let cancelled = false;
    const legacyTheme = initialLegacyTheme();

    async function boot() {
      try {
        await ensureSettings(legacyTheme ? { theme: legacyTheme } : undefined);
        const snapshot = await loadSnapshot();
        if (cancelled) return;

        routinesRef.current = snapshot.routines;
        sessionsRef.current = snapshot.sessions;
        customRef.current = snapshot.customExercises;
        settingsRef.current = snapshot.settings;
        setState({
          ready: true,
          routines: snapshot.routines,
          sessions: snapshot.sessions,
          customExercises: snapshot.customExercises,
          settings: snapshot.settings,
          error: null,
        });
        void requestPersistentStorage();
        void loadSyncRuntime().catch((error) => {
          console.warn('Could not start Trainer sync', error);
        });
      } catch (error) {
        if (cancelled) return;
        setState((current) => ({ ...current, ready: true, error: messageOf(error) }));
      }
    }

    void boot();
    return () => {
      cancelled = true;
    };
  }, []);

  const fail = useCallback((error: unknown): never => {
    const message = messageOf(error);
    setState((current) => ({ ...current, error: message }));
    throw error instanceof Error ? error : new Error(message);
  }, []);

  const runSessionMutation = useCallback((work: () => Promise<void>): Promise<void> => {
    const task = sessionQueue.current.then(work, work);
    sessionQueue.current = task.catch(() => undefined);
    return task;
  }, []);

  const mutateSession = useCallback(
    async (
      sessionId: string,
      update: (session: Session) => Session,
      allowFuturePlan = false,
    ): Promise<void> => {
      try {
        const current = sessionsRef.current.find((session) => session.id === sessionId);
        if (!current) throw new Error('That session no longer exists.');
        if (
          !isSessionEditable(current) &&
          !(allowFuturePlan && isSessionPlanEditable(current))
        ) {
          throw new Error(
            current.date !== todayIso()
              ? 'Past sessions are read-only.'
              : 'Skipped sessions are read-only.',
          );
        }
        const next = {
          ...update(current),
          id: current.id,
          date: current.date,
          updatedAt: new Date().toISOString(),
        };
        const saved = await writeEntity('session', next);
        commitSessions(
          sessionsRef.current.map((session) => (session.id === sessionId ? saved : session)),
        );
      } catch (error) {
        fail(error);
      }
    },
    [commitSessions, fail],
  );

  const ensureSessions = useCallback((): Promise<void> => {
    const task = bootstrapQueue.current.then(async () => {
      try {
        const active = routinesRef.current.find((routine) => routine.active) ?? null;
        const plan = planSessionBootstrap(active, sessionsRef.current);
        // Always reread the sessions store: bootstrap doubles as the visibility
        // refresh, so another tab's writes cannot leave this screen stale.
        const sessions = await applySessionBootstrap(plan.creates, plan.updates);
        commitSessions(sessions);
      } catch (error) {
        fail(error);
      }
    });
    bootstrapQueue.current = task.catch(() => undefined);
    return task;
  }, [commitSessions, fail]);

  const ensureSessionForDate = useCallback(
    async (date: IsoDate): Promise<Session | null> => {
      try {
        const existing = sessionsRef.current.find((session) => session.date === date);
        if (existing) return existing;
        if (date < todayIso()) return null;
        const routine = routinesRef.current.find((item) => item.active);
        const slot = routine ? resolveSlot(routine, date) : null;
        if (!routine || slot?.kind !== 'workout') return null;
        const session = createSessionForSlot(slot, routine, 'planned', 'auto');
        const saved = await writeSessionNew(session);
        commitSessions([...sessionsRef.current, saved]);
        return saved;
      } catch (error) {
        fail(error);
        return null;
      }
    },
    [commitSessions, fail],
  );

  const createAdHocSession = useCallback(async (): Promise<Session> => {
    try {
      const date = todayIso();
      if (sessionsRef.current.some((session) => session.date === date)) {
        throw new Error('A session already exists for today.');
      }
      const timestamp = new Date().toISOString();
      const session: Session = {
        id: crypto.randomUUID(),
        date,
        routineId: null,
        routineName: 'Ad-hoc',
        weekIndex: null,
        weekday: isoWeekday(date),
        focus: 'Ad-hoc',
        status: 'planned',
        source: 'manual',
        exercises: [],
        notes: '',
        rating: null,
        createdAt: timestamp,
        updatedAt: timestamp,
        completedAt: null,
        skippedAt: null,
      };
      const saved = await writeSessionNew(session);
      commitSessions([...sessionsRef.current, saved]);
      return saved;
    } catch (error) {
      return fail(error);
    }
  }, [commitSessions, fail]);

  const updateSessionNotes = useCallback(
    (sessionId: string, notes: string) =>
      runSessionMutation(() => mutateSession(sessionId, (session) => ({ ...session, notes }))),
    [mutateSession, runSessionMutation],
  );

  const updateSessionRating = useCallback(
    (sessionId: string, rating: number | null) =>
      runSessionMutation(() =>
        mutateSession(sessionId, (session) => ({
          ...session,
          rating:
            rating === null ? null : Math.min(5, Math.max(1, Math.round(rating))),
        })),
      ),
    [mutateSession, runSessionMutation],
  );

  const addSessionExercise = useCallback(
    (sessionId: string, exercise: Exercise) =>
      runSessionMutation(() =>
        mutateSession(sessionId, (session) => {
          if (session.exercises.some((row) => row.exerciseId === exercise.id)) {
            throw new Error('That exercise is already in this session.');
          }
          const row: SessionExercise = {
            id: crypto.randomUUID(),
            exerciseId: exercise.id,
            name: exercise.name,
            primaryMuscles: exercise.primaryMuscles,
            secondaryMuscles: exercise.secondaryMuscles,
            order: session.exercises.length,
            targetSets: 3,
            targetRepMin: 8,
            targetRepMax: 12,
            note: '',
            sets: [],
          };
          return { ...session, exercises: [...session.exercises, row] };
        }, true),
      ),
    [mutateSession, runSessionMutation],
  );

  const updateSessionExercise = useCallback(
    (
      sessionId: string,
      exerciseRowId: string,
      patch: {
        targetSets?: number;
        targetRepMin?: number;
        targetRepMax?: number;
        note?: string;
      },
    ) =>
      runSessionMutation(() =>
        mutateSession(sessionId, (session) => ({
          ...session,
          exercises: session.exercises.map((row) =>
            row.id === exerciseRowId ? { ...row, ...patch } : row,
          ),
        }), true),
      ),
    [mutateSession, runSessionMutation],
  );

  const removeSessionExercise = useCallback(
    (sessionId: string, exerciseRowId: string) =>
      runSessionMutation(() =>
        mutateSession(sessionId, (session) => ({
          ...session,
          exercises: session.exercises
            .filter((row) => row.id !== exerciseRowId)
            .map((row, index) => ({ ...row, order: index })),
        }), true),
      ),
    [mutateSession, runSessionMutation],
  );

  const moveSessionExercise = useCallback(
    (sessionId: string, exerciseRowId: string, direction: -1 | 1) =>
      runSessionMutation(() =>
        mutateSession(sessionId, (session) => {
          const rows = [...session.exercises].sort((a, b) => a.order - b.order);
          const index = rows.findIndex((row) => row.id === exerciseRowId);
          const target = index + direction;
          if (index < 0 || target < 0 || target >= rows.length) return session;
          const [row] = rows.splice(index, 1);
          rows.splice(target, 0, row);
          return {
            ...session,
            exercises: rows.map((item, order) => ({ ...item, order })),
          };
        }, true),
      ),
    [mutateSession, runSessionMutation],
  );

  const logSet = useCallback(
    (sessionId: string, exerciseRowId: string, set: SetLog) =>
      runSessionMutation(() =>
        mutateSession(sessionId, (session) => {
          if (!Number.isInteger(set.reps) || set.reps < 1 || set.reps > 999) {
            throw new Error('Reps must be a whole number between 1 and 999.');
          }
          const nextSet: SetLog = {
            id: set.id || crypto.randomUUID(),
            weight: set.weight,
            reps: set.reps,
          };
          return {
            ...session,
            exercises: session.exercises.map((row) => {
              if (row.id !== exerciseRowId) return row;
              const exists = row.sets.some((item) => item.id === nextSet.id);
              return {
                ...row,
                sets: exists
                  ? row.sets.map((item) => (item.id === nextSet.id ? nextSet : item))
                  : [...row.sets, nextSet],
              };
            }),
          };
        }),
      ),
    [mutateSession, runSessionMutation],
  );

  const updateSet = useCallback(
    (sessionId: string, exerciseRowId: string, setId: string, patch: Partial<SetLog>) =>
      runSessionMutation(() =>
        mutateSession(sessionId, (session) => ({
          ...session,
          exercises: session.exercises.map((row) =>
            row.id === exerciseRowId
              ? {
                  ...row,
                  sets: row.sets.map((set) => {
                    if (set.id !== setId) return set;
                    const next = { ...set, ...patch, id: set.id };
                    if (!Number.isInteger(next.reps) || next.reps < 1 || next.reps > 999) {
                      throw new Error('Reps must be a whole number between 1 and 999.');
                    }
                    return next;
                  }),
                }
              : row,
          ),
        })),
      ),
    [mutateSession, runSessionMutation],
  );

  const removeSet = useCallback(
    (sessionId: string, exerciseRowId: string, setId: string) =>
      runSessionMutation(() =>
        mutateSession(sessionId, (session) => ({
          ...session,
          exercises: session.exercises.map((row) =>
            row.id === exerciseRowId
              ? { ...row, sets: row.sets.filter((set) => set.id !== setId) }
              : row,
          ),
        })),
      ),
    [mutateSession, runSessionMutation],
  );

  const completeSession = useCallback(
    (sessionId: string) =>
      runSessionMutation(() =>
        mutateSession(sessionId, (session) => ({
          ...session,
          status: 'completed',
          completedAt: new Date().toISOString(),
          skippedAt: null,
        })),
      ),
    [mutateSession, runSessionMutation],
  );

  const reopenSession = useCallback(
    (sessionId: string) =>
      runSessionMutation(() =>
        mutateSession(sessionId, (session) => {
          if (session.status !== 'completed') throw new Error('That session is not completed.');
          return { ...session, status: 'planned', completedAt: null };
        }),
      ),
    [mutateSession, runSessionMutation],
  );

  const updateSettings = useCallback(
    (patch: Partial<Settings>): Promise<void> => {
      // Serialize rapid toggles so each patch reads the previous committed value.
      const task = settingsQueue.current.then(async () => {
        try {
          const next = normalizeSettings({ ...settingsRef.current, ...patch });
          const saved = await writeEntity('settings', next);
          commitSettings(saved);
        } catch (error) {
          fail(error);
        }
      });
      settingsQueue.current = task.catch(() => undefined);
      return task;
    },
    [commitSettings, fail],
  );

  const createRoutine = useCallback(
    async (input: RoutineInput): Promise<Routine> => {
      try {
        const now = new Date().toISOString();
        const routine = normalizeRoutine({
          id: crypto.randomUUID(),
          name: input.name,
          notes: input.notes ?? '',
          startDate: input.startDate ?? todayIso(),
          weekCount: input.weekCount ?? 1,
          slots: input.slots ?? [],
          active: false,
          createdAt: now,
          updatedAt: now,
        });
        const saved = await writeEntity('routine', routine);
        commitRoutines([...routinesRef.current, saved]);
        return saved;
      } catch (error) {
        return fail(error);
      }
    },
    [commitRoutines, fail],
  );

  const updateRoutine = useCallback(
    async (routineId: string, patch: RoutinePatch) => {
      try {
        const current = routinesRef.current.find((routine) => routine.id === routineId);
        if (!current) throw new Error('That routine no longer exists.');
        const next = normalizeRoutine({
          ...current,
          ...patch,
          id: current.id,
          updatedAt: new Date().toISOString(),
        });
        const saved = await writeEntity('routine', next);
        commitRoutines(
          routinesRef.current.map((routine) => (routine.id === routineId ? saved : routine)),
        );
      } catch (error) {
        fail(error);
      }
    },
    [commitRoutines, fail],
  );

  const deleteRoutine = useCallback(
    async (routineId: string) => {
      try {
        await deleteEntity('routine', routineId);
        commitRoutines(routinesRef.current.filter((routine) => routine.id !== routineId));
      } catch (error) {
        fail(error);
      }
    },
    [commitRoutines, fail],
  );

  const setActiveRoutine = useCallback(
    async (routineId: string) => {
      try {
        const next = await setActiveRoutineAtomic(routineId);
        commitRoutines(next);
      } catch (error) {
        fail(error);
      }
    },
    [commitRoutines, fail],
  );

  const setRoutineActive = useCallback(
    async (routineId: string, active: boolean) => {
      if (active) {
        await setActiveRoutine(routineId);
        return;
      }
      try {
        const current = routinesRef.current.find((routine) => routine.id === routineId);
        if (!current) throw new Error('That routine no longer exists.');
        const next = normalizeRoutine({
          ...current,
          active: false,
          updatedAt: new Date().toISOString(),
        });
        const saved = await writeEntity('routine', next);
        commitRoutines(
          routinesRef.current.map((routine) => (routine.id === routineId ? saved : routine)),
        );
      } catch (error) {
        fail(error);
      }
    },
    [commitRoutines, fail, setActiveRoutine],
  );

  const checkNameConflict = useCallback(async (name: string, editingId?: string) => {
    const candidate = normalizeExerciseText(name);
    const catalogue = await loadCatalogue(customRef.current);
    const conflict = catalogue.find(
      (exercise) =>
        exercise.id !== editingId && normalizeExerciseText(exercise.name) === candidate,
    );
    if (conflict) {
      throw new Error(
        `"${conflict.name}" already exists${conflict.source === 'wger' ? ' in the catalogue' : ''}.`,
      );
    }
  }, []);

  const createCustomExercise = useCallback(
    async (input: CustomExerciseInput): Promise<Exercise> => {
      try {
        validateCustomInput(input);
        await checkNameConflict(input.name);
        const exercise = normalizeCustomExercise({
          ...input,
          id: crypto.randomUUID(),
          source: 'custom',
          createdAt: new Date().toISOString(),
        });
        const saved = await writeEntity('exercise', exercise);
        commitCustom([...customRef.current, saved]);
        return saved;
      } catch (error) {
        return fail(error);
      }
    },
    [checkNameConflict, commitCustom, fail],
  );

  const updateCustomExercise = useCallback(
    async (exerciseId: string, patch: CustomExercisePatch) => {
      try {
        const current = customRef.current.find((exercise) => exercise.id === exerciseId);
        if (!current) throw new Error('That custom exercise no longer exists.');

        const merged: CustomExerciseInput = {
          name: patch.name ?? current.name,
          category: patch.category ?? current.category,
          primaryMuscles: patch.primaryMuscles ?? current.primaryMuscles,
          secondaryMuscles: patch.secondaryMuscles ?? current.secondaryMuscles,
          equipment: patch.equipment ?? current.equipment,
          instructions: patch.instructions ?? current.instructions,
          aliases: patch.aliases ?? current.aliases,
        };
        validateCustomInput(merged, exerciseId);
        if (normalizeExerciseText(merged.name) !== normalizeExerciseText(current.name)) {
          await checkNameConflict(merged.name, exerciseId);
        }

        const next = normalizeCustomExercise({
          ...current,
          ...merged,
          id: current.id,
          source: 'custom',
          createdAt: current.createdAt,
        });
        const saved = await writeEntity('exercise', next);
        commitCustom(
          customRef.current.map((exercise) => (exercise.id === exerciseId ? saved : exercise)),
        );
      } catch (error) {
        fail(error);
      }
    },
    [checkNameConflict, commitCustom, fail],
  );

  const deleteCustomExercise = useCallback(
    async (exerciseId: string) => {
      try {
        await deleteEntity('exercise', exerciseId);
        commitCustom(customRef.current.filter((exercise) => exercise.id !== exerciseId));
      } catch (error) {
        fail(error);
      }
    },
    [commitCustom, fail],
  );

  const buildBackup = useCallback((): BackupFile => {
    return {
      app: 'trainer',
      version: 1,
      exportedAt: new Date().toISOString(),
      routines: routinesRef.current.map((routine) => ({ ...routine, slots: routine.slots.map((slot) => ({ ...slot })) })),
      sessions: sessionsRef.current,
      customExercises: customRef.current,
      settings: { ...settingsRef.current },
    };
  }, []);

  const restoreBackup = useCallback(
    async (file: unknown) => {
      try {
        if (await syncIsConfigured()) {
          throw new Error('Disconnect sync before importing a backup.');
        }
        const backup = parseBackup(file);
        const routines = normalizeRoutines(backup.routines);
        const sessions = normalizeSessions(backup.sessions);
        const customExercises = normalizeCustomExercises(backup.customExercises);
        const settings = normalizeSettings(backup.settings);

        await replaceAllData({ routines, sessions, customExercises, settings });

        routinesRef.current = routines;
        sessionsRef.current = sessions;
        customRef.current = customExercises;
        settingsRef.current = settings;
        setState({
          ready: true,
          routines,
          sessions,
          customExercises,
          settings,
          error: null,
        });
        void ensureSessions().catch(() => undefined);
      } catch (error) {
        fail(error);
      }
    },
    [ensureSessions, fail],
  );

  const resetEverything = useCallback(async () => {
    try {
      await deleteDatabase();
      try {
        for (const key of Object.keys(localStorage)) {
          if (key.startsWith('trainer.sync') || key === LEGACY_THEME_KEY) {
            localStorage.removeItem(key);
          }
        }
      } catch {
        /* storage can be unavailable */
      }
      window.location.reload();
    } catch (error) {
      fail(error);
    }
  }, [fail]);

  const value = useMemo<TrainerContextValue>(
    () => ({
      ...state,
      updateSettings,
      createRoutine,
      updateRoutine,
      deleteRoutine,
      setActiveRoutine,
      setRoutineActive,
      ensureSessions,
      ensureSessionForDate,
      createAdHocSession,
      updateSessionNotes,
      updateSessionRating,
      addSessionExercise,
      updateSessionExercise,
      removeSessionExercise,
      moveSessionExercise,
      logSet,
      updateSet,
      removeSet,
      completeSession,
      reopenSession,
      createCustomExercise,
      updateCustomExercise,
      deleteCustomExercise,
      buildBackup,
      restoreBackup,
      resetEverything,
      clearError,
    }),
    [
      state,
      updateSettings,
      createRoutine,
      updateRoutine,
      deleteRoutine,
      setActiveRoutine,
      setRoutineActive,
      ensureSessions,
      ensureSessionForDate,
      createAdHocSession,
      updateSessionNotes,
      updateSessionRating,
      addSessionExercise,
      updateSessionExercise,
      removeSessionExercise,
      moveSessionExercise,
      logSet,
      updateSet,
      removeSet,
      completeSession,
      reopenSession,
      createCustomExercise,
      updateCustomExercise,
      deleteCustomExercise,
      buildBackup,
      restoreBackup,
      resetEverything,
      clearError,
    ],
  );

  return <TrainerContext.Provider value={value}>{children}</TrainerContext.Provider>;
}

export function useTrainer(): TrainerContextValue {
  const context = useContext(TrainerContext);
  if (!context) throw new Error('useTrainer must be used inside TrainerProvider.');
  return context;
}
