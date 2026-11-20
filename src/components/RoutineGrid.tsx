/**
 * Routine slot grid.
 *
 * The desktop table and mobile week sections share the same slot buttons, so
 * keyboard navigation and focus return behave the same in both layouts.
 */

import type { KeyboardEvent } from 'react';
import { FiCopy, FiMoreHorizontal, FiTrash2 } from 'react-icons/fi';
import {
  addDays,
  daysBetween,
  fromIsoDate,
  isValidIsoDate,
  isoWeekday,
  todayIso,
} from '../domain/date';
import { mondayOf } from '../domain/routine';
import type { Routine, RoutineSlot, Weekday } from '../domain/types';

const WEEKDAYS: Array<{ id: Weekday; short: string; long: string }> = [
  { id: 1, short: 'Mon', long: 'Monday' },
  { id: 2, short: 'Tue', long: 'Tuesday' },
  { id: 3, short: 'Wed', long: 'Wednesday' },
  { id: 4, short: 'Thu', long: 'Thursday' },
  { id: 5, short: 'Fri', long: 'Friday' },
  { id: 6, short: 'Sat', long: 'Saturday' },
  { id: 7, short: 'Sun', long: 'Sunday' },
];

const shortDate = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });

interface RoutineGridProps {
  routine: Routine;
  onEditSlot: (slot: RoutineSlot, trigger: HTMLButtonElement) => void;
  onCopyPreviousWeek: (weekIndex: number) => void;
  onClearWeek: (weekIndex: number) => void;
}

function slotAt(routine: Routine, weekIndex: number, weekday: Weekday): RoutineSlot {
  return (
    routine.slots.find((slot) => slot.weekIndex === weekIndex && slot.weekday === weekday) ?? {
      weekIndex,
      weekday,
      kind: 'rest',
      focus: '',
      note: '',
    }
  );
}

function focusLabel(slot: RoutineSlot): string {
  if (slot.kind === 'rest') return 'Rest';
  return slot.focus.trim() || 'Workout';
}

function slotDescription(slot: RoutineSlot, weekday: string): string {
  const base = `Week ${slot.weekIndex + 1}, ${weekday}, ${focusLabel(slot)}`;
  return `${base}, ${slot.kind}${slot.note ? ', has note' : ''}`;
}

function moveFocus(event: KeyboardEvent<HTMLButtonElement>) {
  const key = event.key;
  if (key !== 'ArrowLeft' && key !== 'ArrowRight' && key !== 'ArrowUp' && key !== 'ArrowDown') {
    return;
  }
  const button = event.currentTarget;
  const week = Number(button.dataset.week);
  const day = Number(button.dataset.day);
  if (!Number.isFinite(week) || !Number.isFinite(day)) return;

  let nextWeek = week;
  let nextDay = day;
  if (key === 'ArrowLeft') nextDay = Math.max(1, day - 1);
  if (key === 'ArrowRight') nextDay = Math.min(7, day + 1);
  if (key === 'ArrowUp') nextWeek = Math.max(0, week - 1);
  if (key === 'ArrowDown') {
    const grid = button.closest<HTMLElement>('[data-routine-grid]');
    const lastWeek = Number(grid?.dataset.lastWeek ?? week);
    nextWeek = Math.min(lastWeek, week + 1);
  }

  const target = button
    .closest<HTMLElement>('.routine-grid__desktop, .routine-grid__mobile')
    ?.querySelector<HTMLButtonElement>(
      `[data-slot-cell][data-week="${nextWeek}"][data-day="${nextDay}"]`,
    );
  if (target) {
    event.preventDefault();
    target.focus();
  }
}

