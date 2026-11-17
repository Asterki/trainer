# Stage 2 — Rebrand and strip

**Goal:** the repository builds and runs as Trainer, with the task UI gone and the new navigation
shell in place. No training domain yet; the shell shows honest empty states.

**Depends on:** Stage 1.
**Produces:** new identity (name, manifest, icons, cache names), new navigation shell, task-specific
UI removed, `styles.css` reduced to the base system.

---

## 1. Scope

### In scope

- Rename the app everywhere it is user-visible or operationally visible.
- Replace the four task views with the five Trainer views.
- Rewrite the shell navigation, keyboard shortcuts and mobile tab bar.
- Delete task-specific UI components and the in-app task manual.
- Reduce `styles.css` to tokens, resets, layout, forms, buttons, sheets and the new shell.
- Update the service worker cache prefix and PWA identity.
- Keep the repository green: `pnpm typecheck` and `pnpm build`.

### Out of scope

- New data model and IndexedDB (Stage 3).
- Routine editor, session logging, metrics (Stages 4–6).
- Relay and sync (Stage 7).
- Full user manual and final polish (Stage 8).

### Deliberate temporary state

The legacy core (`src/domain/types.ts`, `parser.ts`, `progress.ts`, `recurrence.ts`,
`suggestions.ts`, `src/db/database.ts`, `src/state/store.tsx`, `src/sync/*`, `src/notifications/*`)
still compiles but is no longer mounted by `main.tsx`. It is removed or replaced in Stage 3, when
the replacement exists, so the tree never has dangling imports. This is the only stage where dead
code is allowed, and it must not be imported by the new shell.

## 2. Identity changes

| Surface | Change |
|---------|--------|
| `package.json` | `name: "trainer"`, version `0.1.0`, description: local-first routine builder and workout logger |
| `index.html` | title `Trainer`, description, apple title, theme colours, manifest |
| `public/manifest.webmanifest` | `Trainer`, short name, description, start URL, standalone, icons |
| `public/sw.js` | cache prefixes `trainer-shell-`, `trainer-runtime-`; BUILD_ID logic unchanged |
| `src/pwa/serviceWorker.ts` | update any tasker-specific log text |
| `public/icons/*` | regenerate with a barbell/plate mark on the Nordic surface |
| `scripts/generate-icons.py` | update label, colours and mark; keep output sizes |
| `README.md` | short Trainer description now; full rewrite in Stage 8 |
| `DESIGN.Md` | rename to Trainer design system; keep palette and type scale |
| `src/styles.css` | new shell classes; task classes deleted |
| `vercel.json` | unchanged except any comments; SPA rewrite and SW headers stay |

Do not rename the git repository or the working directory.

### Icon direction

Keep the existing flat, geometric language. A centred barbell silhouette in the primary ice blue
on the light surface, with a dark variant for maskable icons. No text, no gradients, no drop
shadows. The maskable icon needs 20% safe padding. Reuse the existing generated sizes (192, 512,
apple touch, favicon) so the manifest does not change shape.

## 3. New navigation model

`src/state/navigation.ts` becomes:

```ts
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
```

- Desktop: left rail with Today, Routine, Progress, History, Settings. The rail collapses to icons
  below 1100px, matching the existing shell discipline.
- Mobile: bottom tab bar with Today, Routine, Progress, More. "More" opens a sheet with History,
  Settings and About.
- No floating action button. Creation happens inside Today and Routine.
- The desktop right-hand detail panel is reserved for exercise/session detail in Stages 5–6; in
  Stage 2 it is absent.

Keyboard shortcuts:

| Key | Action |
|-----|--------|
| `1` | Today |
| `2` | Routine |
| `3` | Progress |
| `4` | History |
| `5` | Settings |
| `Esc` | Close sheet / clear selection |

Ignore shortcuts while an input, textarea or select has focus.

## 4. Views to create in this stage

These are structural shells, not fake screens.

### `src/views/TodayView.tsx`

- Date heading using `Intl.DateTimeFormat` with weekday, day, month.
- Empty state: "No active routine. Build a routine to schedule your training." Button → Routine.
- If a routine existed, the card area is reserved; no mock sets.

### `src/views/RoutineView.tsx`

- Empty state explaining the N-week cycle and a disabled "coming next" note is **not** allowed.
  Instead show the explanation and no button, because the builder arrives in Stage 4. Keep it to
  three sentences and a link to the manual section placeholder? No link until the manual exists.
- This view may be replaced entirely in Stage 4.

### `src/views/ProgressView.tsx`

- Empty state: "Progress appears after your first completed session."
- No charts.

### `src/views/HistoryView.tsx`

- Empty state: "Completed and skipped sessions will appear here."

### `src/views/SettingsView.tsx`

