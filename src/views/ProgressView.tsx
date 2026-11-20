import { useEffect, useMemo, useState } from 'react';
import { FiArrowRight } from 'react-icons/fi';
import { BottomSheet } from '../components/BottomSheet';
import { ExerciseDetail } from '../components/ExerciseDetail';
import { MuscleBars } from '../components/MuscleBars';
import { RangePicker } from '../components/RangePicker';
import { StackedBars } from '../components/charts/StackedBars';
import { TrendChart } from '../components/charts/TrendChart';
import { MUSCLE_GROUPS, MUSCLE_GROUP_LABELS } from '../domain/catalogue/groups';
import { loadCatalogue, normalizeExerciseText } from '../domain/catalogue/wger';
import { addDays, fromIsoDate } from '../domain/date';
import {
  adherence,
  muscleWeeks,
  recentPrs,
  sessionSummaries,
  weeksRangeStart,
} from '../domain/metrics';
import { sessionSetCount, sessionVolume } from '../domain/session';
import type { MuscleGroupId } from '../domain/types';
import { useDebouncedValue, useMediaQuery } from '../state/hooks';
import { useTrainer } from '../state/store';

interface ProgressViewProps {
  today: string;
  onOpenToday: () => void;
  onOpenSession: (sessionId: string) => void;
  onOpenSettings: () => void;
  onOpenHistory: () => void;
}

type ProgressTab = 'overview' | 'exercises' | 'muscles';

interface ExerciseRow {
  exerciseId: string;
  name: string;
  primaryMuscles: MuscleGroupId[];
  secondaryMuscles: MuscleGroupId[];
  sessions: Set<string>;
  latest: string;
  bestWeight: number;
  bestReps: number;
  totalVolume: number;
}