export function RoutineGrid({
  routine,
  onEditSlot,
  onCopyPreviousWeek,
  onClearWeek,
}: RoutineGridProps) {
  const validStart = isValidIsoDate(routine.startDate);
  const anchor = validStart ? mondayOf(routine.startDate) : '';
  const today = todayIso();
  const todayWeekIndex =
    validStart && today >= routine.startDate && routine.weekCount > 0
      ? Math.floor(daysBetween(anchor, today) / 7) % routine.weekCount
      : -1;
  const todayWeekday = isoWeekday(today);

  function renderWeekTools(weekIndex: number) {
    return (
      <details className="week-tools">
        <summary className="icon-button week-tools__trigger" aria-label={`Week ${weekIndex + 1} tools`} title="Week tools">
          <FiMoreHorizontal aria-hidden="true" />
        </summary>
        <div className="week-tools__menu">
          <button
            type="button"
            onClick={(event) => {
              onCopyPreviousWeek(weekIndex);
              event.currentTarget.closest('details')?.removeAttribute('open');
            }}
            disabled={weekIndex === 0}
          >
            <FiCopy aria-hidden="true" /> Copy previous week
          </button>
          <button
            type="button"
            className="week-tools__danger"
            onClick={(event) => {
              onClearWeek(weekIndex);
              event.currentTarget.closest('details')?.removeAttribute('open');
            }}
          >
            <FiTrash2 aria-hidden="true" /> Clear week
          </button>
        </div>
      </details>
    );
  }

  return (
    <div
      className="routine-grid"
      data-routine-grid
      data-last-week={routine.weekCount - 1}
    >
      <div className="routine-grid__desktop">
        <table className="routine-table">
          <caption className="visually-hidden">
            {routine.name} schedule. Each row is a week and each column a weekday.
          </caption>
          <thead>
            <tr>
              <th scope="col" className="routine-table__corner">
                Week
              </th>
              {WEEKDAYS.map((weekday) => (
                <th
                  key={weekday.id}
                  scope="col"
                  className={
                    todayWeekIndex >= 0 && weekday.id === todayWeekday
                      ? 'routine-table__day routine-table__day--today'
                      : 'routine-table__day'
                  }
                >
                  {weekday.short}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: routine.weekCount }, (_, weekIndex) => {
              const weekStart = addDays(anchor, weekIndex * 7);
              const weekEnd = addDays(weekStart, 6);
              return (
                <tr key={weekIndex}>
                  <th scope="row" className="routine-table__week">
                    <span className="routine-table__week-label">Week {weekIndex + 1}</span>
                    <span className="routine-table__week-dates">
                      {validStart
                        ? `${shortDate.format(fromIsoDate(weekStart))} – ${shortDate.format(fromIsoDate(weekEnd))}`
                        : 'Choose a start date'}
                    </span>
                    {renderWeekTools(weekIndex)}
                  </th>
                  {WEEKDAYS.map((weekday) => {
                    const slot = slotAt(routine, weekIndex, weekday.id);
                    const isToday =
                      weekIndex === todayWeekIndex && weekday.id === todayWeekday;
                    return (
                      <td key={weekday.id}>
                        <button
                          type="button"
                          className={`routine-cell routine-cell--${slot.kind}${
                            slot.note ? ' routine-cell--note' : ''
                          }${isToday ? ' routine-cell--today' : ''}`}
                          data-slot-cell
                          data-week={weekIndex}
                          data-day={weekday.id}
                          onClick={(event) => onEditSlot(slot, event.currentTarget)}
                          onKeyDown={moveFocus}
                          aria-label={slotDescription(slot, weekday.long)}
                        >
                          <span className="routine-cell__focus">{focusLabel(slot)}</span>
                          {slot.note && <span className="routine-cell__note-dot" aria-hidden="true" />}
                          {isToday && <span className="routine-cell__today">Today</span>}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="routine-grid__mobile">
        {Array.from({ length: routine.weekCount }, (_, weekIndex) => {
          const weekStart = addDays(anchor, weekIndex * 7);
          const weekEnd = addDays(weekStart, 6);
          return (
            <section className="routine-week" key={weekIndex} aria-label={`Week ${weekIndex + 1}`}>
              <header className="routine-week__head">
                <div>
                  <h3 className="routine-week__title">Week {weekIndex + 1}</h3>
                  <span className="routine-week__dates">
                    {validStart
                      ? `${shortDate.format(fromIsoDate(weekStart))} – ${shortDate.format(fromIsoDate(weekEnd))}`
                      : 'Choose a start date'}
                  </span>
                </div>
                {renderWeekTools(weekIndex)}
              </header>
              <div className="routine-week__days">
                {WEEKDAYS.map((weekday) => {
                  const slot = slotAt(routine, weekIndex, weekday.id);
                  const isToday =
                    weekIndex === todayWeekIndex && weekday.id === todayWeekday;
                  return (
                    <button
                      key={weekday.id}
                      type="button"
                      className={`routine-day routine-day--${slot.kind}${
                        isToday ? ' routine-day--today' : ''
                      }`}
                      data-slot-cell
                      data-week={weekIndex}
                      data-day={weekday.id}
                      onClick={(event) => onEditSlot(slot, event.currentTarget)}
                      onKeyDown={moveFocus}
                      aria-label={slotDescription(slot, weekday.long)}
                    >
                      <span className="routine-day__name">{weekday.short}</span>
                      <span className="routine-day__focus">{focusLabel(slot)}</span>
                      <span className="routine-day__meta">
                        {isToday && <span className="routine-day__today">Today</span>}
                        {slot.note && <span className="routine-cell__note-dot" aria-hidden="true" />}
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>

      <div className="routine-legend" aria-label="Legend">
        <span>
          <span className="routine-legend__dot routine-legend__dot--workout" aria-hidden="true" />
          Workout
        </span>
        <span>
          <span className="routine-legend__dot routine-legend__dot--rest" aria-hidden="true" />
          Rest
        </span>
        <span>
          <span className="routine-legend__dot routine-legend__dot--note" aria-hidden="true" />
          Note
        </span>
      </div>
    </div>
  );
}
