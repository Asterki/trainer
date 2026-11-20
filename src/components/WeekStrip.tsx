import { FiCheck, FiSlash } from 'react-icons/fi';
import { addDays, fromIsoDate } from '../domain/date';
import { mondayOf, resolveSlot } from '../domain/routine';
import type { IsoDate, Routine, Session } from '../domain/types';

interface WeekStripProps {
  today: IsoDate;
  routine: Routine | null;
  sessions: Session[];
  onSelectDate: (date: IsoDate) => void;
}

export function WeekStrip({ today, routine, sessions, onSelectDate }: WeekStripProps) {
  const monday = mondayOf(today);
  const byDate = new Map(sessions.map((session) => [session.date, session]));
  const weekdayFormat = new Intl.DateTimeFormat(undefined, { weekday: 'narrow' });

  return (
    <section className="week-strip card" aria-label="This week">
      {Array.from({ length: 7 }, (_, index) => addDays(monday, index)).map((date) => {
        const session = byDate.get(date);
        const slot = routine ? resolveSlot(routine, date) : null;
        const isRest = slot?.kind === 'rest';
        const isToday = date === today;
        const clickable = Boolean(session && date < today);
        const dateValue = fromIsoDate(date);

        let status = '';
        if (session?.status === 'completed') status = 'completed';
        else if (session?.status === 'skipped') status = 'skipped';
        else if (session) status = 'session';
        else if (isRest) status = 'rest';

        const label = [
          new Intl.DateTimeFormat(undefined, {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
          }).format(dateValue),
          isToday ? 'today' : '',
          session?.status ?? status,
        ]
          .filter(Boolean)
          .join(', ');

        return (
          <button
            key={date}
            type="button"
            className={`week-strip__day${isToday ? ' week-strip__day--today' : ''}${
              clickable ? ' week-strip__day--link' : ''
            }`}
            disabled={!clickable}
            onClick={() => onSelectDate(date)}
            aria-label={label}
          >
            <span className="week-strip__weekday">{weekdayFormat.format(dateValue)}</span>
            <span className="week-strip__number">{dateValue.getDate()}</span>
            <span className={`week-strip__status week-strip__status--${status || 'none'}`}>
              {status === 'completed' ? (
                <FiCheck aria-hidden="true" />
              ) : status === 'skipped' ? (
                <FiSlash aria-hidden="true" />
              ) : status === 'rest' ? (
                <span className="week-strip__rest" aria-hidden="true" />
              ) : status === 'session' ? (
                <span className="week-strip__dot" aria-hidden="true" />
              ) : null}
            </span>
          </button>
        );
      })}
    </section>
  );
}
