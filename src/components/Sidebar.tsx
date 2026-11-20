/** Desktop navigation rail. Collapses to icons below 1100px. */

import {
  FiClock,
  FiRepeat,
  FiSettings,
  FiSun,
  FiTrendingUp,
} from 'react-icons/fi';
import type { IconType } from 'react-icons';
import { BrandMark } from './BrandMark';
import type { NavState, ViewKey } from '../state/navigation';

interface NavItem {
  key: ViewKey;
  label: string;
  icon: IconType;
  shortcut: string;
  heading: string;
}

const NAV_ITEMS: NavItem[] = [
  { key: 'today', label: 'Today', icon: FiSun, shortcut: '1', heading: 'Train' },
  { key: 'routine', label: 'Routine', icon: FiRepeat, shortcut: '2', heading: 'Train' },
  { key: 'progress', label: 'Progress', icon: FiTrendingUp, shortcut: '3', heading: 'Review' },
  { key: 'history', label: 'History', icon: FiClock, shortcut: '4', heading: 'Review' },
  { key: 'settings', label: 'Settings', icon: FiSettings, shortcut: '5', heading: 'App' },
];

interface SidebarProps {
  nav: NavState;
  onNavigate: (view: ViewKey) => void;
}

export function Sidebar({ nav, onNavigate }: SidebarProps) {
  return (
    <aside className="rail" aria-label="Primary navigation">
      <div className="rail__brand">
        <span className="rail__brand-mark">
          <BrandMark />
        </span>
        <span className="rail__brand-text">
          <span className="rail__brand-name">Trainer</span>
          <span className="rail__brand-sub">Train on your terms</span>
        </span>
      </div>

      <nav className="rail__nav" aria-label="Views">
        {NAV_ITEMS.map((item, index) => {
          const Icon = item.icon;
          const firstInGroup = index === 0 || NAV_ITEMS[index - 1]?.heading !== item.heading;
          const active = nav.view === item.key;

          return (
            <div className="rail__group" key={item.key}>
              {firstInGroup && <span className="rail__heading">{item.heading}</span>}
              <button
                type="button"
                className={`rail__item${active ? ' rail__item--active' : ''}`}
                onClick={() => onNavigate(item.key)}
                aria-current={active ? 'page' : undefined}
                title={item.label}
              >
                <span className="rail__glyph">
                  <Icon aria-hidden="true" />
                </span>
                <span className="rail__label">{item.label}</span>
                <kbd className="rail__shortcut">{item.shortcut}</kbd>
              </button>
            </div>
          );
        })}
      </nav>

      <div className="rail__footer">
        <span className="rail__build">v{__APP_VERSION__}</span>
        <span className="rail__build-note">Data stays on this device</span>
      </div>
    </aside>
  );
}
