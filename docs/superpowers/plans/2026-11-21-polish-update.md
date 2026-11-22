# Polish Update Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix every usability, visual, accessibility and interaction defect found during the full browser QA of Trainer, so routine building, exercise discovery, set logging, history, progress and settings all feel deliberate and trustworthy.

**Architecture:** Presentation-only changes plus one media-regeneration pass. No domain or sync schema changes. Reuse existing components and CSS tokens; fix behavior where the UI currently lies about what has already been saved. Media quality improves by swapping 200px thumbnails for 400px sources while keeping the 200px thumb for compact surfaces.

**Tech Stack:** React 18, Vite 6, TypeScript, plain CSS, custom service worker, Node media build script, Playwright for verification only.

**Spec:** `AGENTS.md` plus the QA evidence in this document. There is no separate product spec for this update.

## Global Constraints

- Local-first: no screen waits on the network.
- No new runtime dependencies.
- No generic `utils.ts`; keep helpers inside the feature area that owns them.
- 44×44px minimum touch targets.
- Respect `prefers-reduced-motion`.
- No horizontal page scroll at 360px width.
- Charts remain pure SVG with accessible labels and a table fallback.
- Every button must either do something visible or be removed.
- App builds must never fetch wger.
- Manual browser checklist is the acceptance test; do not add extensive automated tests.

## Review Focus

- A user on a phone taps Finish and the bar must not cover the last set row or the rating control.
- A user opens History while the detail panel is visible at 1440px; filter labels must remain readable.
- A user views a transparent exercise image in dark mode; no black tile, no letterbox bands.
- A user opens a 200×112 image zoom; it must fill the dialog, not sit as a stamp in the middle.
- A user adds an exercise, then presses what used to be Cancel; they must not lose an addition they believed was discarded.

## Findings Catalog

Priorities: **P0** blocks comprehension or looks broken; **P1** misleading or visibly wrong; **P2** layout and polish; **P3** small refinements.

| ID | Priority | Finding | Evidence |
| --- | --- | --- | --- |
| M1 | P0 | Media zoom renders the image at natural size (measured 200×112) inside a full-screen dialog. | `/tmp/qa/zoom.png`, `/tmp/qa/zoom2.png` |
| M2 | P0 | 200px thumbnails are stretched into 382×378 frames, producing whitespace and pixelation. | `/tmp/qa/dev-selected.png` |
| M3 | P0 | Transparent PNGs show as black squares in dark mode; white images get black letterbox bands. | `/tmp/qa/dev-selected.png`, `/tmp/qa/progress-exercise-detail.png` |
| M4 | P1 | Exercise picker adds immediately, yet footer says Cancel and `Done (N)` where N is total session exercises, not the number added here. Added rows cannot be undone. | `/tmp/qa/picker.png`, `/tmp/qa/picker-selected.png` |
| M5 | P1 | History filter labels truncate at 1440px when the detail panel is open. | `/tmp/qa/history-detail.png` |
| M6 | P1 | Singular/plural errors: `1 sets`, `1 exercises`, `best: 1 workouts`. | History, Progress, SessionDetail |
| M7 | P1 | Adherence chart shows two `1` y-axis labels because `0.5` and `1` both round to `1`. | `/tmp/qa/progress.png` |
| M8 | P1 | Two different “show table” controls appear on the Muscles tab with unclear scopes. | `/tmp/qa/progress-muscles.png`, `/tmp/qa/progress-table.png` |
| M9 | P2 | Desktop repeats `Trainer` in the 48px top bar and the sidebar. | All desktop screenshots |
| M10 | P2 | Settings copy is padded with decorative subtitles; reminder failure exposes raw `Failed to fetch`. | `/tmp/qa/settings.png`, `/tmp/qa/reminder-error.png` |
| M11 | P2 | Fixed FinishBar covers content on mobile; padding is insufficient for bar + tab bar. | `/tmp/qa/mobile-today.png` |
| M12 | P2 | Routine editor still says “the AI chooses exercises”; those words are inaccurate and previously asked to be removed. | `RoutineView.tsx:638`, `RoutineSlotSheet.tsx:126` |
| M13 | P2 | Routine Save/Discard sits below the fold on desktop after a long schedule. | `/tmp/qa/routine-editor.png` |
| M14 | P2 | Mobile routine sheet repeats the routine name in sheet header and page title. | `/tmp/qa/mobile-editor.png` |
| M15 | P3 | 1-week routine preview overflows to `…`. | `/tmp/qa/routine-list.png` |
| M16 | P3 | Dark body-diagram base has low contrast. | `/tmp/qa/dev-direct.png`, `/tmp/qa/mobile-dev.png` |
| M17 | P3 | Mobile developer preview body map is one very tall card per row. | `/tmp/qa/mobile-dev.png` |
| M18 | P3 | Desktop routine preview is not self-explanatory: initials only, no weekday labels. | `/tmp/qa/routine-list.png` |
| M19 | P3 | Exercise detail side-panel close control may be below the 44px target. | QA inspection |
| M20 | P3 | Routine form still contains redundant helper copy around the weekly schedule and 14-day preview. | `/tmp/qa/routine-editor.png` |

