import { useState } from 'react';
import { fromIsoDate } from '../domain/date';
import type { PrEntry } from '../domain/metrics';

interface PrTableProps {
  prs: PrEntry[];
  onOpenSession?: (sessionId: string) => void;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(fromIsoDate(value));
}

export function PrTable({ prs, onOpenSession }: PrTableProps) {
  const [showEmpty, setShowEmpty] = useState(false);
  const byReps = new Map<number, PrEntry>();
  let highReps: PrEntry | null = null;

  for (const entry of prs) {
    if (entry.reps <= 20) {
      byReps.set(entry.reps, entry);
    } else if (
      !highReps ||
      entry.weight > highReps.weight ||
      (entry.weight === highReps.weight && entry.date < highReps.date)
    ) {
      highReps = entry;
    }
  }

  const rows: Array<{ reps: number | '20+'; entry?: PrEntry }> = [];
  for (let reps = 1; reps <= 20; reps += 1) {
    if (showEmpty || byReps.has(reps)) rows.push({ reps, entry: byReps.get(reps) });
  }
  if (showEmpty || highReps) rows.push({ reps: '20+', entry: highReps ?? undefined });

  return (
    <div className="pr-table">
      <div className="pr-table__head">
        <p className="card__hint">
          All-time bests per rep count. Ties go to the earliest date. Bodyweight sets are not
          ranked.
        </p>
        <label className="pr-table__toggle">
          <input
            type="checkbox"
            checked={showEmpty}
            onChange={(event) => setShowEmpty(event.target.checked)}
          />
          Show empty rep ranges
        </label>
      </div>
      {prs.length === 0 ? (
        <p className="chart-empty">No weighted sets recorded yet.</p>
      ) : (
        <div className="table-scroll">
          <table className="data-table pr-table__table">
            <caption className="visually-hidden">Personal records by rep count</caption>
            <thead>
              <tr>
                <th scope="col">Reps</th>
                <th scope="col">Best weight</th>
                <th scope="col">Date</th>
                <th scope="col">Session</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.reps}>
                  <th scope="row">{row.reps}</th>
                  <td>{row.entry ? `${row.entry.weight} kg` : '—'}</td>
                  <td>{row.entry ? formatDate(row.entry.date) : '—'}</td>
                  <td>
                    {row.entry && onOpenSession ? (
                      <button
                        type="button"
                        className="link-button"
                        onClick={() => onOpenSession(row.entry!.sessionId)}
                      >
                        View
                      </button>
                    ) : row.entry ? (
                      formatDate(row.entry.date)
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="pr-table__note">
        Reps above 20 are grouped. The weight shown is the heaviest high-rep set; its exact rep
        count is in the session detail.
      </p>
    </div>
  );
}
