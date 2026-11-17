# Stage 6 — Progress and reports

**Goal:** turn the log into insight: PRs by rep count, muscle-group volume, adherence, exercise
history, and a read-only session history.

**Depends on:** Stage 5.
**Produces:** `src/domain/metrics.ts`, Progress view (overview, exercises, muscles), History view,
exercise and session detail, SVG charts.

All numbers in this stage are derived from sessions. Nothing new is stored.

---

## 1. Metric definitions (implement exactly)

### 1.1 Session totals

```ts
sessionVolume(session): number
// sum over all sets: weight * reps

sessionSetCount(session): number
// count of sets with reps >= 1

sessionMuscleVolume(session): Partial<Record<MuscleGroupId, number>>
// per Stage 1: primary split full, secondary split half
```

Only `status === 'completed'` sessions contribute to PR, volume and muscle metrics. Skipped and
planned sessions contribute only to adherence.

### 1.2 PRs

```ts
interface PrEntry {
  exerciseId: string;
  name: string;          // most recent snapshot name
  reps: number;
  weight: number;
  date: IsoDate;
  sessionId: string;
}
```

- Key: `(exerciseId, reps)` for sets with `weight > 0 && reps > 0`.
- Value: maximum weight. Tie-break: the **earliest** date that achieved it, so the PR date marks
  when it was first hit.
- Reps > 20 are computed but displayed in a `20+` group; the group's entry is the heaviest set with
  reps > 20, and its exact rep count is shown in the detail.
- Bodyweight sets (`weight = 0`) are excluded and the UI says "Bodyweight sets are not ranked."
- Session snapshots supply `name`; use the latest completed occurrence for display.

### 1.3 Exercise history

```ts
interface ExerciseSessionPoint {
  date: IsoDate;
  sessionId: string;
  sets: SetLog[];
  topWeight: number;      // max weight
  topRepsAtTop: number;   // reps at that weight
  volume: number;
  estimated1rm: number | null; // Epley: w * (1 + reps/30), only w>0
}
```

- One point per completed session containing the exercise.
- `topWeight` uses the heaviest set; if several share the weight, use the highest reps.
- `estimated1rm` is optional for the chart tooltip only. It is not a PR and must be labelled
  "estimated".
- Bodyweight-only history: chart reps per session instead of weight, and say so.

### 1.4 Muscle volume

```ts
interface MuscleWeek {
  week: string; // YYYY-Www
  muscles: Partial<Record<MuscleGroupId, number>>;
  sets: Partial<Record<MuscleGroupId, number>>;
}
```

- Aggregate completed sessions by ISO week, Monday-based, local dates.
- Volume rule from Stage 1. Set counts use the same attribution (primary full count? no): count a
  set once for each primary muscle and 0.5 for each secondary, then display rounded to one decimal.
  This is only a secondary view; label it "weighted sets".
- Weeks with no training are included with zeros so charts show gaps.
- Range options: last 4, 12, 26 weeks; default 12.

### 1.5 Adherence

```ts
interface AdherenceBucket {
  week: string;
  scheduled: number;
  completed: number;
  skipped: number;
}

interface AdherenceSummary {
  weeks: number;
  scheduled: number;
  completed: number;
  skipped: number;
  rate: number | null; // null when completed + skipped = 0
  adHocCompleted: number;
}
```

- Scheduled = sessions with `source !== 'manual'` and a date in the range. Completed and skipped
  both count as scheduled outcomes.
- `rate = completed / (completed + skipped)`. Future planned sessions are not in the denominator.
- Ad-hoc sessions are reported separately and excluded from the rate.
- Rest days are not sessions, so they never appear.

### 1.6 "Recent PRs"

A PR entry is recent when its `date` falls inside the selected range (default 30 days). This means
"you hit a new all-time best in this period", not "the record was created". When a heavier set is
added later, the earlier entry stops being a PR; recomputation handles it automatically.

## 2. `src/domain/metrics.ts`

Pure functions, no React, no IndexedDB:

```ts
computePrs(sessions: Session[]): PrEntry[]
prsForExercise(sessions, exerciseId): PrEntry[]
exerciseHistory(sessions, exerciseId): ExerciseSessionPoint[]
muscleWeeks(sessions, weeks: number, today: IsoDate): MuscleWeek[]
adherence(sessions, weeks: number, today: IsoDate): {
  buckets: AdherenceBucket[];
  summary: AdherenceSummary;
}
recentPrs(sessions, days: number, today: IsoDate): PrEntry[]
sessionSummaries(sessions): Map<string, SessionSummary>
```