False positives removed after code inspection: edit-plan inputs already have accessible labels via wrapping `<label>`; picker search already has `autoFocus`.

---

### Task 1: Media presentation — source quality, tiles, zoom

**Files:**
- Modify: `scripts/build-exercises.mjs`
- Modify: `src/styles.css`
- Modify: `src/components/ExerciseMedia.tsx` only if markup needs a wrapper
- Regenerate: `public/exercise-media/`, `public/exercise-media-manifest.json`, `src/domain/catalogue/wger-exercises.json`, `src/domain/catalogue/ATTRIBUTION.md`

**Interfaces:**
- Consumes: `ExerciseMedia { id, thumb, src, animated, alt, license, licenseUrl, author, sourceUrl }`
- Produces: same shape; `src` points at 400px media, `thumb` stays 200px

- [ ] **Step 1: Change source selection in `buildMediaFor`**

For static images, set `src` to `image.thumbnails?.medium ?? image.thumbnails?.small ?? image.image`. Set `thumb` to `image.thumbnails?.small ?? image.thumbnails?.medium ?? image.image`. For animated GIFs, keep `src` as the original GIF and keep the ffmpeg-extracted first frame as `thumb`.

- [ ] **Step 2: Raise the media budget**

Change `MEDIA_BUDGET_BYTES` from 15MB to 30MB. The expected result is roughly 20–24MB with 400px sources plus five GIF originals.

- [ ] **Step 3: Regenerate**

Run `node scripts/build-exercises.mjs`. Confirm:
- 979 exercises retained
- 288 exercises with media
- 395 images, 5 animated GIFs
- every `src` and `thumb` path exists
- manifest count equals file count
- total size below 30MB

- [ ] **Step 4: Update attribution automatically**

The script must continue writing license, author and source for each image, and update the stated total size. Confirm `ATTRIBUTION.md` no longer says 11.20 MB.

- [ ] **Step 5: Fix gallery tiles in `src/styles.css`**

Replace the forced square frame:

```css
.exercise-media__item img {
  width: 100%;
  height: auto;
  max-height: 380px;
  object-fit: contain;
  background: #f6f8fa;
}
```

Keep `.exercise-media__grid` at `repeat(auto-fill, minmax(140px, 1fr))`. Set `.exercise-media__item` padding and a `#f6f8fa` tile so transparent PNGs are visible in both themes. Do not use `var(--surface-sunken)` for the image tile; it is black in dark mode.

- [ ] **Step 6: Fix large media and Today thumbnails**

`.exercise-media--large` keeps a minimum 260px column. Images use `height: clamp(220px, 40vw, 380px); width: 100%; object-fit: contain; background: #f6f8fa;`.

`.exercise-thumb` uses a light tile and `object-fit: cover` only for the compact 48/64px thumbnails. Do not crop the large gallery.

- [ ] **Step 7: Fix the zoom dialog**

`.media-zoom` remains a fixed overlay. Its inner figure gets `width: min(92vw, 1200px); max-height: calc(100dvh - 96px); display: flex; align-items: center; justify-content: center;`.

`.media-zoom img` gets:

```css
width: 100%;
height: auto;
max-height: calc(100dvh - 140px);
object-fit: contain;
background: #f6f8fa;
```

This makes a 400×224 image scale to the dialog width instead of rendering at 400px natural size. Keep the 44px close button, Escape, backdrop close and focus trap behavior unchanged.

- [ ] **Step 8: Verify dark mode and reduced motion**

In both themes, open the Bench Press image (transparent PNG) and a GIF. Confirm no black tile, no letterbox bands, and that reduced motion shows the still thumb. The zoom must stay centered and scrollable if the image is tall.

- [ ] **Step 9: Commit**

```bash
git add scripts/build-exercises.mjs public/exercise-media public/exercise-media-manifest.json \
  src/domain/catalogue/wger-exercises.json src/domain/catalogue/ATTRIBUTION.md \
  src/styles.css src/components/ExerciseMedia.tsx
git commit -m "fix: improve exercise media quality and presentation"
```

