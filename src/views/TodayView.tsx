import { useEffect, useMemo, useState } from 'react';
import { FiZap } from 'react-icons/fi';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { ExerciseInfoSheet } from '../components/ExerciseInfoSheet';
import { ExercisePickerSheet } from '../components/ExercisePickerSheet';
import { FuturePlanSheet } from '../components/FuturePlanSheet';
import { FinishBar } from '../components/FinishBar';
import { SessionDetailSheet } from '../components/SessionDetailSheet';
import { SessionExerciseCard } from '../components/SessionExerciseCard';
import { SessionStatusCard } from '../components/SessionStatusCard';
import { WeekStrip } from '../components/WeekStrip';
import { fromIsoDate } from '../domain/date';
import { loadCatalogue } from '../domain/catalogue/wger';
import { FEELINGS, sessionFeeling, trainingStreak } from '../domain/metrics';
import { resolveSlot } from '../domain/routine';
import {
  deriveSessionStatus,
  isSessionEditable,
  sessionSetCount,
} from '../domain/session';
import type { Exercise, IsoDate, SessionExercise } from '../domain/types';
import { useActiveRoutine, useSessionByDate } from '../state/hooks';
import { useTrainer } from '../state/store';

type PendingConfirm =
  | { kind: 'set'; rowId: string; setName: string; setId: string; index: number }
  | { kind: 'exercise'; rowId: string; name: string }
  | { kind: 'finish' }
  | null;

interface TodayViewProps {
  today: IsoDate;
  onBuildRoutine: () => void;
  onViewHistory: () => void;
}

