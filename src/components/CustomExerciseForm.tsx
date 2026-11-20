import { useState, type FormEvent } from 'react';
import {
  EXERCISE_CATEGORIES,
  EQUIPMENT,
  MUSCLE_GROUPS,
} from '../domain/catalogue/groups';
import type {
  CustomExerciseInput,
  EquipmentId,
  Exercise,
  ExerciseCategory,
  MuscleGroupId,
} from '../domain/types';
import { useTrainer } from '../state/store';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong. Try again.';
}

function parseAliases(value: string): string[] {
  return value
    .split(',')
    .map((alias) => alias.trim())
    .filter(Boolean);
}

export interface CustomExerciseFormProps {
  exercise?: Exercise;
  onClose: () => void;
  onSaved: (exercise: Exercise) => void;
}

export function CustomExerciseForm({ exercise, onClose, onSaved }: CustomExerciseFormProps) {
  const { createCustomExercise, updateCustomExercise } = useTrainer();
  const [name, setName] = useState(exercise?.name ?? '');
  const [category, setCategory] = useState<ExerciseCategory>(exercise?.category ?? 'full-body');
  const [primary, setPrimary] = useState<MuscleGroupId[]>(exercise?.primaryMuscles ?? []);
  const [secondary, setSecondary] = useState<MuscleGroupId[]>(exercise?.secondaryMuscles ?? []);
  const [equipment, setEquipment] = useState<EquipmentId[]>(exercise?.equipment ?? []);
  const [instructions, setInstructions] = useState(exercise?.instructions ?? '');
  const [aliases, setAliases] = useState((exercise?.aliases ?? []).join(', '));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const primarySet = new Set(primary);

  function togglePrimary(muscle: MuscleGroupId) {
    setPrimary((current) =>
      current.includes(muscle) ? current.filter((item) => item !== muscle) : [...current, muscle],
    );
    setSecondary((current) => current.filter((item) => item !== muscle));
  }

  function toggleSecondary(muscle: MuscleGroupId) {
    setSecondary((current) =>
      current.includes(muscle) ? current.filter((item) => item !== muscle) : [...current, muscle],
    );
  }

  function toggleEquipment(item: EquipmentId) {
    setEquipment((current) =>
      current.includes(item) ? current.filter((value) => value !== item) : [...current, item],
    );
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSaving(true);
    const input: CustomExerciseInput = {
      name: name.trim(),
      category,
      primaryMuscles: primary,
      secondaryMuscles: secondary,
      equipment,
      instructions: instructions.trim(),
      aliases: parseAliases(aliases),
    };

    try {
      if (exercise) {
        await updateCustomExercise(exercise.id, input);
        onSaved({ ...exercise, name: input.name });
      } else {
        onSaved(await createCustomExercise(input));
      }
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <form id="exercise-form" className="exercise-form" onSubmit={handleSubmit}>
        {error && (
          <div className="notice notice--error" role="alert">
            {error}
          </div>
        )}

        <div className="field">
          <label className="field__label" htmlFor="exercise-name">
            Name
          </label>
          <input
            id="exercise-name"
            className="input"
            value={name}
            onChange={(event) => setName(event.target.value)}
            minLength={2}
            maxLength={80}
            required
            autoFocus
          />
          <span className="field__hint">2–80 characters. Names must be unique across the catalogue.</span>
        </div>

        <div className="field">
          <label className="field__label" htmlFor="exercise-category">
            Category
          </label>
          <select
            id="exercise-category"
            className="input"
            value={category}
            onChange={(event) => setCategory(event.target.value as ExerciseCategory)}
          >
            {EXERCISE_CATEGORIES.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </div>

        <fieldset className="form-group">
          <legend className="field__label">
            Primary muscles <span className="field__required">(at least one)</span>
          </legend>
          <div className="check-grid check-grid--muscles">
            {MUSCLE_GROUPS.map((muscle) => (
              <label className="check" key={muscle.id}>
                <input
                  type="checkbox"
                  checked={primary.includes(muscle.id)}
                  onChange={() => togglePrimary(muscle.id)}
                />
                <span>{muscle.label}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="form-group">
          <legend className="field__label">Secondary muscles</legend>
          <div className="check-grid check-grid--muscles">
            {MUSCLE_GROUPS.filter((muscle) => !primarySet.has(muscle.id)).map((muscle) => (
              <label className="check" key={muscle.id}>
                <input
                  type="checkbox"
                  checked={secondary.includes(muscle.id)}
                  onChange={() => toggleSecondary(muscle.id)}
                />
                <span>{muscle.label}</span>
              </label>
            ))}
          </div>
          <span className="field__hint">Primary muscles are excluded here to prevent overlap.</span>
        </fieldset>

        <fieldset className="form-group">
          <legend className="field__label">Equipment</legend>
          <div className="check-grid">
            {EQUIPMENT.map((item) => (
              <label className="check" key={item.id}>
                <input
                  type="checkbox"
                  checked={equipment.includes(item.id)}
                  onChange={() => toggleEquipment(item.id)}
                />
                <span>{item.label}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="field">
          <label className="field__label" htmlFor="exercise-aliases">
            Aliases <span className="field__optional">(optional)</span>
          </label>
          <input
            id="exercise-aliases"
            className="input"
            value={aliases}
            onChange={(event) => setAliases(event.target.value)}
            placeholder="DB bench, flat press"
          />
          <span className="field__hint">Comma-separated, up to 5. Aliases help search.</span>
        </div>

        <div className="field">
          <label className="field__label" htmlFor="exercise-instructions">
            Instructions <span className="field__optional">(optional)</span>
          </label>
          <textarea
            id="exercise-instructions"
            className="input input--textarea"
            value={instructions}
            onChange={(event) => setInstructions(event.target.value)}
            maxLength={1200}
            rows={4}
          />
          <span className="field__hint">{instructions.length} / 1,200 characters.</span>
        </div>
      </form>

      <div className="sheet-actions">
        <button type="button" className="button" onClick={onClose} disabled={saving}>
          Cancel
        </button>
        <button
          type="submit"
          form="exercise-form"
          className="button button--primary"
          disabled={saving}
        >
          {saving ? 'Saving…' : exercise ? 'Save changes' : 'Create exercise'}
        </button>
      </div>
    </>
  );
}

