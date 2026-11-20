/** Slim application bar: identity, local-first badge and theme control. */

import { FiMoon, FiSun } from 'react-icons/fi';
import { BrandMark } from './BrandMark';
import type { Theme } from '../state/theme';

interface TopBarProps {
  theme: Theme;
  onToggleTheme: () => void;
}

export function TopBar({ theme, onToggleTheme }: TopBarProps) {
  const nextTheme = theme === 'dark' ? 'light' : 'dark';

  return (
    <header className="topbar">
      <div className="topbar__identity">
        <BrandMark className="topbar__mark" />
        <span className="topbar__name">Trainer</span>
        <span className="topbar__tagline">Routine &amp; log</span>
      </div>

      <div className="topbar__right">
        <span className="badge badge--quiet">Local-first</span>
        <button
          type="button"
          className="icon-button"
          onClick={onToggleTheme}
          aria-label={`Switch to ${nextTheme} theme`}
          title={`Switch to ${nextTheme} theme`}
        >
          {theme === 'dark' ? <FiSun aria-hidden="true" /> : <FiMoon aria-hidden="true" />}
        </button>
      </div>
    </header>
  );
}
