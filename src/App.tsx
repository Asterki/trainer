/**
 * Trainer application shell.
 *
 * Owns navigation, keyboard shortcuts and the responsive layout (desktop rail
 * + mobile tab bar). Domain state lives in TrainerProvider.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  FiClock,
  FiMoreHorizontal,
  FiRepeat,
  FiSettings,
  FiSun,
  FiTrendingUp,
} from 'react-icons/fi';
import type { IconType } from 'react-icons';
import { BottomSheet } from './components/BottomSheet';
import { BrandMark } from './components/BrandMark';
import { ConfirmDialog } from './components/ConfirmDialog';
import { Sidebar } from './components/Sidebar';
import { TopBar } from './components/TopBar';
import { millisecondsUntilMidnight, todayIso } from './domain/date';
import { useActiveRoutine, useMediaQuery } from './state/hooks';
import { INITIAL_NAV, type NavState, type ViewKey } from './state/navigation';
import { useTrainer } from './state/store';
import { applyTheme, colorSchemeOf, themeSettingOf } from './state/theme';
import { HistoryView } from './views/HistoryView';
import { ProgressView } from './views/ProgressView';
import { RoutineView } from './views/RoutineView';
import { SettingsView } from './views/SettingsView';
import { TodayView } from './views/TodayView';

const VIEW_ORDER: ViewKey[] = ['today', 'routine', 'progress', 'history', 'settings'];

const MORE_NAV: Array<{ key: ViewKey; label: string; icon: IconType }> = [
  { key: 'history', label: 'History', icon: FiClock },
  { key: 'settings', label: 'Settings', icon: FiSettings },
];

const TABS: Array<{ key: ViewKey | 'more'; label: string; icon: IconType }> = [
  { key: 'today', label: 'Today', icon: FiSun },
  { key: 'routine', label: 'Routine', icon: FiRepeat },
  { key: 'progress', label: 'Progress', icon: FiTrendingUp },
  { key: 'more', label: 'More', icon: FiMoreHorizontal },
];

function isTyping(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element) return false;
  const tag = element.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || element.isContentEditable;
}

export function App() {
  const isMobile = useMediaQuery('(max-width: 860px)');
  const {
    ready,
    settings,
    updateSettings,
    ensureSessions,
    error,
    clearError,
  } = useTrainer();
  const activeRoutine = useActiveRoutine();
  const [today, setToday] = useState(todayIso);
  const [nav, setNav] = useState<NavState>(INITIAL_NAV);
  const [moreOpen, setMoreOpen] = useState(false);
  const [routineDirty, setRoutineDirty] = useState(false);
  const [pendingView, setPendingView] = useState<ViewKey | null>(null);

  const theme = colorSchemeOf(settings.theme);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    if (!isMobile) setMoreOpen(false);
  }, [isMobile]);

  useEffect(() => {
    if (!ready) return;
    void ensureSessions().catch(() => undefined);
  }, [activeRoutine?.id, activeRoutine?.updatedAt, ensureSessions, ready]);

  useEffect(() => {
    if (!ready) return;
    let timer = 0;

    const reconcile = () => {
      setToday(todayIso());
      void ensureSessions().catch(() => undefined);
    };
    const schedule = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        reconcile();
        schedule();
      }, millisecondsUntilMidnight());
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') reconcile();
    };

    schedule();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', reconcile);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', reconcile);
    };
  }, [ensureSessions, ready]);

  const applyNavigate = useCallback((view: ViewKey) => {
    setNav({ view, date: null, sessionId: null, exerciseId: null });
    setMoreOpen(false);
  }, []);

  const openSession = useCallback((sessionId: string) => {
    setNav({ view: 'history', date: null, sessionId, exerciseId: null });
    setMoreOpen(false);
  }, []);

  const selectHistorySession = useCallback((sessionId: string | null) => {
    setNav((current) => ({ ...current, sessionId }));
  }, []);

  const navigate = useCallback(
    (view: ViewKey) => {
      if (view === nav.view) {
        setMoreOpen(false);
        return;
      }
      if (nav.view === 'routine' && routineDirty) {
        setPendingView(view);
        return;
      }
      applyNavigate(view);
    },
    [applyNavigate, nav.view, routineDirty],
  );

  const toggleTheme = useCallback(() => {
    void updateSettings({ theme: themeSettingOf(theme === 'dark' ? 'light' : 'dark') });
  }, [theme, updateSettings]);

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        if (moreOpen) {
          setMoreOpen(false);
        } else {
          setNav((current) => ({ ...current, date: null, sessionId: null, exerciseId: null }));
        }
        return;
      }

      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      if (isTyping(event.target)) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      const index = Number(event.key) - 1;
      if (index >= 0 && index < VIEW_ORDER.length) {
        event.preventDefault();
        navigate(VIEW_ORDER[index]);
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [moreOpen, navigate]);

  const moreActive = nav.view === 'history' || nav.view === 'settings';

  return (
    <div className={`app${isMobile ? ' app--mobile' : ' app--desktop'}`}>
      <a className="skip-link" href="#main">
        Skip to content
      </a>

      <TopBar theme={theme} onToggleTheme={toggleTheme} />

      <div className="app__body">
        {!isMobile && <Sidebar nav={nav} onNavigate={navigate} />}

        <main className="workspace" id="main" tabIndex={-1}>
          {error && (
            <div className="notice notice--error app__notice" role="alert">
              <span>{error}</span>
              <button type="button" className="notice__dismiss" onClick={clearError}>
                Dismiss
              </button>
            </div>
          )}

          {!ready ? (
            <div className="view-loading" role="status">
              Loading Trainer…
            </div>
          ) : (
            <>
              {nav.view === 'today' && (
                <TodayView
                  today={today}
                  onBuildRoutine={() => navigate('routine')}
                  onViewHistory={() => navigate('history')}
                />
              )}
              {nav.view === 'routine' && <RoutineView onDirtyChange={setRoutineDirty} />}
              {nav.view === 'progress' && (
                <ProgressView
                  today={today}
                  onOpenToday={() => navigate('today')}
                  onOpenSession={openSession}
                  onOpenSettings={() => navigate('settings')}
                  onOpenHistory={() => navigate('history')}
                />
              )}
              {nav.view === 'history' && (
                <HistoryView
                  today={today}
                  selectedSessionId={nav.sessionId}
                  onSelectSession={selectHistorySession}
                  onOpenToday={() => navigate('today')}
                />
              )}
              {nav.view === 'settings' && <SettingsView />}
            </>
          )}
        </main>
      </div>

      {isMobile && (
        <nav className="tabbar" aria-label="Views">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const active =
              tab.key === 'more' ? moreActive || moreOpen : nav.view === tab.key;

            return (
              <button
                key={tab.key}
                type="button"
                className={`tabbar__item${active ? ' tabbar__item--active' : ''}`}
                aria-current={!active ? undefined : tab.key === 'more' ? undefined : 'page'}
                aria-expanded={tab.key === 'more' ? moreOpen : undefined}
                onClick={() => {
                  if (tab.key === 'more') setMoreOpen(true);
                  else navigate(tab.key);
                }}
              >
                <span className="tabbar__icon">
                  <Icon aria-hidden="true" />
                </span>
                <span className="tabbar__label">{tab.label}</span>
              </button>
            );
          })}
        </nav>
      )}

      <ConfirmDialog
        open={pendingView !== null}
        title="Discard changes?"
        confirmLabel="Discard changes"
        tone="danger"
        onCancel={() => setPendingView(null)}
        onConfirm={() => {
          const destination = pendingView;
          setPendingView(null);
          setRoutineDirty(false);
          if (destination) applyNavigate(destination);
        }}
      >
        <p>The routine editor has unsaved changes. Leave and discard them?</p>
      </ConfirmDialog>

      {isMobile && (
        <BottomSheet open={moreOpen} title="More" onClose={() => setMoreOpen(false)}>
          <nav className="sheet-menu" aria-label="More views">
            {MORE_NAV.map((item) => {
              const Icon = item.icon;
              const active = nav.view === item.key;
              return (
                <button
                  key={item.key}
                  type="button"
                  className={`sheet-menu__item${active ? ' sheet-menu__item--active' : ''}`}
                  onClick={() => navigate(item.key)}
                  aria-current={active ? 'page' : undefined}
                >
                  <span className="sheet-menu__icon">
                    <Icon aria-hidden="true" />
                  </span>
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>

          <section className="sheet-about" aria-labelledby="sheet-about-title">
            <span className="sheet-about__mark">
              <BrandMark />
            </span>
            <div>
              <h2 className="sheet-about__title" id="sheet-about-title">
                Trainer <span className="badge badge--quiet">v{__APP_VERSION__}</span>
              </h2>
              <p className="sheet-about__body">
                A local-first routine builder and workout logger. No account, no cloud required.
              </p>
            </div>
          </section>
        </BottomSheet>
      )}
    </div>
  );
}
