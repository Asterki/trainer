/**
 * Local calendar date helpers.
 *
 * Training dates are calendar days (`YYYY-MM-DD`), not UTC instants. All
 * arithmetic uses local noon so daylight-saving changes never shift a day.
 */

import type { Weekday } from './types';

function pad(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

export function toIsoDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Parses a calendar date into local noon. */
export function fromIsoDate(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, (month ?? 1) - 1, day ?? 1, 12, 0, 0, 0);
}

export function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = fromIsoDate(value);
  return Number.isFinite(date.getTime()) && toIsoDate(date) === value;
}

export function addDays(value: string, days: number): string {
  const date = fromIsoDate(value);
  date.setDate(date.getDate() + days);
  return toIsoDate(date);
}

export function daysBetween(a: string, b: string): number {
  return Math.round((fromIsoDate(b).getTime() - fromIsoDate(a).getTime()) / 86_400_000);
}

export function isoWeekday(value: string): Weekday {
  const day = fromIsoDate(value).getDay();
  return (day === 0 ? 7 : day) as Weekday;
}

/** ISO week key, e.g. `2026-W46`, with Monday as the first day. */
export function isoWeekKey(value: string): string {
  const date = fromIsoDate(value);
  const weekdayIndex = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - weekdayIndex + 3);

  const firstThursday = new Date(date.getFullYear(), 0, 4, 12, 0, 0, 0);
  const firstIndex = (firstThursday.getDay() + 6) % 7;
  firstThursday.setDate(firstThursday.getDate() - firstIndex + 3);

  const week = 1 + Math.round((date.getTime() - firstThursday.getTime()) / (7 * 86_400_000));
  return `${date.getFullYear()}-W${pad(week)}`;
}

export function todayIso(): string {
  return toIsoDate(new Date());
}

/** Milliseconds from now until five seconds after the next local midnight. */
export function millisecondsUntilMidnight(now = new Date()): number {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 5, 0);
  return Math.max(1_000, next.getTime() - now.getTime());
}

export function isValidTimezone(timeZone: string): boolean {
  if (!timeZone) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(0);
    return true;
  } catch {
    return false;
  }
}

export function deviceTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}
