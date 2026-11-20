import { useEffect, useMemo, useState } from 'react';
import { FiX } from 'react-icons/fi';
import {
  EQUIPMENT_LABELS,
  EXERCISE_CATEGORY_LABELS,
  MUSCLE_GROUP_LABELS,
} from '../domain/catalogue/groups';
import { loadCatalogue } from '../domain/catalogue/wger';
import { fromIsoDate } from '../domain/date';
import {
  exerciseHistory,
  prsForExercise,
  type ExerciseSessionPoint,
} from '../domain/metrics';
import type { Exercise } from '../domain/types';
import { useTrainer } from '../state/store';
import { PrTable } from './PrTable';
import { TrendChart } from './charts/TrendChart';

interface ExerciseDetailProps {
  exerciseId: string;
  onOpenSession: (sessionId: string) => void;
  onNavigateSettings: () => void;
  onClose?: () => void;
}

type ChartMode = 'weight' | 'volume' | 'reps';

const numberFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });
const compactFormat = new Intl.NumberFormat(undefined, {
  notation: 'compact',
  maximumFractionDigits: 1,
});

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(fromIsoDate(value));
}

function shortDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' }).format(
    fromIsoDate(value),
  );
}

function formatSetList(point: ExerciseSessionPoint): string {
  return point.sets.map((set) => `${set.weight}×${set.reps}`).join(', ');
}

