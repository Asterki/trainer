import { FiEdit3, FiLock, FiPlus } from 'react-icons/fi';
import { fromIsoDate } from '../domain/date';
import {
  deriveSessionStatus,
  sessionSetCount,
  sessionTargetSets,
  sessionVolume,
  trainedExerciseCount,
} from '../domain/session';
import type { ResolvedSlot } from '../domain/routine';
import type { IsoDate, Routine, Session } from '../domain/types';
import { formatVolume } from '../domain/units';
import { useTrainer } from '../state/store';

interface SessionStatusCardProps {
  session: Session | null;
  routine: Routine | null;
  slot: ResolvedSlot | null;
  today: IsoDate;
  editMode: boolean;
  onToggleEdit: () => void;
  onAddExercises: () => void;
  onLogAdHoc: () => void;
  onBuildRoutine: () => void;
  onReopen: () => void;
  onViewHistory: () => void;
}

function routineLine(routine: Routine | null, session: Session | null): string | null {
  if (session) {
    const week = session.weekIndex === null ? null : `Week ${session.weekIndex + 1}`;
    return [session.routineName, week].filter(Boolean).join(' · ');
  }
  if (!routine) return null;
  return `${routine.name} · ${routine.weekCount}-week cycle`;
}

export function SessionStatusCard({
  session,
  routine,
  slot,
  today,
  editMode,
  onToggleEdit,
  onAddExercises,
  onLogAdHoc,
  onBuildRoutine,
  onReopen,
  onViewHistory,
}: SessionStatusCardProps) {
  const { settings } = useTrainer();
  const unit = settings.weightUnit;
  const line = routineLine(routine, session);
  const derived = session ? deriveSessionStatus(session) : null;
  const sets = session ? sessionSetCount(session) : 0;
  const target = session ? sessionTargetSets(session) : 0;
  const volume = session ? sessionVolume(session) : 0;
  const trained = session ? trainedExerciseCount(session) : 0;

  if (!session) {
    const isRest = slot?.kind === 'rest';
    const isUpcoming = Boolean(routine && routine.startDate > today);
    const title = !routine
      ? 'No routine'
      : isRest
        ? 'Rest'
        : isUpcoming
          ? 'Upcoming'
          : 'No session today';

    return (
      <section className="session-status card" aria-labelledby="session-status-title">
        <div className="session-status__top">
          <span className="session-status__eyebrow">{line ?? 'Today'}</span>
          <span className={`badge ${isRest ? 'badge--quiet' : !routine ? 'badge--warning' : 'badge--quiet'}`}>
            {isRest ? 'Rest day' : !routine ? 'Setup needed' : isUpcoming ? 'Scheduled' : 'Open'}
          </span>
        </div>
        <h2 className="session-status__title" id="session-status-title">
          {title}
        </h2>
        <p className="session-status__copy">
          {!routine
            ? 'Build a routine to schedule training days and give the AI a weekly context.'
            : isRest
              ? 'No workout is scheduled today. Rest days never create sessions or history.'
              : isUpcoming
                ? `This routine starts on ${new Intl.DateTimeFormat(undefined, {
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric',
                  }).format(fromIsoDate(routine.startDate))}. No sessions are created before then.`
                : 'Today is a scheduled workout, but the session has not been prepared yet.'}
        </p>
        <div className="session-status__actions">
          {!routine ? (
            <button type="button" className="button button--primary" onClick={onBuildRoutine}>
              Build a routine
            </button>
          ) : null}
          {isRest || !routine || (!isUpcoming && !isRest) ? (
            <button
              type="button"
              className={!routine || isRest || isUpcoming ? 'button' : 'button button--primary'}
              onClick={onLogAdHoc}
            >
              Log a workout
            </button>
          ) : null}
        </div>
      </section>
    );
  }

  const isCompleted = derived === 'completed';
  const isSkipped = derived === 'skipped';
  const isPending = !isCompleted && !isSkipped && session.exercises.length === 0;
  const statusLabel = isSkipped
    ? 'Skipped'
    : isCompleted
      ? 'Completed'
      : isPending
        ? 'Plan pending'
        : derived === 'in-progress'
          ? 'In progress'
          : 'Planned';
  const badgeClass = isSkipped
    ? 'badge--danger'
    : isCompleted
      ? 'badge--success'
      : isPending
        ? 'badge--warning'
        : 'badge--active';
  const progress = target > 0 ? Math.min(100, Math.round((sets / target) * 100)) : 0;

  return (
    <section className="session-status card" aria-labelledby="session-status-title">
      <div className="session-status__top">
        <span className="session-status__eyebrow">{line}</span>
        <span className={`badge ${badgeClass}`}>{statusLabel}</span>
      </div>
      <div className="session-status__heading">
        <h2 className="session-status__title" id="session-status-title">
          {session.focus}
        </h2>
        {!isSkipped && !isCompleted && (
          <button
            type="button"
            className="button button--quiet session-status__edit"
            onClick={onToggleEdit}
            aria-pressed={editMode}
          >
            <FiEdit3 aria-hidden="true" />
            {editMode ? 'Done' : 'Edit plan'}
          </button>
        )}
      </div>

      {isPending ? (
        <p className="session-status__copy">
          Waiting for today’s plan. Add exercises yourself, or let your n8n workflow write them
          through the relay.
        </p>
      ) : null}

      {isSkipped ? (
        <div className="session-status__lock">
          <FiLock aria-hidden="true" />
          <span>This scheduled workout passed without a completed session. It is read-only.</span>
        </div>
      ) : null}

      {!isPending && !isSkipped ? (
        <>
          <div className="session-status__metrics">
            <div>
              <span className="session-status__metric-value">
                {session.exercises.length}
              </span>
              <span className="session-status__metric-label">
                {session.exercises.length === 1 ? 'exercise' : 'exercises'}
              </span>
            </div>
            <div>
              <span className="session-status__metric-value">
                {sets}
                <span className="session-status__metric-target"> / {target}</span>
              </span>
              <span className="session-status__metric-label">sets logged</span>
            </div>
            <div>
              <span className="session-status__metric-value">
                {formatVolume(volume, unit)}
              </span>
              <span className="session-status__metric-label">{unit} volume</span>
            </div>
          </div>
          {!isCompleted && target > 0 ? (
            <div
              className="session-progress"
              role="progressbar"
              aria-label="Logged sets"
              aria-valuemin={0}
              aria-valuemax={target}
              aria-valuenow={Math.min(sets, target)}
            >
              <span className="session-progress__fill" style={{ width: `${progress}%` }} />
            </div>
          ) : null}
        </>
      ) : null}

      {isCompleted ? (
        <div className="session-summary">
          <p className="session-summary__title">Workout complete</p>
          <p className="session-summary__copy">
            {trained} {trained === 1 ? 'exercise' : 'exercises'} trained · {sets}{' '}
            {sets === 1 ? 'set' : 'sets'} · {formatVolume(volume, unit)} {unit} volume
          </p>
          <div className="session-status__actions">
            <button type="button" className="button" onClick={onReopen}>
              Reopen
            </button>
            <button type="button" className="button button--quiet" onClick={onViewHistory}>
              View history
            </button>
          </div>
        </div>
      ) : null}

      {!isCompleted && !isSkipped && !isPending && editMode ? (
        <div className="session-status__actions">
          <button type="button" className="button" onClick={onAddExercises}>
            <FiPlus aria-hidden="true" />
            Add exercise
          </button>
        </div>
      ) : null}

      {isPending ? (
        <div className="session-status__actions">
          <button type="button" className="button button--primary" onClick={onAddExercises}>
            <FiPlus aria-hidden="true" />
            Add exercises
          </button>
        </div>
      ) : null}
    </section>
  );
}
