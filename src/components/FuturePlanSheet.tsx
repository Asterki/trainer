/** Plan exercises for a scheduled session before its training day. */

import { FiPlus } from 'react-icons/fi';
import { BottomSheet } from './BottomSheet';
import { SessionExerciseCard } from './SessionExerciseCard';
import { fromIsoDate } from '../domain/date';
import type { Exercise, Session, SessionExercise } from '../domain/types';
import { useTrainer } from '../state/store';

interface FuturePlanSheetProps {
  session: Session | null;
  catalogue: Map<string, Exercise>;
  onClose: () => void;
  onAddExercise: () => void;
  onOpenDetails: (exercise: Exercise, row: SessionExercise) => void;
}

export function FuturePlanSheet({
  session,
  catalogue,
  onClose,
  onAddExercise,
  onOpenDetails,
}: FuturePlanSheetProps) {
  const {
    updateSessionExercise,
    removeSessionExercise,
    moveSessionExercise,
  } = useTrainer();

  const dateLabel = session
    ? new Intl.DateTimeFormat(undefined, {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
      }).format(fromIsoDate(session.date))
    : '';

  return (
    <BottomSheet
      open={session !== null}
      title={dateLabel}
      onClose={onClose}
      className="sheet--plan"
      footer={
        session ? (
          <button type="button" className="button button--primary" onClick={onAddExercise}>
            <FiPlus aria-hidden="true" /> Add exercise
          </button>
        ) : undefined
      }
    >
      {session ? (
        <>
          <p className="plan-sheet__meta">
            <strong>{session.focus}</strong> · {session.routineName}
          </p>
          {session.exercises.length === 0 ? (
            <p className="card__hint">No exercises planned yet.</p>
          ) : (
            <div className="plan-sheet__list">
              {session.exercises.map((row, index) => (
                <SessionExerciseCard
                  key={row.id}
                  row={row}
                  index={index}
                  count={session.exercises.length}
                  exercise={catalogue.get(row.exerciseId)}
                  editable
                  editMode
                  showLogger={false}
                  onUpdate={(patch) => updateSessionExercise(session.id, row.id, patch)}
                  onMove={(direction) => moveSessionExercise(session.id, row.id, direction)}
                  onRemove={() => void removeSessionExercise(session.id, row.id)}
                  onLogSet={async () => undefined}
                  onUpdateSet={async () => undefined}
                  onRequestRemoveSet={() => undefined}
                  onSavingChange={() => undefined}
                  onOpenDetails={(exercise) => onOpenDetails(exercise, row)}
                />
              ))}
            </div>
          )}
        </>
      ) : null}
    </BottomSheet>
  );
}