export function ExerciseDetail({
  exerciseId,
  onOpenSession,
  onNavigateSettings,
  onClose,
}: ExerciseDetailProps) {
  const { sessions, customExercises } = useTrainer();
  const [catalogue, setCatalogue] = useState<Exercise[]>([]);
  const [mode, setMode] = useState<ChartMode>('weight');
  const [visible, setVisible] = useState(20);

  useEffect(() => {
    let active = true;
    void loadCatalogue(customExercises).then((exercises) => {
      if (active) setCatalogue(exercises);
    });
    return () => {
      active = false;
    };
  }, [customExercises]);

  useEffect(() => {
    setVisible(20);
  }, [exerciseId]);

  const points = useMemo(
    () => exerciseHistory(sessions, exerciseId),
    [exerciseId, sessions],
  );
  const prs = useMemo(() => prsForExercise(sessions, exerciseId), [exerciseId, sessions]);
  const catalogueExercise = catalogue.find((exercise) => exercise.id === exerciseId);
  const latestRow = useMemo(() => {
    const completed = sessions
      .filter((session) => session.status === 'completed')
      .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt));
    for (let index = completed.length - 1; index >= 0; index -= 1) {
      const row = completed[index].exercises.find((item) => item.exerciseId === exerciseId);
      if (row) return row;
    }
    return null;
  }, [exerciseId, sessions]);

  const name = catalogueExercise?.name ?? latestRow?.name ?? 'Exercise';
  const primaryMuscles = catalogueExercise?.primaryMuscles ?? latestRow?.primaryMuscles ?? [];
  const secondaryMuscles =
    catalogueExercise?.secondaryMuscles ?? latestRow?.secondaryMuscles ?? [];

  const stats = useMemo(() => {
    let totalSets = 0;
    let totalVolume = 0;
    let bestWeight = 0;
    let bestReps = 0;
    for (const point of points) {
      totalSets += point.sets.length;
      totalVolume += point.volume;
      if (
        point.topWeight > bestWeight ||
        (point.topWeight === bestWeight && point.topRepsAtTop > bestReps)
      ) {
        bestWeight = point.topWeight;
        bestReps = point.topRepsAtTop;
      }
    }
    return {
      totalSets,
      totalVolume,
      bestWeight,
      bestReps,
      first: points[0]?.date ?? null,
      last: points[points.length - 1]?.date ?? null,
    };
  }, [points]);

  const hasWeight = points.some((point) => point.topWeight > 0);
  const effectiveMode: ChartMode = hasWeight ? mode : 'reps';
  const chartPoints = points.slice(-200).map((point) => {
    const label = shortDate(point.date);
    if (effectiveMode === 'volume') {
      return {
        label,
        value: point.volume,
        detail: `${numberFormat.format(point.volume)} kg volume · ${point.sets.length} sets`,
      };
    }
    if (effectiveMode === 'reps') {
      return {
        label,
        value: point.topRepsAtTop,
        detail: `Top set ${point.topWeight > 0 ? `${point.topWeight} kg × ` : ''}${point.topRepsAtTop} reps`,
      };
    }
    return {
      label,
      value: point.topWeight,
      detail: `Top set ${point.topWeight} kg × ${point.topRepsAtTop} reps${
        point.estimated1rm ? ` · est. 1RM ${point.estimated1rm} kg` : ''
      }`,
    };
  });
  const visiblePoints = [...points].reverse().slice(0, visible);

  return (
    <article className="detail-panel">
      <header className="detail-panel__head">
        <div>
          <p className="view__eyebrow">Exercise</p>
          <h2 className="detail-panel__title">{name}</h2>
          <div className="detail-panel__chips">
            {catalogueExercise ? (
              <span className="chip">{EXERCISE_CATEGORY_LABELS[catalogueExercise.category]}</span>
            ) : null}
            {(catalogueExercise?.equipment ?? []).map((equipment) => (
              <span className="chip" key={equipment}>
                {EQUIPMENT_LABELS[equipment]}
              </span>
            ))}
            {primaryMuscles.map((muscle) => (
              <span className="chip chip--primary" key={muscle}>
                {MUSCLE_GROUP_LABELS[muscle]}
              </span>
            ))}
            {secondaryMuscles
              .filter((muscle) => !primaryMuscles.includes(muscle))
              .map((muscle) => (
                <span className="chip chip--quiet" key={muscle}>
                  {MUSCLE_GROUP_LABELS[muscle]}
                </span>
              ))}
          </div>
        </div>
        {onClose ? (
          <button type="button" className="icon-button" aria-label="Close exercise detail" onClick={onClose}>
            <FiX />
          </button>
        ) : null}
      </header>

      {catalogueExercise?.source === 'custom' ? (
        <p className="detail-panel__edit">
          Custom exercise ·{' '}
          <button type="button" className="link-button" onClick={onNavigateSettings}>
            Edit in Settings
          </button>
        </p>
      ) : null}

      {catalogueExercise?.instructions ? (
        <details className="detail-instructions">
          <summary>Instructions</summary>
          <p>{catalogueExercise.instructions}</p>
        </details>
      ) : null}

      {points.length === 0 ? (
        <p className="chart-empty">
          No completed sessions contain this exercise yet. Log a workout from Today to build its
          history.
        </p>
      ) : (
        <>
          <div className="stat-grid">
            <div className="stat">
              <span className="stat__label">Sessions</span>
              <strong className="stat__value">{points.length}</strong>
            </div>
            <div className="stat">
              <span className="stat__label">Total sets</span>
              <strong className="stat__value">{stats.totalSets}</strong>
            </div>
            <div className="stat">
              <span className="stat__label">Best set</span>
              <strong className="stat__value">
                {stats.bestWeight > 0
                  ? `${numberFormat.format(stats.bestWeight)} kg × ${stats.bestReps}`
                  : `${stats.bestReps} reps`}
              </strong>
            </div>
            <div className="stat">
              <span className="stat__label">Total volume</span>
              <strong className="stat__value">
                {compactFormat.format(stats.totalVolume)} kg
              </strong>
            </div>
            <div className="stat">
              <span className="stat__label">PRs</span>
              <strong className="stat__value">{prs.length}</strong>
            </div>
            <div className="stat">
              <span className="stat__label">Performed</span>
              <strong className="stat__value stat__value--small">
                {stats.first ? formatDate(stats.first) : '—'}
                {stats.last && stats.last !== stats.first ? ` – ${formatDate(stats.last)}` : ''}
              </strong>
            </div>
          </div>

          <section className="detail-section">
            <div className="detail-section__head">
              <div>
                <h3 className="detail-section__title">History</h3>
                <p className="card__hint">
                  {effectiveMode === 'reps'
                    ? 'Bodyweight-only history. The chart shows top reps per session.'
                    : effectiveMode === 'volume'
                      ? 'Total session volume for this exercise.'
                      : 'Heaviest set in each completed session.'}
                </p>
              </div>
              {hasWeight ? (
                <div className="segmented" role="group" aria-label="Exercise chart metric">
                  <button
                    type="button"
                    className={`segmented__item${mode === 'weight' ? ' segmented__item--active' : ''}`}
                    aria-pressed={mode === 'weight'}
                    onClick={() => setMode('weight')}
                  >
                    Weight
                  </button>
                  <button
                    type="button"
                    className={`segmented__item${mode === 'volume' ? ' segmented__item--active' : ''}`}
                    aria-pressed={mode === 'volume'}
                    onClick={() => setMode('volume')}
                  >
                    Volume
                  </button>
                </div>
              ) : null}
            </div>
            <TrendChart
              points={chartPoints}
              ariaLabel={
                effectiveMode === 'weight'
                  ? `Top set weight over time for ${name}`
                  : effectiveMode === 'volume'
                    ? `Session volume over time for ${name}`
                    : `Top reps over time for ${name}`
              }
              valueFormat={(value) =>
                effectiveMode === 'reps'
                  ? `${numberFormat.format(value)} reps`
                  : `${numberFormat.format(value)} kg`
              }
            />
          </section>

          <section className="detail-section">
            <h3 className="detail-section__title">Personal records</h3>
            <PrTable prs={prs} onOpenSession={onOpenSession} />
          </section>

          <section className="detail-section">
            <h3 className="detail-section__title">Sessions</h3>
            <ul className="history-list">
              {visiblePoints.map((point) => (
                <li key={`${point.sessionId}-${point.date}`}>
                  <button
                    type="button"
                    className="history-row"
                    onClick={() => onOpenSession(point.sessionId)}
                  >
                    <span className="history-row__date">{formatDate(point.date)}</span>
                    <span className="history-row__main">
                      <strong>
                        {point.topWeight > 0
                          ? `${numberFormat.format(point.topWeight)} kg × ${point.topRepsAtTop}`
                          : `${point.topRepsAtTop} reps`}
                      </strong>
                      <span className="history-row__sets">{formatSetList(point)}</span>
                    </span>
                    <span className="history-row__metric">
                      {compactFormat.format(point.volume)} kg
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {visible < points.length ? (
              <button
                type="button"
                className="button detail-panel__more"
                onClick={() => setVisible((current) => current + 20)}
              >
                Show more sessions
              </button>
            ) : null}
          </section>
        </>
      )}
    </article>
  );
}
