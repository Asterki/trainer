/** Read-only preview of the next two weeks for a routine draft. */

import { FiCalendar } from 'react-icons/fi';
import { fromIsoDate, isValidIsoDate, todayIso } from '../domain/date';
import { upcomingSlots } from '../domain/routine';
import type { Routine } from '../domain/types';

const dayFormat = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
});

const startFormat = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
});

export function RoutinePreview({ routine }: { routine: Routine }) {
  const today = todayIso();
  const validStart = isValidIsoDate(routine.startDate);
  const startsInFuture = validStart && routine.startDate > today;
  const from = startsInFuture ? routine.startDate : today;
  const slots = validStart ? upcomingSlots(routine, from, 14) : [];

  return (
    <section className="routine-preview" aria-labelledby="routine-preview-title">
      <div className="routine-preview__head">
        <span className="routine-preview__icon" aria-hidden="true">
          <FiCalendar />
        </span>
        <div>
          <h2 className="routine-preview__title" id="routine-preview-title">
            Next 14 days
          </h2>
          <p className="routine-preview__hint">
            {!validStart
              ? 'Choose a valid start date to see the cycle.'
              : startsInFuture
                ? `This routine starts ${startFormat.format(fromIsoDate(routine.startDate))}; the preview begins there.`
                : 'What the cycle resolves to from today. Saved sessions are never rewritten.'}
          </p>
        </div>
      </div>

      {slots.length === 0 ? (
        <p className="empty-note">
          {validStart ? 'Add a workout day to see the preview.' : 'The preview appears once the start date is valid.'}
        </p>
      ) : (
        <ol className="routine-preview__list">
          {slots.map((slot) => {
            const date = fromIsoDate(slot.date);
            return (
              <li
                className={`routine-preview__row${
                  slot.date === today ? ' routine-preview__row--today' : ''
                }`}
                key={slot.date}
              >
                <span className="routine-preview__date">
                  {dayFormat.format(date)}
                  {slot.date === today && <span className="badge badge--quiet">Today</span>}
                </span>
                <span className="routine-preview__week">Week {slot.weekIndex + 1}</span>
                <span
                  className={
                    slot.kind === 'workout'
                      ? 'routine-preview__focus'
                      : 'routine-preview__focus routine-preview__focus--rest'
                  }
                >
                  {slot.kind === 'workout' ? slot.focus.trim() || 'Workout' : 'Rest'}
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
