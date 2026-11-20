import { useEffect, useMemo, useState } from 'react';
import { BottomSheet } from '../components/BottomSheet';
import { SessionDetail } from '../components/SessionDetail';
import { normalizeExerciseText } from '../domain/catalogue/wger';
import { addDays, fromIsoDate } from '../domain/date';
import { sessionSummaries } from '../domain/metrics';
import type { Session, SessionStatus } from '../domain/types';
import { useDebouncedValue, useMediaQuery } from '../state/hooks';
import { useTrainer } from '../state/store';

interface HistoryViewProps {
  today: string;
  selectedSessionId: string | null;
  onSelectSession: (sessionId: string | null) => void;
  onOpenToday: () => void;
}

type DatePreset = '30' | '90' | '365' | 'all';
type StatusFilter = 'all' | SessionStatus;

const MONTH_FORMAT = new Intl.DateTimeFormat(undefined, {
  month: 'long',
  year: 'numeric',
});
const DATE_FORMAT = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
});
const compactFormat = new Intl.NumberFormat(undefined, {
  notation: 'compact',
  maximumFractionDigits: 1,
});

function monthKey(value: string): string {
  const date = fromIsoDate(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function formatMonth(value: string): string {
  return MONTH_FORMAT.format(fromIsoDate(`${value}-01`));
}

function groupByMonth(sessions: Session[]): Array<{ month: string; sessions: Session[] }> {
  const groups = new Map<string, Session[]>();
  for (const session of sessions) {
    const key = monthKey(session.date);
    const group = groups.get(key) ?? [];
    group.push(session);
    groups.set(key, group);
  }
  return [...groups.entries()].map(([month, rows]) => ({ month, sessions: rows }));
}

export function HistoryView({
  today,
  selectedSessionId,
  onSelectSession,
  onOpenToday,
}: HistoryViewProps) {
  const { sessions } = useTrainer();
  const [status, setStatus] = useState<StatusFilter>('all');
  const [focus, setFocus] = useState('');
  const [exerciseQuery, setExerciseQuery] = useState('');
  const [datePreset, setDatePreset] = useState<DatePreset>('90');
  const [visible, setVisible] = useState(50);
  const debouncedExercise = useDebouncedValue(exerciseQuery, 150);
  const isMobile = useMediaQuery('(max-width: 860px)');

  const focuses = useMemo(
    () => [...new Set(sessions.map((session) => session.focus))].sort((a, b) => a.localeCompare(b)),
    [sessions],
  );
  const exerciseNames = useMemo(() => {
    const names = new Map<string, string>();
    for (const session of sessions) {
      for (const row of session.exercises) {
        names.set(normalizeExerciseText(row.name), row.name);
      }
    }
    return [...names.values()].sort((a, b) => a.localeCompare(b));
  }, [sessions]);
  const summaries = useMemo(() => sessionSummaries(sessions), [sessions]);

  const filtered = useMemo(() => {
    const normalizedExercise = normalizeExerciseText(debouncedExercise);
    const firstDate =
      datePreset === 'all' ? null : addDays(today, -(Number(datePreset) - 1));

    return sessions
      .filter((session) => {
        if (status !== 'all' && session.status !== status) return false;
        if (focus && session.focus !== focus) return false;
        if (firstDate && session.date < firstDate) return false;
        if (
          normalizedExercise &&
          !session.exercises.some((row) =>
            normalizeExerciseText(row.name).includes(normalizedExercise),
          )
        ) {
          return false;
        }
        return true;
      })
      .sort((a, b) => b.date.localeCompare(a.date) || b.updatedAt.localeCompare(a.updatedAt));
  }, [datePreset, debouncedExercise, focus, sessions, status, today]);

  useEffect(() => {
    setVisible(50);
  }, [datePreset, debouncedExercise, focus, status]);

  const groups = groupByMonth(filtered.slice(0, visible));
  const selectedSession = selectedSessionId
    ? sessions.find((session) => session.id === selectedSessionId) ?? null
    : null;
  const hasFilters = status !== 'all' || focus !== '' || exerciseQuery !== '' || datePreset !== '90';

  const clearFilters = () => {
    setStatus('all');
    setFocus('');
    setExerciseQuery('');
    setDatePreset('90');
  };

  const detail = selectedSession ? (
    <SessionDetail
      session={selectedSession}
      onClose={isMobile ? undefined : () => onSelectSession(null)}
    />
  ) : null;

  return (
    <div className="view history-view">
      <header className="view__header view__header--hero">
        <div>
          <p className="view__eyebrow">History</p>
          <h1 className="view__title">History</h1>
          <p className="view__subtitle">
            Every logged session, newest first. History is read-only.
          </p>
        </div>
        {sessions.length > 0 ? (
          <span className="history-count">
            {sessions.length} session{sessions.length === 1 ? '' : 's'}
          </span>
        ) : null}
      </header>

      {sessions.length === 0 ? (
        <div className="card empty-state">
          <h2 className="card__title">No history yet</h2>
          <p className="empty-state__copy">
            Completed and skipped sessions will appear here once your routine starts.
          </p>
          <button type="button" className="button button--primary" onClick={onOpenToday}>
            Go to Today
          </button>
        </div>
      ) : (
        <div className={`history-layout${selectedSession ? ' history-layout--detail' : ''}`}>
          <div className="history-main">
            <div className="history-filters card">
              <label className="field">
                <span className="field__label">Status</span>
                <select
                  className="input"
                  value={status}
                  onChange={(event) => setStatus(event.target.value as StatusFilter)}
                >
                  <option value="all">All statuses</option>
                  <option value="completed">Completed</option>
                  <option value="skipped">Skipped</option>
                </select>
              </label>
              <label className="field">
                <span className="field__label">Focus</span>
                <select
                  className="input"
                  value={focus}
                  onChange={(event) => setFocus(event.target.value)}
                >
                  <option value="">All focuses</option>
                  {focuses.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span className="field__label">Exercise</span>
                <input
                  className="input"
                  type="search"
                  list="history-exercises"
                  placeholder="Any exercise"
                  value={exerciseQuery}
                  onChange={(event) => setExerciseQuery(event.target.value)}
                />
                <datalist id="history-exercises">
                  {exerciseNames.map((name) => (
                    <option key={name} value={name} />
                  ))}
                </datalist>
              </label>
              <label className="field">
                <span className="field__label">Date range</span>
                <select
                  className="input"
                  value={datePreset}
                  onChange={(event) => setDatePreset(event.target.value as DatePreset)}
                >
                  <option value="30">Last 30 days</option>
                  <option value="90">Last 90 days</option>
                  <option value="365">Last year</option>
                  <option value="all">All time</option>
                </select>
              </label>
            </div>

            {filtered.length === 0 ? (
              <div className="card empty-state">
                <h2 className="card__title">No sessions match these filters</h2>
                <p className="empty-state__copy">
                  Try a wider date range or clear the focus and exercise filters.
                </p>
                <button type="button" className="button" onClick={clearFilters}>
                  Clear filters
                </button>
              </div>
            ) : (
              <>
                {groups.map((group) => (
                  <section className="history-group" key={group.month}>
                    <h2 className="history-group__title">{formatMonth(group.month)}</h2>
                    <ul className="history-list">
                      {group.sessions.map((session) => {
                        const summary = summaries.get(session.id);
                        const isSkipped = session.status === 'skipped';
                        return (
                          <li key={session.id}>
                            <button
                              type="button"
                              className="history-row history-row--full"
                              onClick={() => onSelectSession(session.id)}
                            >
                              <span className="history-row__date">
                                {DATE_FORMAT.format(fromIsoDate(session.date))}
                              </span>
                              <span className="history-row__main">
                                <span className="history-row__title">
                                  <strong>{session.focus}</strong>
                                  {session.source === 'manual' ? (
                                    <span className="badge badge--quiet">Ad-hoc</span>
                                  ) : null}
                                </span>
                                <span className="history-row__sets">
                                  {session.routineName || 'No routine'}
                                  {session.weekIndex !== null
                                    ? ` · Week ${session.weekIndex + 1}`
                                    : ''}
                                </span>
                              </span>
                              <span className="history-row__metrics">
                                {isSkipped ? (
                                  <span className="history-row__empty">No workout logged</span>
                                ) : (
                                  <>
                                    <span>
                                      {summary?.sets ?? 0} sets · {summary?.exercises ?? 0}{' '}
                                      exercises
                                    </span>
                                    <span>
                                      {compactFormat.format(summary?.volume ?? 0)} kg
                                    </span>
                                  </>
                                )}
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
                ))}
                {visible < filtered.length ? (
                  <button
                    type="button"
                    className="button history-more"
                    onClick={() => setVisible((current) => current + 50)}
                  >
                    Load more
                  </button>
                ) : null}
                {hasFilters ? (
                  <button type="button" className="link-button" onClick={clearFilters}>
                    Clear filters
                  </button>
                ) : null}
              </>
            )}
          </div>

          {!isMobile && detail ? <aside className="history-detail-pane">{detail}</aside> : null}
        </div>
      )}

      {isMobile && detail ? (
        <BottomSheet
          open
          title="Session detail"
          className="sheet--full"
          onClose={() => onSelectSession(null)}
        >
          {detail}
        </BottomSheet>
      ) : null}
    </div>
  );
}
