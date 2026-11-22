import { isValidTimezone, todayInTimezone } from '../trainer/date.js';

const configured = process.env.TRAINER_TIMEZONE ?? 'UTC';

/** Relay calendar timezone. An invalid value falls back to UTC rather than crashing. */
export const RELAY_TIMEZONE = isValidTimezone(configured) ? configured : 'UTC';

export function relayToday(): string {
  return todayInTimezone(RELAY_TIMEZONE);
}