Implementation notes:

- Sort completed sessions by date ascending once per call; build `Map<exerciseId, ...>` indexes.
- One pass over all sets can build PRs, per-exercise history and weekly volume; avoid repeated
  filtering where practical, but keep the code readable. Readability wins over micro-optimization.
- Memoize at the view level with `useMemo` keyed by the `sessions` array reference and range. The
  store replaces the array on writes, so the memo invalidates correctly.
- Dates are local strings; use `isoWeekKey` from `date.ts`, never `Date.toISOString()`.

## 3. Progress view

`src/views/ProgressView.tsx` with three tabs.

### Overview

Range selector: 4 / 12 / 26 weeks.

Summary cards:

- Workouts completed (in range).
- Total volume (kg, compact formatting: `12.4k`).
- Sets logged.
- Adherence rate with `completed / scheduled`, or "—" when no scheduled outcome yet.

Sections:

1. **Adherence** — 8 weekly bars, completed vs skipped, current week partial. Hover/focus shows
   counts. A caption explains that rest days are excluded.
2. **Muscle balance** — horizontal bars for the selected range, sorted by volume, with kg values.
   All 18 muscles listed? Show the top 10 and a "Show all" toggle. Zero-volume muscles are muted and
   can be hidden.
3. **Recent PRs** — last 30 days, up to 6: exercise, weight × reps, date. Link to exercise detail.
4. **Recent sessions** — last 5 completed/skipped rows, link to History.

Empty state when there are no completed sessions: one sentence and a link to Today.

### Exercises

- Search input (debounced 150ms) and muscle filter.
- List of exercises that appear in at least one completed session, sorted by most recent.
- Row: name, primary muscles, last performed date, best set (`100 × 5`), sessions count.
- Bodyweight-only exercises show best reps instead of weight.
- Click opens `ExerciseDetail` (desktop right panel; mobile sheet/full screen).

### Muscles

- Range selector.
- **Volume by muscle** — horizontal bars for the chosen range.
- **Weekly trend** — select one muscle; line/bar chart of weekly volume over the range.
- Toggle: Volume / Weighted sets.
- A short definition line: "Volume = weight × reps. Primary muscles get full credit, secondary
  half."
- Table view toggle for accessibility and exact numbers.

## 4. Exercise detail

`src/components/ExerciseDetail.tsx`:

Header:

- Name, category, equipment chips, primary/secondary muscles.
- Instructions, collapsible; custom exercises show an edit link to Settings.

Stats:

- Sessions, total sets, best set, total volume, first/last performed.
- PR count.

PR table (`PrTable.tsx`):

- Rows: rep counts present (1–20, plus `20+`). Columns: Reps, Best weight, Date, Session link.
- Include a toggle "Show empty rep ranges" to render 1–20 even when absent.
- Everything is derived; no edit affordance.

History:

- Chart: top-set weight over time, with volume bars secondary. Toggle Weight / Volume.
- Table/list of sessions: date, sets (compact), top set, volume. Click → session detail.
- Pagination or "Show more" in chunks of 20.

## 5. History view

`src/views/HistoryView.tsx`:

- Filters: status (all / completed / skipped), focus (from sessions, case-insensitive), exercise
  (searchable select, optional), date range preset (30 days / 90 days / 1 year / all).
- Group by month, newest first.
- Row: date, focus, routine name, status badge, sets, volume, exercise count.
- Ad-hoc sessions carry an "Ad-hoc" badge.
- Skipped sessions show "No workout logged" and no metrics.
- Click opens `SessionDetail`.

`SessionDetail.tsx` (read-only):

- Date, focus, routine + cycle week, status, source.
- Exercise list with target vs actual sets, weights/reps, per-exercise volume.
- Session total volume and set count.
- Notes.
- No inputs, no delete, no reopen. A completed session from today can be reopened only from Today,
  not from History.
- If the session is skipped, show a muted explanation and no exercises.

## 6. Charts without a library

`src/components/charts/`:

```
BarChart.tsx        horizontal or vertical bars, labels, values, accessible table fallback
TrendChart.tsx      line/area over time with points and tooltips
StackedBars.tsx     completed/skipped per week
```

Rules:

- Pure SVG, `viewBox`, `role="img"`, `aria-label`, plus a visually hidden table or a "Table" toggle
  for screen readers.
