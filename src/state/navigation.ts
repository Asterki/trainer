/** Navigation model shared by the shell, the rail and the bottom tab bar. */

export type ViewKey = 'today' | 'routine' | 'progress' | 'history' | 'settings';

export interface NavState {
  view: ViewKey;
  /** Optional date or entity the view should focus. */
  date: string | null;
  sessionId: string | null;
  exerciseId: string | null;
}

export const INITIAL_NAV: NavState = {
  view: 'today',
  date: null,
  sessionId: null,
  exerciseId: null,
};
