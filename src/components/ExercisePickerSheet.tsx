import { useEffect, useMemo, useState } from 'react';
import { FiCheck, FiPlus, FiSearch } from 'react-icons/fi';
import {
  EQUIPMENT,
  EQUIPMENT_LABELS,
  EXERCISE_CATEGORIES,
  MUSCLE_GROUPS,
  MUSCLE_GROUP_LABELS,
} from '../domain/catalogue/groups';
import { loadCatalogue, searchExercises } from '../domain/catalogue/wger';
import type {
  EquipmentId,
  Exercise,
  ExerciseCategory,
  MuscleGroupId,
  Session,
} from '../domain/types';
import { useDebouncedValue } from '../state/hooks';
import { useTrainer } from '../state/store';
import { BottomSheet } from './BottomSheet';
import { CustomExerciseForm } from './CustomExerciseForm';
import { ExerciseThumb } from './ExerciseMedia';

interface ExercisePickerSheetProps {
  open: boolean;
  session: Session | null;
  onClose: () => void;
  onAdd: (exercise: Exercise) => Promise<void>;
  onRemove: (exerciseRowId: string) => Promise<void>;
}

type PickerMode = 'picker' | 'custom';

export function ExercisePickerSheet({
  open,
  session,
  onClose,
  onAdd,
  onRemove,
}: ExercisePickerSheetProps) {
  const { customExercises } = useTrainer();
  const [mode, setMode] = useState<PickerMode>('picker');
  const [catalogue, setCatalogue] = useState<Exercise[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [muscle, setMuscle] = useState<MuscleGroupId | ''>('');
  const [equipment, setEquipment] = useState<EquipmentId | ''>('');
  const [category, setCategory] = useState<ExerciseCategory | ''>('');
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [addingId, setAddingId] = useState<string | null>(null);
  const debouncedQuery = useDebouncedValue(query, 150);

  useEffect(() => {
    if (!open) return;
    setMode('picker');
    setAdded(new Set(session?.exercises.map((row) => row.exerciseId) ?? []));
    let cancelled = false;
    setLoading(true);
    void loadCatalogue(customExercises)
      .then((rows) => {
        if (!cancelled) setCatalogue(rows);
      })
      .catch(() => {
        if (!cancelled) setCatalogue([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [customExercises, open, session?.id]);

  const results = useMemo(
    () =>
      searchExercises(catalogue, {
        query: debouncedQuery,
        muscle: muscle || undefined,
        equipment: equipment || undefined,
        category: category || undefined,
        limit: 60,
      }),
    [catalogue, category, debouncedQuery, equipment, muscle],
  );

  async function toggleExercise(exercise: Exercise) {
    if (addingId !== null) return;
    const row = session?.exercises.find((item) => item.exerciseId === exercise.id);
    setAddingId(exercise.id);
    try {
      if (row) {
        await onRemove(row.id);
        setAdded((current) => {
          const next = new Set(current);
          next.delete(exercise.id);
          return next;
        });
      } else {
        await onAdd(exercise);
        setAdded((current) => new Set(current).add(exercise.id));
      }
    } catch {
      /* The store surfaces the error banner. */
    } finally {
      setAddingId(null);
    }
  }

  function clearFilters() {
    setMuscle('');
    setEquipment('');
    setCategory('');
    setQuery('');
  }

  return (
    <BottomSheet
      open={open}
      title={mode === 'custom' ? 'New exercise' : 'Add exercises'}
      onClose={onClose}
      className="sheet--full"
      footer={
        mode === 'picker' ? (
          <div className="sheet-actions">
            <button type="button" className="button button--primary" onClick={onClose}>
              Done
            </button>
          </div>
        ) : undefined
      }
    >
      {mode === 'custom' ? (
        <CustomExerciseForm
          onClose={() => setMode('picker')}
          onSaved={(exercise) => {
            setMode('picker');
            void toggleExercise(exercise);
          }}
        />
      ) : (
        <div className="picker">
          <label className="search-field">
            <FiSearch aria-hidden="true" />
            <span className="visually-hidden">Search exercises</span>
            <input
              className="input"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search the exercise catalogue"
              autoFocus
            />
          </label>

          <div className="picker__filters">
            <select
              className="input"
              aria-label="Muscle group"
              value={muscle}
              onChange={(event) => setMuscle(event.target.value as MuscleGroupId | '')}
            >
              <option value="">All muscles</option>
              {MUSCLE_GROUPS.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
            <select
              className="input"
              aria-label="Equipment"
              value={equipment}
              onChange={(event) => setEquipment(event.target.value as EquipmentId | '')}
            >
              <option value="">All equipment</option>
              {EQUIPMENT.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
            <select
              className="input"
              aria-label="Category"
              value={category}
              onChange={(event) => setCategory(event.target.value as ExerciseCategory | '')}
            >
              <option value="">All categories</option>
              {EXERCISE_CATEGORIES.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </div>

          <button type="button" className="button button--quiet picker__custom" onClick={() => setMode('custom')}>
            <FiPlus aria-hidden="true" />
            Create a custom exercise
          </button>

          <p className="picker__honesty">Exercises are added as you tap them.</p>

          {loading ? (
            <div className="view-loading" role="status">
              Loading exercises…
            </div>
          ) : results.length === 0 ? (
            <div className="picker__empty">
              <p className="card__title">No exercises match</p>
              <p className="card__hint">Clear the filters or create a custom exercise to keep training.</p>
              <div className="picker__empty-actions">
                <button type="button" className="button" onClick={clearFilters}>
                  Clear filters
                </button>
                <button type="button" className="button" onClick={() => setMode('custom')}>
                  Create custom exercise
                </button>
              </div>
            </div>
          ) : (
            <ul className="picker__results">
              {results.map((exercise) => {
                const isAdded = added.has(exercise.id);
                return (
                  <li key={exercise.id}>
                    <button
                      type="button"
                      className={`picker__result${isAdded ? ' picker__result--added' : ''}`}
                      onClick={() => void toggleExercise(exercise)}
                      disabled={addingId === exercise.id}
                      aria-pressed={isAdded}
                    >
                      <ExerciseThumb exercise={exercise} />
                      <span className="picker__result-main">
                        <span className="picker__result-name">{exercise.name}</span>
                        <span className="picker__result-meta">
                          {exercise.primaryMuscles.map((id) => MUSCLE_GROUP_LABELS[id]).join(', ')}
                          {exercise.equipment.length
                            ? ` · ${exercise.equipment.map((id) => EQUIPMENT_LABELS[id]).join(', ')}`
                            : ''}
                        </span>
                      </span>
                      <span className="picker__result-state">
                        {isAdded ? (
                          <>
                            <FiCheck aria-hidden="true" /> Added · tap to remove
                          </>
                        ) : addingId === exercise.id ? (
                          'Adding…'
                        ) : (
                          <FiPlus aria-label="Add" />
                        )}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </BottomSheet>
  );
}