- No animation beyond a 150ms opacity/height transition, disabled by `prefers-reduced-motion`.
- Use CSS variables for colours; no hard-coded hex in components.
- Y axes start at zero. X labels thin out on narrow screens (show every other week).
- Tooltips work on hover and focus; touch taps toggle the nearest point.
- Empty and single-point series render gracefully ("Not enough data for a trend").
- Format weights to at most one decimal; volumes with `Intl.NumberFormat` and compact notation.

## 7. Files

Create:

```
src/domain/metrics.ts
src/views/ProgressView.tsx
src/views/HistoryView.tsx
src/components/ExerciseDetail.tsx
src/components/SessionDetail.tsx
src/components/PrTable.tsx
src/components/MuscleBars.tsx
src/components/RangePicker.tsx
src/components/charts/BarChart.tsx
src/components/charts/TrendChart.tsx
src/components/charts/StackedBars.tsx
```

Update:

```
src/App.tsx             progress/history routes, detail panel selection
src/state/navigation.ts sessionId/exerciseId handling
src/state/hooks.ts      useSessionSummaries, useExerciseIndex (memoized)
src/styles.css          progress grids, charts, history rows, detail panel
src/views/TodayView.tsx last-time hint may reuse exercise history selector
```

No new dependency. No chart package.

## 8. Performance

- The target maximum is ~1,000 sessions and ~20,000 sets, which is trivial for one pass in memory.
- Build indexes once per sessions change:
  - `sessionsByExercise: Map<string, Session[]>`
  - `sessionsByDate: Map<string, Session>`
- Avoid computing PRs inside every row; compute once per view.
- History list renders in chunks of 50; "Load more" appends.
- Chart points cap at 200; if more, aggregate by week for the trend.
- No virtualization library. If a list exceeds ~300 rendered rows, paginate instead.

## 9. Correctness checks

Use a hand-built fixture during development (not committed as an automated test suite):

```
Session A (completed): Bench 100×5, 90×8; volume 1220
Session B (completed): Bench 105×3, 100×5; volume 815
Session C (skipped): Bench 100×5 (should not exist on skipped, but verify it is ignored)
```

Expected:

- PR 5 reps = 100 (Session A date, tie with B but earliest wins).
- PR 3 reps = 105.
- PR 8 reps = 90.
- Bench volume total = 2,035.
- Bench top-weight trend: A 100, B 105.
- Adherence with A, B, C = completed 2, skipped 1, rate 0.667.

Muscle check: Bench primary pectoralis major, secondary triceps + anterior deltoid. A 100×5 = 500.
Pectoralis +500; triceps +250; anterior deltoid +250. Add a second primary muscle to the fixture and
confirm the 500 is split, not duplicated.

## 10. Verification checklist

```bash
pnpm typecheck
pnpm build
```

- [ ] Complete two sessions with the same exercise at different weights/reps.
- [ ] PR table shows the heaviest weight per rep count with the correct earliest date.
- [ ] A heavier set updates the PR and removes the previous recent-PR badge.
- [ ] Bodyweight sets are excluded from PRs and labelled.
- [ ] Volume matches a manual calculation, including primary split and secondary half.
- [ ] Muscle bars include zero weeks and all trained muscles; the totals can exceed raw volume
      because secondary muscles receive half credit in addition to full primary credit. The caption
      explains the attribution.
- [ ] Adherence excludes rest days and ad-hoc sessions from the rate; future planned sessions do not
      lower it.
- [ ] History filters work and never expose edit controls.
- [ ] Charts have accessible labels and a table alternative.
- [ ] Empty states appear for new users and for filters with no matches.
- [ ] Mobile: tabs, charts and detail sheets fit; no horizontal page scroll.
- [ ] Switching range recomputes without visible lag on 500 sessions.

## 11. Risks

| Risk | Mitigation |
|------|------------|
| Metric definitions drift between client and server | Duplicate the rules in Stage 7 with a written parity checklist; use the same fixture |
| Volume double-counting | Explicit split formula; fixture with multiple primary muscles |
| PR tie ambiguity | Earliest date rule, documented in the UI tooltip |
| Charts unreadable on mobile | Responsive viewBox, thinned labels, table toggle |
| Recomputing on every render | `useMemo` keyed by sessions and range; one-pass indexes |
| "Recent PR" confusion | Caption: "All-time bests achieved in this period" |

## 12. Exit criteria

The user can answer "what is my bench PR at 5 reps?", "how much chest volume did I do last week?",
"did I stick to my routine?", and "what did I do on 12 November?" entirely from derived data, with
no editing in history. Stage 7 can reuse the same definitions to build the AI report.