export function TodayView({ today, onBuildRoutine, onViewHistory }: TodayViewProps) {
  const {
    sessions,
    customExercises,
    addSessionExercise,
    updateSessionExercise,
    removeSessionExercise,
    moveSessionExercise,
    logSet,
    updateSet,
    removeSet,
    completeSession,
    reopenSession,
    updateSessionNotes,
    updateSessionRating,
    createAdHocSession,
    ensureSessionForDate,
  } = useTrainer();
  const routine = useActiveRoutine();
  const session = useSessionByDate(today);
  const slot = routine ? resolveSlot(routine, today) : null;
  const editable = session ? isSessionEditable(session, today) : false;
  const [catalogue, setCatalogue] = useState<Exercise[]>([]);
  const [editMode, setEditMode] = useState(false);
  const [pickerDate, setPickerDate] = useState<IsoDate | null>(null);
  const [planDate, setPlanDate] = useState<IsoDate | null>(null);
  const [detailDate, setDetailDate] = useState<IsoDate | null>(null);
  const [info, setInfo] = useState<{ exercise: Exercise; row: SessionExercise } | null>(null);
  const detailSession = useSessionByDate(detailDate);
  const pickerSession = useSessionByDate(pickerDate);
  const planSession = useSessionByDate(planDate);
  const [pending, setPending] = useState<PendingConfirm>(null);
  const [saving, setSaving] = useState(0);
  const [notes, setNotes] = useState('');
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadCatalogue(customExercises)
      .then((rows) => {
        if (!cancelled) setCatalogue(rows);
      })
      .catch(() => {
        if (!cancelled) setCatalogue(customExercises);
      });
    return () => {
      cancelled = true;
    };
  }, [customExercises]);

  useEffect(() => {
    setNotes(session?.notes ?? '');
    setEditMode(false);
  }, [session?.id]);

  useEffect(() => {
    if (!session || !editable || notes === session.notes) return;
    const timer = window.setTimeout(() => {
      void updateSessionNotes(session.id, notes).catch(() => undefined);
    }, 500);
    return () => window.clearTimeout(timer);
  }, [editable, notes, session, updateSessionNotes]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 2500);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const byId = useMemo(() => new Map(catalogue.map((exercise) => [exercise.id, exercise])), [catalogue]);
  const dateLabel = useMemo(
    () =>
      new Intl.DateTimeFormat(undefined, {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
      }).format(fromIsoDate(today)),
    [today],
  );

  const sets = session ? sessionSetCount(session) : 0;
  const derived = session ? deriveSessionStatus(session) : null;
  const streak = trainingStreak(sessions, today).current;
  const readOnly = session ? !editable : false;
  const showFinish =
    Boolean(session) &&
    editable &&
    derived !== 'completed' &&
    derived !== 'skipped' &&
    session !== null;

  function handleSavingChange(delta: number) {
    setSaving((current) => Math.max(0, current + delta));
  }

  async function handleAdHoc() {
    try {
      await createAdHocSession();
      setPickerDate(today);
    } catch {
      /* The store surfaces the error. */
    }
  }

  async function openDay(date: IsoDate) {
    if (date < today) {
      setDetailDate(date);
      return;
    }
    if (date === today) return;
    const target = await ensureSessionForDate(date);
    if (target) setPlanDate(date);
  }

  async function confirmPending() {
    if (!pending || !session) {
      setPending(null);
      return;
    }
    const current = pending;
    setPending(null);
    try {
      if (current.kind === 'set') {
        await removeSet(session.id, current.rowId, current.setId);
      } else if (current.kind === 'exercise') {
        await removeSessionExercise(session.id, current.rowId);
      } else {
        await completeSession(session.id);
        setToast('Workout completed.');
      }
    } catch {
      /* The store surfaces the error. */
    }
  }

  async function handleFinish() {
    if (!session) return;
    if (sets === 0) {
      setPending({ kind: 'finish' });
      return;
    }
    try {
      await completeSession(session.id);
      setToast('Workout completed.');
    } catch {
      /* The store surfaces the error. */
    }
  }

  return (
    <div className={`view today${showFinish ? ' today--has-finish' : ''}`}>
      <header className="view__header today__header">
        <div>
          <p className="view__eyebrow">Today</p>
          <h1 className="view__title">{dateLabel}</h1>
          <p className="view__subtitle">
            {routine
              ? `${routine.name} · ${routine.weekCount}-week cycle`
              : 'No active routine yet.'}
          </p>
        </div>
        {streak > 0 && (
          <span className="streak-chip" title={`${streak} completed workouts in a row`}>
            <FiZap aria-hidden="true" /> {streak} workout streak
          </span>
        )}
      </header>

      <WeekStrip
        today={today}
        routine={routine}
        sessions={sessions}
        onSelectDate={(date) => void openDay(date)}
      />

      {toast ? (
        <p className="notice notice--ok" role="status">
          {toast}
        </p>
      ) : null}

      <div className="today__layout">
        <div className="today__main">
          <SessionStatusCard
            session={session}
            routine={routine}
            slot={slot}
            today={today}
            editMode={editMode}
            onToggleEdit={() => setEditMode((current) => !current)}
            onAddExercises={() => setPickerDate(today)}
            onLogAdHoc={() => void handleAdHoc()}
            onBuildRoutine={onBuildRoutine}
            onReopen={() => {
              if (!session) return;
              void reopenSession(session.id).catch(() => undefined);
            }}
            onViewHistory={onViewHistory}
          />

          {readOnly && session ? (
            <p className="today__lock">
              This session is read-only. Past and skipped sessions cannot be edited.
            </p>
          ) : null}

          {session?.exercises.map((row, index) => (
            <SessionExerciseCard
              key={row.id}
              row={row}
              index={index}
              count={session.exercises.length}
              exercise={byId.get(row.exerciseId)}
              editable={editable}
              editMode={editMode}
              onUpdate={(patch) => updateSessionExercise(session.id, row.id, patch)}
              onMove={(direction) => moveSessionExercise(session.id, row.id, direction)}
              onRemove={() =>
                setPending({ kind: 'exercise', rowId: row.id, name: row.name })
              }
              onLogSet={(set) => logSet(session.id, row.id, set)}
              onUpdateSet={(setId, patch) => updateSet(session.id, row.id, setId, patch)}
              onRequestRemoveSet={(set) => {
                const setIndex = row.sets.findIndex((item) => item.id === set.id);
                setPending({
                  kind: 'set',
                  rowId: row.id,
                  setId: set.id,
                  setName: row.name,
                  index: setIndex + 1,
                });
              }}
              onSavingChange={handleSavingChange}
              onOpenDetails={(exercise) => setInfo({ exercise, row })}
            />
          ))}

          {session && !session.exercises.length && derived === 'planned' ? (
            <div className="today__empty-plan card">
              <p className="card__title">No exercises yet</p>
              <p className="card__hint">
                Add exercises yourself, or leave this session for the n8n workflow to fill.
              </p>
              <button type="button" className="button" onClick={() => setPickerDate(today)}>
                Add exercises
              </button>
            </div>
          ) : null}

          {session && !readOnly ? (
            <section className="session-notes card" aria-labelledby="session-notes-title">
              <div className="session-notes__head">
                <h2 className="card__title" id="session-notes-title">
                  Session notes
                </h2>
              </div>
              <label className="field">
                <span className="visually-hidden">Session notes</span>
                <textarea
                  className="input input--textarea"
                  value={notes}
                  maxLength={2000}
                  rows={3}
                  placeholder="Sleep, energy, aches, cues…"
                  onChange={(event) => setNotes(event.target.value)}
                  onBlur={() => {
                    if (notes !== session.notes) {
                      void updateSessionNotes(session.id, notes).catch(() => undefined);
                    }
                  }}
                />
              </label>
            </section>
          ) : null}

          {session?.notes && readOnly ? (
            <section className="session-notes card">
              <h2 className="card__title">Session notes</h2>
              <p className="session-notes__readonly">{session.notes}</p>
            </section>
          ) : null}

          {session && (editable || session.rating !== null) ? (
            <section className="card session-rating" aria-labelledby="session-rating-title">
              <div className="session-notes__head">
                <h2 className="card__title" id="session-rating-title">
                  How did that leave you?
                </h2>
              </div>
              {editable ? (
                <div className="rating-scale" role="group" aria-label="How did that leave you?">
                  {FEELINGS.map((label, index) => {
                    const value = index + 1;
                    const active = session.rating === value;
                    return (
                      <button
                        key={label}
                        type="button"
                        className={`rating-scale__item${active ? ' rating-scale__item--active' : ''}`}
                        aria-pressed={active}
                        onClick={() => void updateSessionRating(session.id, active ? null : value)}
                      >
                        <span className="rating-scale__value">{value}</span>
                        <span className="rating-scale__label">{label}</span>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className="session-rating__readonly">
                  {sessionFeeling(session.rating)} · {session.rating}/5
                </p>
              )}
            </section>
          ) : null}
        </div>
      </div>

      {showFinish && (
        <FinishBar sets={sets} disabled={saving > 0} onFinish={() => void handleFinish()} />
      )}

      <FuturePlanSheet
        session={planSession}
        catalogue={byId}
        onClose={() => setPlanDate(null)}
        onAddExercise={() => setPickerDate(planDate)}
        onOpenDetails={(exercise, row) => setInfo({ exercise, row })}
      />

      <ExercisePickerSheet
        open={pickerDate !== null}
        session={pickerSession}
        onClose={() => setPickerDate(null)}
        onAdd={async (exercise) => {
          if (!pickerSession) throw new Error('No session to add to.');
          await addSessionExercise(pickerSession.id, exercise);
        }}
        onRemove={async (rowId) => {
          if (!pickerSession) throw new Error('No session to edit.');
          await removeSessionExercise(pickerSession.id, rowId);
        }}
      />

      <SessionDetailSheet session={detailSession} onClose={() => setDetailDate(null)} />

      <ExerciseInfoSheet
        exercise={info?.exercise ?? null}
        primary={info?.row.primaryMuscles ?? []}
        secondary={info?.row.secondaryMuscles ?? []}
        onClose={() => setInfo(null)}
      />

      <ConfirmDialog
        open={pending !== null}
        title={
          pending?.kind === 'set'
            ? 'Remove set?'
            : pending?.kind === 'exercise'
              ? 'Remove exercise?'
              : 'No sets logged'
        }
        confirmLabel={
          pending?.kind === 'finish'
            ? 'Mark completed'
            : pending?.kind === 'exercise'
              ? 'Remove exercise'
              : 'Remove set'
        }
        cancelLabel={pending?.kind === 'finish' ? 'Keep training' : 'Cancel'}
        tone={pending?.kind === 'finish' ? 'default' : 'danger'}
        onCancel={() => setPending(null)}
        onConfirm={() => void confirmPending()}
      >
        {pending?.kind === 'set' ? (
          <p>
            Remove set {pending.index} of {pending.setName}? The logged weight and reps will be
            deleted.
          </p>
        ) : pending?.kind === 'exercise' ? (
          <p>
            Remove {pending.name} from this session? All of its logged sets will be removed.
          </p>
        ) : (
          <p>No sets are logged. Mark this workout as completed anyway?</p>
        )}
      </ConfirmDialog>
    </div>
  );
}