---

### Task 2: Exercise picker honesty and undo

**Files:**
- Modify: `src/components/ExercisePickerSheet.tsx`
- Modify: `src/views/TodayView.tsx`
- Modify: `src/styles.css` only for footer button width

**Interfaces:**
- Consumes: `Session`, `Exercise`, `onAdd`, store `removeSessionExercise(sessionId, rowId)`
- Produces: `ExercisePickerSheetProps` gains `onRemove: (exerciseRowId: string) => Promise<void>`

- [ ] **Step 1: Add the remove prop**

In `ExercisePickerSheetProps`, add `onRemove`.

In `TodayView.tsx`, pass:

```tsx
onRemove={async (rowId) => {
  if (!session) throw new Error('No session to edit.');
  await removeSessionExercise(session.id, rowId);
}}
```

- [ ] **Step 2: Make added rows undoable**

When `isAdded`, the row stays enabled and calls `onRemove(rowId)`. Find the row by `session.exercises.find((row) => row.exerciseId === exercise.id)`. Show `Added · tap to remove` in the meta area and keep the check icon. Remove the `disabled` attribute for added rows; continue disabling while `addingId` is set.

- [ ] **Step 3: Replace the misleading footer**

Replace the two footer buttons with one full-width primary button labelled `Done`. Remove the `Cancel` button and the `Done (N)` count. Closing the sheet is not a cancel operation because additions are already saved.

- [ ] **Step 4: Add a single honesty line**

At the top of the picker results, add one short line: `Exercises are added as you tap them.` Do not add a modal confirmation.

- [ ] **Step 5: Verify**

Add an exercise, tap it again to remove it, add it once more, then press Done. Confirm the session row count stays correct and no error appears.

- [ ] **Step 6: Commit**

```bash
git add src/components/ExercisePickerSheet.tsx src/views/TodayView.tsx src/styles.css
git commit -m "fix: make exercise picker additions honest and undoable"
```

---

### Task 3: History filters and singular/plural copy

**Files:**
- Modify: `src/styles.css`
- Modify: `src/views/HistoryView.tsx`
- Modify: `src/views/ProgressView.tsx`
- Modify: `src/components/SessionDetail.tsx`
- Modify: `src/views/TodayView.tsx` if set counts are shown in the rating/finish area

- [ ] **Step 1: Fix filter layout**

Add:

```css
.history-layout--detail .history-filters {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
```

Keep one column below 640px. Keep the default without detail at `repeat(auto-fit, minmax(160px, 1fr))` so 1440px and 1024px both breathe. Verify all four labels render in full.

- [ ] **Step 2: Fix grammar inline**

Do not add a shared helper. Use ternaries at the call sites:

- `HistoryView.tsx`: `${sets} ${sets === 1 ? 'set' : 'sets'} · ${exercises} ${exercises === 1 ? 'exercise' : 'exercises'}`
- `ProgressView.tsx` recent sessions: same pattern.
- `ProgressView.tsx` streak hint: `${streak.best} ${streak.best === 1 ? 'workout' : 'workouts'}`.
- `SessionDetail.tsx`: `{sets.length} {sets.length === 1 ? 'set' : 'sets'}`.

Search for the literal strings `sets ·`, `exercises`, and `workouts` in `HistoryView`, `ProgressView`, `SessionDetail` to catch every case.

- [ ] **Step 3: Verify**

Seed exactly one set in one exercise. Check History list, History detail, Progress recent sessions and the session summary. Every noun must be singular. Then add a second set and check plurals.

- [ ] **Step 4: Commit**

```bash
git add src/styles.css src/views/HistoryView.tsx src/views/ProgressView.tsx src/components/SessionDetail.tsx
git commit -m "fix: responsive history filters and pluralized counts"
```

---

### Task 4: Progress chart readability and table controls

**Files:**
- Modify: `src/components/charts/StackedBars.tsx`
- Modify: `src/components/charts/BarChart.tsx` if needed
- Modify: `src/views/ProgressView.tsx`

- [ ] **Step 1: Deduplicate y-axis ticks**

In `StackedBars`, instead of rendering `[0, 0.5, 1]` blindly, build labels and filter duplicates:

```ts
const labels = [...new Set([0, 0.5, 1].map((fraction) => Math.round(max * fraction)))];
```

Render one tick per label, positioned by its original fraction. For `max === 1`, ticks are `0` and `1` only. For larger integer maxima, keep at most three ticks.

- [ ] **Step 2: Rename the chart-data control**

Change the `<summary>` in `BarChart`/`StackedBars` from `View data table` to `Chart data`. Keep the table itself.

