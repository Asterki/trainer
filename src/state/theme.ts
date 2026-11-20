/** Theme mapping between persisted settings and the CSS palette. */

import type { ThemeSetting } from '../domain/types';

export type Theme = 'light' | 'dark';

export function colorSchemeOf(theme: ThemeSetting): Theme {
  return theme === 'nordic-dark' ? 'dark' : 'light';
}

export function themeSettingOf(theme: Theme): ThemeSetting {
  return theme === 'dark' ? 'nordic-dark' : 'nordic-light';
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
}
