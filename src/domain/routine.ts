/**
 * Cycle arithmetic for routines.
 *
 * A routine is a Monday-anchored grid of weeks. The calendar date is the
 * source of truth; stored dates never shift with timezone or DST changes.
 */

import { addDays, daysBetween, isValidIsoDate, isoWeekday } from './date';
import type { IsoDate, Routine, Weekday } from './types';

export interface ResolvedSlot {
  weekIndex: number;
  weekday: Weekday;
  kind: 'workout' | 'rest';
  focus: string;
  note: string;
  date: IsoDate;
}

/** Monday of the calendar week containing `date`. */
export function mondayOf(date: IsoDate): IsoDate {
  return addDays(date, 1 - isoWeekday(date));
}

/** Week 0 always starts on the Monday of the start date's week. */
export function cycleStart(routine: Routine): IsoDate {
  return mondayOf(routine.startDate);
}

function validCycle(routine: Routine): boolean {
  return (
    isValidIsoDate(routine.startDate) &&
    Number.isInteger(routine.weekCount) &&
    routine.weekCount >= 1 &&
    routine.weekCount <= 12 &&
    routine.slots.length > 0
  );
}

/**
 * Resolves one date against the repeating cycle.
 *
 * Dates before the routine start return `null`. A missing grid cell is treated
 * as rest so corrupt data cannot crash a view.
 */
export function resolveSlot(routine: Routine, date: IsoDate): ResolvedSlot | null {
  if (!validCycle(routine) || !isValidIsoDate(date)) return null;
  if (date < routine.startDate) return null;

  const anchor = cycleStart(routine);
  const days = daysBetween(anchor, date);
  if (days < 0) return null;

  const weekIndex = Math.floor(days / 7) % routine.weekCount;
  const weekday = isoWeekday(date);
  const slot = routine.slots.find(
    (candidate) => candidate.weekIndex === weekIndex && candidate.weekday === weekday,
  );

  if (!slot) {
    return { weekIndex, weekday, kind: 'rest', focus: '', note: '', date };
  }

  return {
    weekIndex,
    weekday,
    kind: slot.kind === 'workout' ? 'workout' : 'rest',
    focus: slot.kind === 'workout' ? slot.focus : '',
    note: slot.note,
    date,
  };
}

/** Inclusive list of resolved days beginning at `from`. */
export function upcomingSlots(routine: Routine, from: IsoDate, days: number): ResolvedSlot[] {
  if (!Number.isFinite(days) || days <= 0 || !isValidIsoDate(from)) return [];
  const count = Math.floor(days);
  const slots: ResolvedSlot[] = [];
  for (let index = 0; index < count; index += 1) {
    const slot = resolveSlot(routine, addDays(from, index));
    if (slot) slots.push(slot);
  }
  return slots;
}

/** First workout on or after `from`, scanning at most two full cycles. */
export function nextWorkout(routine: Routine, from: IsoDate): ResolvedSlot | null {
  if (!validCycle(routine) || !isValidIsoDate(from)) return null;
  const limit = routine.weekCount * 7 * 2;
  for (let offset = 0; offset < limit; offset += 1) {
    const slot = resolveSlot(routine, addDays(from, offset));
    if (slot?.kind === 'workout') return slot;
  }
  return null;
}