On the Muscles tab, rename the separate button from `Show table` to `Show all muscle data`, and hide it while the chart-data table is open, or render both labels clearly enough that one is chart data and one is the full muscle table.

- [ ] **Step 3: Verify**

Open Progress with a single completed workout. Confirm the adherence y-axis has one `0` and one `1`. Open each table control and confirm its label matches its contents.

- [ ] **Step 4: Commit**

```bash
git add src/components/charts/StackedBars.tsx src/components/charts/BarChart.tsx src/views/ProgressView.tsx
git commit -m "fix: readable progress ticks and clearer data controls"
```

---

### Task 5: Shell, routine copy, sticky actions and mobile finish spacing

**Files:**
- Modify: `src/styles.css`
- Modify: `src/views/RoutineView.tsx`
- Modify: `src/components/RoutineSlotSheet.tsx`
- Modify: `src/components/FinishBar.tsx` only if the bar needs a compact variant

- [ ] **Step 1: Remove the duplicate desktop top bar**

At `@media (min-width: 861px)`, hide `.topbar`. Keep it on mobile, where the sidebar is absent. If the app grid relies on a topbar row, collapse that row with `grid-template-rows: 0 1fr` or remove the topbar from the desktop layout. Confirm Today, Routine, Progress, History and Settings all start at the same vertical position and the sidebar still reaches the top.

- [ ] **Step 2: Fix the FinishBar overlap**

Desktop: keep `position: sticky; bottom: 8px`, but add at least `padding-bottom: 24px` to the scrolling content.

Mobile: change `.today--has-finish` bottom padding from `72px` to:

```css
padding-bottom: calc(var(--tabbar-height) + 96px + env(safe-area-inset-bottom));
```

Verify the last set row and the rating scale can scroll fully above both the finish bar and the tab bar. The bar must not cover the muscle diagram or description in an expanded exercise.

- [ ] **Step 3: Make routine actions reachable**

Desktop routine editor: make the footer `.routine-editor__footer` sticky at `bottom: 0` with a solid surface, a top border and safe-area padding. Keep Discard/Save visible while scrolling the schedule. On mobile, keep the existing sheet footer.

- [ ] **Step 4: Remove duplicate mobile title**

At `max-width: 860px`, hide the routine editor page title/eyebrow inside the sheet and rely on the sheet header’s routine name. Keep a single visible title at all widths.

- [ ] **Step 5: Remove stale AI copy**

In `RoutineView.tsx:638`, replace the sentence about the AI choosing exercises with: `Plan each workout, then log the sets as you train.`

In `RoutineSlotSheet.tsx:126`, replace `The AI chooses exercises for this focus.` with `Exercises are planned for this focus.`

- [ ] **Step 6: Fix the 1-week preview overflow and add weekday labels**

Add `min-width: 0` to routine preview cells and allow the focus abbreviation to shrink. Do not clip the week row into `…`; if the label cannot fit, show the initials without ellipsis. Verify at 360px.

Under each routine-card preview day, add a visible weekday label (`Mo`, `Tu`, `We`, `Th`, `Fr`, `Sa`, `Su`) in `.routine-card__day-label`. Keep the focus initials above it. This makes the preview readable without a legend.

- [ ] **Step 7: Remove redundant routine helper copy**

In the weekly schedule card, delete the paragraph starting `Push Pull Legs schedule…`. In the 14-day preview, delete or shorten `Next 14 days / What the cycle resolves to…` to a single label: `Next 14 days`. Do not remove functional controls or the schedule itself.

- [ ] **Step 8: Enforce the 44px close target**

Find the close button in `ExerciseDetail` / the history side panel. Set `min-width: 44px; min-height: 44px;` and keep the icon centred. Confirm it does not crowd the panel heading.

- [ ] **Step 9: Verify**

At 1440px, 900px and 360px: no duplicate brand, routine Save visible after scrolling, finish bar does not cover content, one title in the mobile editor, no AI wording anywhere.

- [ ] **Step 10: Commit**

```bash
git add src/styles.css src/views/RoutineView.tsx src/components/RoutineSlotSheet.tsx src/components/FinishBar.tsx
git commit -m "fix: shell spacing and routine editor usability"
```

---

### Task 6: Settings compactness and actionable reminder errors

**Files:**
- Modify: `src/views/SettingsView.tsx`
- Modify: `src/styles.css`

- [ ] **Step 1: Compact Appearance and Training**

Convert both cards to rows: label and control on one line, no decorative subtitle. Remove:
- `Choose the surface that suits the room.`
- `Feedback while you log sets.`
- The long reminder intro; keep one line: `Get an ntfy notification on workout days.`

