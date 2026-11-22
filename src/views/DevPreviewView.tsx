/** Developer-only preview of exercise media, descriptions and muscle diagrams. */

import { useEffect, useMemo, useState } from 'react';
import { FiArrowLeft, FiSearch } from 'react-icons/fi';
import { ExerciseMediaGallery, ExerciseThumb } from '../components/ExerciseMedia';
import { MuscleDiagram } from '../components/MuscleDiagram';
import { MUSCLE_GROUPS } from '../domain/catalogue/groups';
import { loadCatalogue, searchExercises } from '../domain/catalogue/wger';
import type { Exercise, MuscleGroupId } from '../domain/types';
import type { ViewKey } from '../state/navigation';
import { useTrainer } from '../state/store';

const COMBOS: Array<{
  label: string;
  primary: MuscleGroupId[];
  secondary: MuscleGroupId[];
}> = [
  {
    label: 'Push',
    primary: ['pectoralis-major', 'anterior-deltoid', 'triceps-brachii'],
    secondary: ['serratus-anterior'],
  },
  {
    label: 'Pull',
    primary: ['latissimus-dorsi', 'biceps-brachii', 'rhomboid'],
    secondary: ['trapezius', 'posterior-deltoid'],
  },
  {
    label: 'Legs',
    primary: ['quadriceps-femoris', 'gluteus-maximus', 'hamstrings'],
    secondary: ['gastrocnemius', 'soleus'],
  },
  {
    label: 'Full body',
    primary: ['pectoralis-major', 'latissimus-dorsi', 'rectus-abdominis'],
    secondary: ['quadriceps-femoris', 'hamstrings', 'gluteus-maximus'],
  },
];

export function DevPreviewView({
  onExit,
  onNavigate,
}: {
  onExit: () => void;
  onNavigate: (view: ViewKey) => void;
}) {
  const { customExercises } = useTrainer();
  const [catalogue, setCatalogue] = useState<Exercise[]>([]);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Exercise | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadCatalogue(customExercises)
      .then((rows) => {
        if (cancelled) return;
        setCatalogue(rows);
        setSelected(
          rows.find((exercise) => exercise.media?.some((item) => item.animated)) ??
            rows.find((exercise) => (exercise.media?.length ?? 0) > 0) ??
            rows[0] ??
            null,
        );
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [customExercises]);

  const results = useMemo(() => {
    if (!catalogue.length) return [];
    if (!query.trim()) {
      return catalogue.filter((exercise) => (exercise.media?.length ?? 0) > 0).slice(0, 12);
    }
    return searchExercises(catalogue, { query, limit: 12 });
  }, [catalogue, query]);

  return (
    <div className="view dev-preview">
      <header className="view__header">
        <div>
          <span className="view__eyebrow">Developer</span>
          <h1 className="view__title">Exercise preview</h1>
        </div>
        <button type="button" className="button" onClick={onExit}>
          <FiArrowLeft aria-hidden="true" /> Back to app
        </button>
      </header>

      <section className="card">
        <h2 className="card__title">Body map</h2>
        <p className="card__hint">
          Each Trainer muscle highlighted on its own. Front and back are labelled.
        </p>
        <div className="dev-preview__muscles">
          {MUSCLE_GROUPS.map((muscle) => (
            <div className="dev-preview__muscle" key={muscle.id}>
              <strong>{muscle.label}</strong>
              <MuscleDiagram
                compact
                primary={[muscle.id as MuscleGroupId]}
                secondary={[]}
              />
            </div>
          ))}
        </div>
      </section>

      <section className="card">
        <h2 className="card__title">Combined examples</h2>
        <p className="card__hint">Primary in red, secondary in amber.</p>
        <div className="dev-preview__muscles">
          {COMBOS.map((combo) => (
            <div className="dev-preview__muscle" key={combo.label}>
              <strong>{combo.label}</strong>
              <MuscleDiagram
                compact
                primary={combo.primary}
                secondary={combo.secondary}
              />
            </div>
          ))}
        </div>
      </section>

      <section className="card">
        <h2 className="card__title">Media and description</h2>
        <label className="dev-preview__search">
          <FiSearch aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search exercises"
            aria-label="Search exercises"
          />
        </label>

        <div className="dev-preview__results">
          {results.map((exercise) => (
            <button
              type="button"
              key={exercise.id}
              className={`dev-preview__result${selected?.id === exercise.id ? ' dev-preview__result--active' : ''}`}
              onClick={() => setSelected(exercise)}
            >
              <ExerciseThumb exercise={exercise} animated />
              <span>{exercise.name}</span>
            </button>
          ))}
        </div>

        {selected ? (
          <article className="dev-preview__selected">
            <header>
              <h3>{selected.name}</h3>
              <span className="chip chip--quiet">
                {selected.media?.length ?? 0} media ·{' '}
                {selected.instructions ? `${selected.instructions.length} chars` : 'no description'}
              </span>
            </header>
            <ExerciseMediaGallery exercise={selected} large />
            <MuscleDiagram
              primary={selected.primaryMuscles}
              secondary={selected.secondaryMuscles}
            />
            <div>
              <h4>Instructions</h4>
              {selected.instructions ? (
                <p className="dev-preview__instructions">{selected.instructions}</p>
              ) : (
                <p className="card__hint">No description in the catalogue.</p>
              )}
            </div>
          </article>
        ) : null}
      </section>

      <section className="card dev-preview__links">
        <h2 className="card__title">Other screens</h2>
        <div className="dev-preview__actions">
          <button type="button" className="button" onClick={() => onNavigate('today')}>
            Today
          </button>
          <button type="button" className="button" onClick={() => onNavigate('progress')}>
            Progress
          </button>
          <button type="button" className="button" onClick={() => onNavigate('settings')}>
            Settings
          </button>
        </div>
      </section>
    </div>
  );
}