const compactFormat = new Intl.NumberFormat(undefined, {
  notation: 'compact',
  maximumFractionDigits: 1,
});
const numberFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });

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

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export function ProgressView({
  today,
  onOpenToday,
  onOpenSession,
  onOpenSettings,
  onOpenHistory,
}: ProgressViewProps) {
  const { sessions, customExercises } = useTrainer();
  const [tab, setTab] = useState<ProgressTab>('overview');
  const [range, setRange] = useState(12);
  const [trendMuscle, setTrendMuscle] = useState<MuscleGroupId>('pectoralis-major');
  const [muscleMetric, setMuscleMetric] = useState<'volume' | 'sets'>('volume');
  const [showMuscleTable, setShowMuscleTable] = useState(false);
  const [selectedExercise, setSelectedExercise] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [muscleFilter, setMuscleFilter] = useState<MuscleGroupId | ''>('');
  const [catalogueNames, setCatalogueNames] = useState<Record<string, string>>({});
  const debouncedQuery = useDebouncedValue(query, 150);
  const isMobile = useMediaQuery('(max-width: 860px)');

  useEffect(() => {
    let active = true;
    void loadCatalogue(customExercises).then((catalogue) => {
      if (!active) return;
      setCatalogueNames(
        Object.fromEntries(catalogue.map((exercise) => [exercise.id, exercise.name])),
      );
    });
    return () => {
      active = false;
    };
  }, [customExercises]);

  const overview = useMemo(() => {
    const first = weeksRangeStart(today, range);
    const completed = sessions.filter(
      (session) =>
        session.status === 'completed' && session.date >= first && session.date <= today,
    );
    const sets = completed.reduce((total, session) => total + sessionSetCount(session), 0);
    const volume = completed.reduce((total, session) => total + sessionVolume(session), 0);
    const adherenceData = adherence(sessions, range, today);
    const weeks = muscleWeeks(sessions, range, today);
    const muscleTotals: Partial<Record<MuscleGroupId, number>> = {};
    const setTotals: Partial<Record<MuscleGroupId, number>> = {};

    for (const week of weeks) {
      for (const muscle of MUSCLE_GROUPS) {
        muscleTotals[muscle.id] = (muscleTotals[muscle.id] ?? 0) + (week.muscles[muscle.id] ?? 0);
        setTotals[muscle.id] = (setTotals[muscle.id] ?? 0) + (week.sets[muscle.id] ?? 0);
      }
    }

    return {
      completed,
      sets,
      volume,
      adherence: adherenceData,
      weeks,
      muscleTotals,
      setTotals,
      prs: recentPrs(sessions, 30, today),
      recent: [...sessions]
        .filter((session) => session.status === 'completed' || session.status === 'skipped')
        .sort((a, b) => b.date.localeCompare(a.date))
        .slice(0, 5),
      summaries: sessionSummaries(sessions),
    };
  }, [range, sessions, today]);

  const exerciseRows = useMemo(() => {
    const rows = new Map<string, ExerciseRow>();
    const completed = sessions
      .filter((session) => session.status === 'completed')
      .sort((a, b) => a.date.localeCompare(b.date));

    for (const session of completed) {
      for (const row of session.exercises) {
        let entry = rows.get(row.exerciseId);
        if (!entry) {
          entry = {
            exerciseId: row.exerciseId,
            name: row.name,
            primaryMuscles: row.primaryMuscles,
            secondaryMuscles: row.secondaryMuscles,
            sessions: new Set<string>(),
            latest: session.date,
            bestWeight: 0,
            bestReps: 0,
            totalVolume: 0,
          };
          rows.set(row.exerciseId, entry);
        }
        entry.sessions.add(session.id);
        entry.name = row.name;
        entry.primaryMuscles = row.primaryMuscles;
        entry.secondaryMuscles = row.secondaryMuscles;
        if (session.date > entry.latest) entry.latest = session.date;
        for (const set of row.sets) {
          entry.totalVolume += set.weight * set.reps;
          if (
            set.weight > entry.bestWeight ||
            (set.weight === entry.bestWeight && set.reps > entry.bestReps)
          ) {
            entry.bestWeight = set.weight;
            entry.bestReps = set.reps;
          }
        }
      }
    }

    const normalizedQuery = normalizeExerciseText(debouncedQuery);
    return [...rows.values()]
      .filter((row) => {
        if (
          normalizedQuery &&
          !normalizeExerciseText(row.name).includes(normalizedQuery)
        ) {
          return false;
        }
        if (
          muscleFilter &&
          !row.primaryMuscles.includes(muscleFilter) &&
          !row.secondaryMuscles.includes(muscleFilter)
        ) {
          return false;
        }
        return true;
      })
      .sort((a, b) => b.latest.localeCompare(a.latest) || a.name.localeCompare(b.name));
  }, [debouncedQuery, muscleFilter, sessions]);

  const hasCompleted = overview.completed.length > 0;
  const rangeStart = weeksRangeStart(today, range);
  const weekLabels = Array.from({ length: range }, (_, index) => shortDate(addDays(rangeStart, index * 7)));
  const adherenceBars = overview.adherence.buckets
    .map((bucket, index) => ({
      label: weekLabels[index] ?? bucket.week,
      completed: bucket.completed,
      skipped: bucket.skipped,
    }))
    .slice(-Math.min(8, range));
  const trendValues = overview.weeks.map(
    (week) => (muscleMetric === 'volume' ? week.muscles[trendMuscle] : week.sets[trendMuscle]) ?? 0,
  );
  const trendPoints = overview.weeks.map((week, index) => ({
    label: weekLabels[index] ?? week.week,
    value: trendValues[index] ?? 0,
    detail:
      muscleMetric === 'volume'
        ? `${numberFormat.format(trendValues[index] ?? 0)} kg`
        : `${numberFormat.format(trendValues[index] ?? 0)} weighted sets`,
  }));

  useEffect(() => {
    if (overview.weeks.length === 0) return;
    const current = overview.weeks.reduce(
      (total, week) => total + (week.muscles[trendMuscle] ?? 0),
      0,
    );
    if (current > 0) return;
    const next = MUSCLE_GROUPS.find((muscle) =>
      overview.weeks.some((week) => (week.muscles[muscle.id] ?? 0) > 0),
    );
    if (next && next.id !== trendMuscle) setTrendMuscle(next.id);
  }, [overview.weeks, trendMuscle]);

  const openExercise = (exerciseId: string) => {
    setSelectedExercise(exerciseId);
    setTab('exercises');
  };

  const exerciseDetail = selectedExercise ? (
    <ExerciseDetail
      exerciseId={selectedExercise}
      onOpenSession={onOpenSession}
      onNavigateSettings={onOpenSettings}
      onClose={isMobile ? undefined : () => setSelectedExercise(null)}
    />
  ) : null;

  return (
    <div className="view progress-view">
      <header className="view__header view__header--hero">
        <div>
          <p className="view__eyebrow">Progress</p>
          <h1 className="view__title">Progress</h1>
          <p className="view__subtitle">
            Personal records, training volume and routine adherence, derived from your logs.
          </p>
        </div>
      </header>

      {!hasCompleted ? (
        <div className="card empty-state">
          <span className="empty-state__mark" aria-hidden="true">
            <FiArrowRight />
          </span>
          <h2 className="card__title">No completed sessions yet</h2>
          <p className="empty-state__copy">
            Finish a workout on Today and your PRs, volume and adherence will appear here.
          </p>
          <button type="button" className="button button--primary" onClick={onOpenToday}>
            Go to Today
          </button>
        </div>
      ) : (
        <>
          <div className="segmented progress-tabs" role="group" aria-label="Progress section">
            {(
              [
                ['overview', 'Overview'],
                ['exercises', 'Exercises'],
                ['muscles', 'Muscles'],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={`segmented__item${tab === value ? ' segmented__item--active' : ''}`}
                aria-pressed={tab === value}
                onClick={() => setTab(value)}
              >
                {label}
              </button>
            ))}
          </div>

          {tab === 'overview' ? (
            <>
              <div className="progress-toolbar">
                <RangePicker value={range} onChange={setRange} />
              </div>
              <div className="stat-grid stat-grid--overview">
                <div className="stat">
                  <span className="stat__label">Workouts completed</span>
                  <strong className="stat__value">{overview.completed.length}</strong>
                  <span className="stat__hint">in the last {range} weeks</span>
                </div>
                <div className="stat">
                  <span className="stat__label">Total volume</span>
                  <strong className="stat__value">
                    {compactFormat.format(overview.volume)} kg
                  </strong>
                  <span className="stat__hint">weight × reps</span>
                </div>
                <div className="stat">
                  <span className="stat__label">Sets logged</span>
                  <strong className="stat__value">{overview.sets}</strong>
                  <span className="stat__hint">completed sessions only</span>
                </div>
                <div className="stat">
                  <span className="stat__label">Adherence</span>
                  <strong className="stat__value">
                    {overview.adherence.summary.rate === null
                      ? '—'
                      : percent(overview.adherence.summary.rate)}
                  </strong>
                  <span className="stat__hint">
                    {overview.adherence.summary.completed} of{' '}
                    {overview.adherence.summary.scheduled} scheduled
                  </span>
                </div>
              </div>

              <section className="card progress-section">
                <div className="progress-section__head">
                  <div>
                    <h2 className="card__title">Adherence</h2>
                    <p className="card__hint">
                      Completed and skipped scheduled sessions. Rest days and ad-hoc workouts are
                      excluded from the rate. The chart shows up to the last eight weeks.
                    </p>
                  </div>
                </div>
                <StackedBars
                  data={adherenceBars}
                  ariaLabel={`Completed and skipped scheduled sessions over the last ${adherenceBars.length} weeks`}
                />
                {overview.adherence.summary.adHocCompleted > 0 ? (
                  <p className="card__hint">
                    {overview.adherence.summary.adHocCompleted} ad-hoc workout
                    {overview.adherence.summary.adHocCompleted === 1 ? '' : 's'} completed outside
                    the schedule.
                  </p>
                ) : null}
              </section>

              <section className="card progress-section">
                <div className="progress-section__head">
                  <div>
                    <h2 className="card__title">Muscle balance</h2>
                    <p className="card__hint">
                      Volume = weight × reps. Primary muscles get full credit, secondary half.
                    </p>
                  </div>
                  <button
                    type="button"
                    className="link-button"
                    onClick={() => setTab('muscles')}
                  >
                    Muscle details
                  </button>
                </div>
                <MuscleBars
                  values={overview.muscleTotals}
                  valueLabel="kg"
                  format={(value) => compactFormat.format(value)}
                  emptyText="No muscle volume in this range."
                />
              </section>

              <section className="card progress-section">
                <div className="progress-section__head">
                  <div>
                    <h2 className="card__title">Recent PRs</h2>
                    <p className="card__hint">
                      All-time bests first achieved in the last 30 days.
                    </p>
                  </div>
                </div>
                {overview.prs.length === 0 ? (
                  <p className="chart-empty">No new all-time bests in the last 30 days.</p>
                ) : (
                  <ul className="pr-recent">
                    {overview.prs.slice(0, 6).map((entry) => (
                      <li key={`${entry.exerciseId}-${entry.reps}`}>
                        <button
                          type="button"
                          className="pr-recent__row"
                          onClick={() => openExercise(entry.exerciseId)}
                        >
                          <span>
                            <strong>{entry.name}</strong>
                            <span className="pr-recent__detail">
                              {entry.weight} kg × {entry.reps} reps
                            </span>
                          </span>
                          <span className="pr-recent__date">{formatDate(entry.date)}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section className="card progress-section">
                <div className="progress-section__head">
                  <div>
                    <h2 className="card__title">Recent sessions</h2>
                    <p className="card__hint">Completed and skipped sessions, newest first.</p>
                  </div>
                  <button type="button" className="link-button" onClick={onOpenHistory}>
                    View history
                  </button>
                </div>
                <ul className="history-list">
                  {overview.recent.map((session) => {
                    const summary = overview.summaries.get(session.id);
                    return (
                      <li key={session.id}>
                        <button
                          type="button"
                          className="history-row"
                          onClick={() => onOpenSession(session.id)}
                        >
                          <span className="history-row__date">{formatDate(session.date)}</span>
                          <span className="history-row__main">
                            <strong>{session.focus}</strong>
                            <span className="history-row__sets">
                              {session.status === 'skipped'
                                ? 'No workout logged'
                                : `${summary?.sets ?? 0} sets · ${summary?.exercises ?? 0} exercises`}
                            </span>
                          </span>
                          <span className={`badge badge--${session.status}`}>
                            {session.status === 'completed' ? 'Completed' : 'Skipped'}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            </>
          ) : null}

          {tab === 'exercises' ? (
            <div className={`progress-split${selectedExercise ? ' progress-split--detail' : ''}`}>
              <div className="progress-list-pane">
                <div className="progress-toolbar progress-toolbar--filters">
                  <label className="search-field">
                    <span className="visually-hidden">Search exercises</span>
                    <input
                      className="input"
                      type="search"
                      placeholder="Search exercises"
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                    />
                  </label>
                  <label className="field field--inline">
                    <span className="field__label">Muscle</span>
                    <select
                      className="input"
                      value={muscleFilter}
                      onChange={(event) =>
                        setMuscleFilter(event.target.value as MuscleGroupId | '')
                      }
                    >
                      <option value="">All muscles</option>
                      {MUSCLE_GROUPS.map((muscle) => (
                        <option key={muscle.id} value={muscle.id}>
                          {muscle.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                {exerciseRows.length === 0 ? (
                  <p className="chart-empty">
                    {sessions.some((session) => session.status === 'completed')
                      ? 'No exercises match these filters.'
                      : 'No completed exercises yet.'}
                  </p>
                ) : (
                  <ul className="exercise-index">
                    {exerciseRows.map((row) => (
                      <li key={row.exerciseId}>
                        <button
                          type="button"
                          className="exercise-index__row"
                          aria-current={selectedExercise === row.exerciseId ? 'true' : undefined}
                          onClick={() => setSelectedExercise(row.exerciseId)}
                        >
                          <span className="exercise-index__main">
                            <strong>{catalogueNames[row.exerciseId] ?? row.name}</strong>
                            <span className="exercise-index__muscles">
                              {row.primaryMuscles
                                .map((muscle) => MUSCLE_GROUP_LABELS[muscle])
                                .join(' · ')}
                            </span>
                          </span>
                          <span className="exercise-index__metric">
                            <strong>
                              {row.bestWeight > 0
                                ? `${numberFormat.format(row.bestWeight)} × ${row.bestReps}`
                                : `${row.bestReps} reps`}
                            </strong>
                            <span>
                              {row.sessions.size} session{row.sessions.size === 1 ? '' : 's'}
                            </span>
                          </span>
                          <span className="exercise-index__date">{shortDate(row.latest)}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              {!isMobile && exerciseDetail ? (
                <aside className="progress-detail-pane">{exerciseDetail}</aside>
              ) : null}
            </div>
          ) : null}

          {tab === 'muscles' ? (
            <>
              <div className="progress-toolbar">
                <RangePicker value={range} onChange={setRange} />
                <div className="segmented" role="group" aria-label="Muscle metric">
                  <button
                    type="button"
                    className={`segmented__item${muscleMetric === 'volume' ? ' segmented__item--active' : ''}`}
                    aria-pressed={muscleMetric === 'volume'}
                    onClick={() => setMuscleMetric('volume')}
                  >
                    Volume
                  </button>
                  <button
                    type="button"
                    className={`segmented__item${muscleMetric === 'sets' ? ' segmented__item--active' : ''}`}
                    aria-pressed={muscleMetric === 'sets'}
                    onClick={() => setMuscleMetric('sets')}
                  >
                    Weighted sets
                  </button>
                </div>
              </div>
              <p className="definition-line">
                Volume = weight × reps. Primary muscles get full credit, secondary half.
              </p>

              <section className="card progress-section">
                <div className="progress-section__head">
                  <h2 className="card__title">
                    {muscleMetric === 'volume' ? 'Volume by muscle' : 'Weighted sets by muscle'}
                  </h2>
                </div>
                <MuscleBars
                  values={muscleMetric === 'volume' ? overview.muscleTotals : overview.setTotals}
                  valueLabel={muscleMetric === 'volume' ? 'kg' : 'weighted sets'}
                  format={(value) => compactFormat.format(value)}
                  defaultLimit={18}
                />
                <button
                  type="button"
                  className="button progress-section__table-toggle"
                  onClick={() => setShowMuscleTable((current) => !current)}
                >
                  {showMuscleTable ? 'Hide table' : 'Show table'}
                </button>
                {showMuscleTable ? (
                  <div className="table-scroll">
                    <table className="data-table">
                      <caption className="visually-hidden">
                        Muscle volume and weighted sets in the selected range
                      </caption>
                      <thead>
                        <tr>
                          <th scope="col">Muscle</th>
                          <th scope="col">Volume (kg)</th>
                          <th scope="col">Weighted sets</th>
                        </tr>
                      </thead>
                      <tbody>
                        {MUSCLE_GROUPS.map((muscle) => (
                          <tr key={muscle.id}>
                            <th scope="row">{muscle.label}</th>
                            <td>{numberFormat.format(overview.muscleTotals[muscle.id] ?? 0)}</td>
                            <td>{numberFormat.format(overview.setTotals[muscle.id] ?? 0)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}
              </section>

              <section className="card progress-section">
                <div className="progress-section__head">
                  <div>
                    <h2 className="card__title">Weekly trend</h2>
                    <p className="card__hint">
                      {muscleMetric === 'volume'
                        ? 'Attributed volume per ISO week.'
                        : 'Weighted sets per ISO week.'}
                    </p>
                  </div>
                  <label className="field field--inline">
                    <span className="field__label">Muscle</span>
                    <select
                      className="input"
                      value={trendMuscle}
                      onChange={(event) => setTrendMuscle(event.target.value as MuscleGroupId)}
                    >
                      {MUSCLE_GROUPS.map((muscle) => (
                        <option key={muscle.id} value={muscle.id}>
                          {muscle.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <TrendChart
                  points={trendPoints}
                  ariaLabel={`${MUSCLE_GROUP_LABELS[trendMuscle]} ${
                    muscleMetric === 'volume' ? 'volume' : 'weighted sets'
                  } over ${range} weeks`}
                  valueFormat={(value) =>
                    muscleMetric === 'volume'
                      ? `${numberFormat.format(value)} kg`
                      : `${numberFormat.format(value)} weighted sets`
                  }
                />
              </section>
            </>
          ) : null}
        </>
      )}

      {isMobile && exerciseDetail ? (
        <BottomSheet
          open
          title="Exercise detail"
          className="sheet--full"
          onClose={() => setSelectedExercise(null)}
        >
          {exerciseDetail}
        </BottomSheet>
      ) : null}
    </div>
  );
}