Keep the security note but shorten it to two sentences: install ntfy, subscribe to the shown topic, and treat the topic as a shared secret.

- [ ] **Step 2: Map network errors**

Add a local function in `SettingsView.tsx`:

```ts
function reminderError(error: unknown): string {
  if (error instanceof TypeError) {
    return 'Could not reach the notification server. Check the server address and your connection.';
  }
  return errorMessage(error);
}
```

Use it in `handleTestReminder` and in reminder save paths. Never show raw `Failed to fetch`.

- [ ] **Step 3: Verify**

At mobile width, confirm Appearance, Training and Gym reminder are compact and no card requires excessive scrolling. Disable the network and press Send test; the message must be actionable and not raw.

- [ ] **Step 4: Commit**

```bash
git add src/views/SettingsView.tsx src/styles.css
git commit -m "fix: compact settings and humanize reminder errors"
```

---

### Task 7: Developer preview responsiveness and body contrast

**Files:**
- Modify: `src/views/DevPreviewView.tsx`
- Modify: `src/components/MuscleDiagram.tsx` if markup needs a contrast class
- Modify: `src/styles.css`

- [ ] **Step 1: Fix mobile body-map grid**

At `max-width: 640px`, show body-map cards two per row, with a minimum width of 140px. If two columns are too tight at 360px, keep one column but cap each diagram at 96px tall. Do not leave a full-height card per muscle.

- [ ] **Step 2: Improve dark diagram contrast**

Set dark `--muscle-body` to a lighter gray (`#6e7681` suggested) and add a subtle stroke between muscle polygons using the panel colour. Keep primary red and secondary amber distinct. Add a text legend remains visible.

- [ ] **Step 3: Verify**

Open `?dev=1` at 1440px and 360px. Every muscle card is readable, the body is visible in dark mode, and no horizontal scroll appears.

- [ ] **Step 4: Commit**

```bash
git add src/views/DevPreviewView.tsx src/components/MuscleDiagram.tsx src/styles.css
git commit -m "fix: dev preview mobile layout and dark diagram contrast"
```

---

## Final Verification

Run every command and read the output:

```bash
node scripts/build-exercises.mjs
pnpm typecheck
pnpm build
pnpm --dir server typecheck
pnpm --dir server build
```

Then run the manual browser checklist on `http://localhost:5174` with a fresh QA profile:

### Media
- [ ] Transparent PNG in light and dark mode has a neutral tile, not black.
- [ ] Gallery image preserves aspect ratio and is not pixelated.
- [ ] Zoom fills the dialog; tall images remain contained.
- [ ] GIF animates unless reduced motion is enabled.
- [ ] No media/description fallback is honest.

### Today and logging
- [ ] Add three identical sets; all persist after reload.
- [ ] Edit and delete a set.
- [ ] Expand an exercise; description, diagram, image and logger are all reachable.
- [ ] Rate the session, clear the rating by tapping the same value.
- [ ] Finish with zero sets prompts; finish with sets works.
- [ ] FinishBar never covers the last row, rating or tab bar.

### Picker
- [ ] Add, undo, re-add an exercise.
- [ ] Footer has one Done action and no count.
- [ ] Search and filters still work.

### Routine
- [ ] Create, activate, deactivate, duplicate, delete.
- [ ] Add/copy/clear/remove week.
- [ ] Active switch applies immediately.
- [ ] Save/Discard visible after scrolling.
- [ ] Mobile editor has one title.
- [ ] No AI copy.

### History and Progress
- [ ] Filters readable at 1440px with detail open.
- [ ] Every count is singular/plural correct.
- [ ] Adherence ticks have no duplicates.
- [ ] Chart-data and muscle-table controls are distinguishable.
- [ ] All tabs and ranges render.

### Settings
- [ ] Theme switch, sound, haptics.
- [ ] Reminder enable, time, priority, test, offline error.
- [ ] Export backup.
- [ ] Import on a throwaway profile.
- [ ] Reset data on a throwaway profile.
- [ ] Sync connect screen opens and validates input.
- [ ] Custom exercise create/edit/delete.
- [ ] About attribution lists wger and MIT correctly.

### Shell and dev preview
- [ ] No duplicate desktop top bar.
- [ ] No horizontal scroll at 360px.
- [ ] All touch targets 44px.
- [ ] `?dev=1` body map, media search and navigation work on desktop and mobile.
- [ ] Console free of errors during normal flows.

No commits should be made while unrelated work remains uncommitted; if the tree is cleaned first, use the commit steps above.