- Theme toggle (light/dark), persisted temporarily in `localStorage` under `trainer.theme`.
- About: name, version from `package.json`? Vite does not import package.json by default; hardcode
  `0.1.0` or use `__APP_VERSION__` define. Prefer a Vite define in `vite.config.ts`.
- Link to the relay/API section is absent until Stage 7.
- Data section shows "Backup is available once the Trainer data layer is installed." This is an
  honest intermediate state and is replaced in Stage 3.

`main.tsx` drops `TaskerProvider`; the shell owns the temporary theme state. In Stage 3 the theme
moves into IndexedDB, reading the temporary localStorage value once as a fallback.

## 5. Deletion inventory

Delete now (no imports from the new shell):

```
src/views/TasksView.tsx
src/views/CalendarView.tsx
src/views/RoadmapView.tsx
src/components/TaskDetail.tsx
src/components/TaskRow.tsx
src/components/TaskTree.tsx
src/components/QuickAdd.tsx
src/components/FilterBar.tsx
src/components/RecurrenceEditor.tsx
src/components/Celebration.tsx
src/components/ProgressHud.tsx
src/docs/UserManual.tsx
```

Rewrite now:

```
src/App.tsx
src/components/Sidebar.tsx
src/components/TopBar.tsx
src/state/navigation.ts
src/main.tsx
src/styles.css
public/manifest.webmanifest
public/sw.js
index.html
README.md
```

Keep for Stage 3 (unused, compiling):

```
src/domain/{types,date,parser,progress,recurrence,suggestions}.ts
src/db/database.ts
src/state/{store,hooks}.ts
src/sync/*
src/notifications/*
USER_MANUAL.md        (rewritten in Stage 8)
server/*              (rewritten in Stage 7)
```

`src/components/BottomSheet.tsx` is kept unchanged; it already implements the swipe-to-close
thumb-zone drawer and is reused by every later stage.

## 6. CSS reduction

Start from the existing tokens and delete by ownership, not by search-and-destroy.

Keep:

- `:root` palette, dark/light themes, typography, spacing, radii, shadows.
- Reset, focus-visible ring, scrollbar, safe-area utilities.
- Shell layout: rail, main, top bar, mobile tab bar.
- Button, input, select, textarea, field, chip, badge, empty-state primitives.
- `bottom-sheet` classes and its animations, including `prefers-reduced-motion`.
- Toast/error primitives if the existing code has them.

Delete:

- Task row, task tree, project/category, tag, priority, place, calendar, roadmap, filter bar,
  quick-add, parser preview, recurrence editor, celebration, XP/progress HUD, ntfy/settings
  sections, manual layout.

Add:

- `rail__nav`, `rail__brand`, `tabbar`, `view`, `view__header`, `card`, `metric`, `empty-state`
  refinements only where the retained primitives are not enough.

Target: under ~1,800 lines after this stage, under ~2,400 at the end of Stage 6. If a selector is
kept "just in case", delete it.

## 7. Service worker

- Keep precache-shell and runtime-cache strategies exactly as they are.
- Rename caches. On activate, delete only caches with the Trainer prefix and old `tasker-` caches
  from this origin (safe: the app is the same origin; Tasker's IndexedDB is untouched).
- Keep navigation network-first with cached shell fallback.
- Keep hashed asset parsing out of `index.html`.
- No push listener. Trainer has no push notifications; remove any ntfy click/deep-link handling
  that remains in the shell.

## 8. Verification checklist

```bash
pnpm typecheck
pnpm build
pnpm preview
```

- [ ] `index.html`, manifest, sidebar, top bar and PWA install prompt all say Trainer.
- [ ] No visible "Tasker", "task", "project", "priority" or "roadmap" strings in the shell.
- [ ] All five views are reachable by mouse, touch and keys 1–5.
- [ ] Mobile bottom bar respects safe areas; sheets still swipe closed.
- [ ] Theme toggle survives reload (temporary localStorage).
- [ ] DevTools > Application shows the manifest with Trainer name and icons.
- [ ] Offline reload serves the shell from the renamed cache.
- [ ] Old `tasker` IndexedDB still exists and is not modified.
- [ ] `grep -ri "tasker" src public index.html package.json` returns only legacy core files queued
      for Stage 3, never shell/UI files.
- [ ] Build output has no task view chunks.

## 9. Risks

| Risk | Mitigation |
|------|------------|
| Deleting store/db now breaks sync imports | Keep legacy core compiling until Stage 3, unmounted |
| CSS deletion breaks sheets/forms | Keep primitives; verify on mobile viewport |
| Service worker serves stale Tasker shell | Rename caches and bump BUILD_ID on build |
| Icons cached by browsers | New filenames or cache-busting query; manifest update |
| Temporary localStorage theme forks settings | Stage 3 reads it once as a fallback and then ignores it |

## 10. Exit criteria

The app is visually Trainer, navigates the five future views, installs as a PWA, works offline, and
contains no task-specific UI. The next stage can replace the legacy core without touching the shell
again.
