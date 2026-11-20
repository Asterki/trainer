import { useEffect, useState } from 'react';
import { FiChevronDown, FiChevronUp, FiTrash2 } from 'react-icons/fi';
import {
  EQUIPMENT_LABELS,
  EXERCISE_CATEGORY_LABELS,
  MUSCLE_GROUP_LABELS,
} from '../domain/catalogue/groups';
import { fromIsoDate } from '../domain/date';
import type { LastPerformance } from '../domain/session';
import type { Exercise, SessionExercise, SetLog } from '../domain/types';
import { useLastPerformance } from '../state/hooks';
import { SetLogger } from './SetLogger';

interface SessionExerciseCardProps {
  row: SessionExercise;
  index: number;
  count: number;
  exercise?: Exercise;
  editable: boolean;
  editMode: boolean;
  onUpdate: (patch: {
    targetSets?: number;
    targetRepMin?: number;
    targetRepMax?: number;
    note?: string;
  }) => Promise<void>;
  onMove: (direction: -1 | 1) => Promise<void>;
  onRemove: () => void;
  onLogSet: (set: SetLog) => Promise<void>;
  onUpdateSet: (setId: string, patch: Partial<SetLog>) => Promise<void>;
  onRequestRemoveSet: (set: SetLog) => void;
  onSavingChange: (delta: number) => void;
}

function formatWeight(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100);
}

function lastLine(performance: LastPerformance | null): string {
  if (!performance) return 'First time';
  return performance.sets
    .map((set) => `${formatWeight(set.weight)}×${set.reps}`)
    .join(', ');
}

export function SessionExerciseCard({
  row,
  index,
  count,
  exercise,
  editable,
  editMode,
  onUpdate,
  onMove,
  onRemove,
  onLogSet,
  onUpdateSet,
  onRequestRemoveSet,
  onSavingChange,
}: SessionExerciseCardProps) {
  const performance = useLastPerformance(row.exerciseId);
  const [sets, setSets] = useState(String(row.targetSets));
  const [min, setMin] = useState(String(row.targetRepMin));
  const [max, setMax] = useState(String(row.targetRepMax));
  const [note, setNote] = useState(row.note);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (editMode) return;
    setSets(String(row.targetSets));
    setMin(String(row.targetRepMin));
    setMax(String(row.targetRepMax));
    setNote(row.note);
  }, [editMode, row.targetSets, row.targetRepMin, row.targetRepMax, row.note]);

  async function commitTargets() {
    const nextSets = Number(sets);
    const nextMin = Number(min);
    const nextMax = Number(max);
    if (!Number.isInteger(nextSets) || nextSets < 1 || nextSets > 12) {
      setError('Target sets must be a whole number from 1 to 12.');
      return;
    }
    if (
      !Number.isInteger(nextMin) ||
      !Number.isInteger(nextMax) ||
      nextMin < 1 ||
      nextMax > 50 ||
      nextMin > nextMax
    ) {
      setError('Rep targets must be whole numbers from 1 to 50, with the low end first.');
      return;
    }
    setError(null);
    await onUpdate({ targetSets: nextSets, targetRepMin: nextMin, targetRepMax: nextMax });
  }

  const category = exercise?.category;
  const equipment = exercise?.equipment ?? [];
  const muscles = row.primaryMuscles;
  const targetLabel =
    row.targetRepMin === row.targetRepMax
      ? `${row.targetSets} × ${row.targetRepMin}`
      : `${row.targetSets} × ${row.targetRepMin}–${row.targetRepMax}`;

  return (
    <article className="exercise-card card" aria-labelledby={`exercise-${row.id}`}>
      <header className="exercise-card__head">
        <div>
          <h3 className="exercise-card__title" id={`exercise-${row.id}`}>
            {row.name}
          </h3>
          <div className="exercise-card__meta">
            {category ? (
              <span className="chip chip--quiet">{EXERCISE_CATEGORY_LABELS[category]}</span>
            ) : null}
            {equipment.map((item) => (
              <span className="chip chip--quiet" key={item}>
                {EQUIPMENT_LABELS[item]}
              </span>
            ))}
            {muscles.map((muscle) => (
              <span className="chip" key={muscle}>
                {MUSCLE_GROUP_LABELS[muscle]}
              </span>
            ))}
          </div>
        </div>
        {editMode && editable ? (
          <div className="exercise-card__tools">
            <button
              type="button"
              className="icon-button"
              onClick={() => void onMove(-1)}
              disabled={index === 0}
              aria-label={`Move ${row.name} up`}
            >
              <FiChevronUp aria-hidden="true" />
            </button>
            <button
              type="button"
              className="icon-button"
              onClick={() => void onMove(1)}
              disabled={index === count - 1}
              aria-label={`Move ${row.name} down`}
            >
              <FiChevronDown aria-hidden="true" />
            </button>
            <button
              type="button"
              className="icon-button icon-button--danger"
              onClick={onRemove}
              aria-label={`Remove ${row.name}`}
            >
              <FiTrash2 aria-hidden="true" />
            </button>
          </div>
        ) : null}
      </header>

      {editMode && editable ? (
        <div className="target-editor">
          <label className="field target-editor__field">
            <span className="field__label">Sets</span>
            <input
              className="input input--num"
              type="number"
              inputMode="numeric"
              min={1}
              max={12}
              value={sets}
              onChange={(event) => setSets(event.target.value)}
              onBlur={() => void commitTargets()}
            />
          </label>
          <label className="field target-editor__field">
            <span className="field__label">Rep low</span>
            <input
              className="input input--num"
              type="number"
              inputMode="numeric"
              min={1}
              max={50}
              value={min}
              onChange={(event) => setMin(event.target.value)}
              onBlur={() => void commitTargets()}
            />
          </label>
          <label className="field target-editor__field">
            <span className="field__label">Rep high</span>
            <input
              className="input input--num"
              type="number"
              inputMode="numeric"
              min={1}
              max={50}
              value={max}
              onChange={(event) => setMax(event.target.value)}
              onBlur={() => void commitTargets()}
            />
          </label>
          <label className="field target-editor__note">
            <span className="field__label">Exercise note</span>
            <input
              className="input"
              value={note}
              maxLength={500}
              onChange={(event) => setNote(event.target.value)}
              onBlur={() => {
                if (note !== row.note) void onUpdate({ note });
              }}
            />
          </label>
        </div>
      ) : (
        <>
          <p className="exercise-card__target">
            <strong>{targetLabel}</strong>
            {row.note ? <span> · {row.note}</span> : null}
          </p>
          <p className="exercise-card__last">
            Last: {lastLine(performance)}
            {performance ? (
              <span className="exercise-card__last-date">
                {' '}
                · {new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' }).format(
                  fromIsoDate(performance.date),
                )}
              </span>
            ) : null}
          </p>
        </>
      )}

      {error ? (
        <p className="field__error" role="alert">
          {error}
        </p>
      ) : null}

      <SetLogger
        row={row}
        editable={editable}
        onLogSet={onLogSet}
        onUpdateSet={onUpdateSet}
        onRemoveSet={(setId) => {
          const set = row.sets.find((item) => item.id === setId);
          if (set) onRequestRemoveSet(set);
        }}
        onSavingChange={onSavingChange}
      />
    </article>
  );
}
