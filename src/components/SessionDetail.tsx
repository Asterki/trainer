import { FiX } from 'react-icons/fi';
import { fromIsoDate } from '../domain/date';
import {
  deriveSessionStatus,
  sessionSetCount,
  sessionVolume,
} from '../domain/session';
import type { Session } from '../domain/types';

interface SessionDetailProps {
  session: Session;
  onClose?: () => void;
}

const numberFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });
const SOURCE_LABELS = {
  ai: 'AI plan',
  manual: 'Ad-hoc',
  auto: 'Routine',
} as const;

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(fromIsoDate(value));
}

export function SessionDetail({ session, onClose }: SessionDetailProps) {
  const status = deriveSessionStatus(session);
  const statusLabel =
    status === 'in-progress'
      ? 'In progress'
      : status.charAt(0).toUpperCase() + status.slice(1);
  const totalSets = sessionSetCount(session);
  const totalVolume = sessionVolume(session);

  return (
    <article className="session-detail">
      <header className="session-detail__head">
        <div>
          <p className="view__eyebrow">Session</p>
          <h2 className="session-detail__date">{formatDate(session.date)}</h2>
          <p className="session-detail__focus">{session.focus}</p>
          <p className="session-detail__meta">
            {session.routineName || 'Ad-hoc session'}
            {session.weekIndex !== null ? ` · Week ${session.weekIndex + 1}` : ''} ·{' '}
            {SOURCE_LABELS[session.source]}
          </p>
        </div>
        <div className="session-detail__head-actions">
          <span className={`badge badge--${status === 'in-progress' ? 'warning' : status}`}>
            {statusLabel}
          </span>
          {onClose ? (
            <button type="button" className="icon-button" aria-label="Close session detail" onClick={onClose}>
              <FiX />
            </button>
          ) : null}
        </div>
      </header>

      {status === 'skipped' ? (
        <div className="session-detail__skipped">
          <p>No workout logged for this day.</p>
          <p className="card__hint">
            The scheduled session was missed. Rest days never create sessions, so they do not
            appear here.
          </p>
        </div>
      ) : (
        <>
          <div className="session-detail__summary">
            <div>
              <span className="stat__label">Exercises</span>
              <strong>{session.exercises.length}</strong>
            </div>
            <div>
              <span className="stat__label">Sets</span>
              <strong>{totalSets}</strong>
            </div>
            <div>
              <span className="stat__label">Volume</span>
              <strong>{numberFormat.format(totalVolume)} kg</strong>
            </div>
          </div>

          {session.exercises.length === 0 ? (
            <p className="chart-empty">No exercises were added to this session.</p>
          ) : (
            <ul className="session-detail__exercises">
              {session.exercises.map((exercise) => {
                const volume = exercise.sets.reduce(
                  (total, set) => total + set.weight * set.reps,
                  0,
                );
                return (
                  <li key={exercise.id} className="session-detail__exercise">
                    <div className="session-detail__exercise-head">
                      <strong>{exercise.name}</strong>
                      <span className="session-detail__target">
                        Target {exercise.targetSets} × {exercise.targetRepMin}–
                        {exercise.targetRepMax}
                      </span>
                    </div>
                    {exercise.sets.length === 0 ? (
                      <p className="card__hint">No sets logged.</p>
                    ) : (
                      <ol className="session-detail__sets">
                        {exercise.sets.map((set) => (
                          <li key={set.id}>
                            <span>{set.weight} kg</span>
                            <span>× {set.reps}</span>
                            <span className="session-detail__set-volume">
                              {numberFormat.format(set.weight * set.reps)} kg
                            </span>
                          </li>
                        ))}
                      </ol>
                    )}
                    <p className="session-detail__exercise-total">
                      {exercise.sets.length} sets · {numberFormat.format(volume)} kg
                    </p>
                  </li>
                );
              })}
            </ul>
          )}

          {session.notes ? (
            <section className="session-detail__notes">
              <h3>Notes</h3>
              <p>{session.notes}</p>
            </section>
          ) : null}
        </>
      )}

      <p className="session-detail__lock">
        Read-only history. Completed sessions can only be reopened from Today on the same day.
      </p>
    </article>
  );
}
