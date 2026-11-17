# Stage 5 — Today and logging

**Goal:** make the daily loop real. Open the app, see today's status and generated plan, log every
set, finish the workout, and let missed days become skipped automatically.

**Depends on:** Stages 3–4.
**Produces:** session lifecycle, Today view, per-set logging, plan editing, ad-hoc sessions,
auto-skip.

---

## 1. Session lifecycle

```
routine slot (workout)
        │ bootstrap creates
        ▼
   planned, 0 exercises ── n8n PUT / manual add ──► planned, N exercises
        │                                               │
        │ first set logged                              │
        ▼                                               ▼
   in progress (derived) ── finish ──► completed ── midnight ──► read-only
        │
        └── midnight passes ──► skipped (if no completion)
```

Rest days never create sessions. A manual ad-hoc session can be created on a rest or no-routine day.

### Bootstrap routine (`src/domain/session.ts` + store)

Run on mount (after snapshot load), on `visibilitychange` → visible, and at local midnight while
the app is open:

```
ensureSessions(today):
  if active routine:
    for date in [max(startDate, today - 13) .. yesterday]:
      if slot(date).kind === 'workout' and no session(date):
        createSession(date, slot, status='skipped', source='auto', exercises=[])
    if slot(today).kind === 'workout' and no session(today):
      createSession(today, slot, status='planned', source='auto', exercises=[])

  for each session with status='planned' and date < today:
    status='skipped'; skippedAt=now; updatedAt=now
```

Important details:

- Sessions are keyed by date conceptually, but the record uses a UUID. The store keeps a
  `date → session` map and must reject a second session for the same date. Use the `date` index and
  a check inside the write transaction.
- `source: 'auto'` marks a session the app created without a plan. When n8n fills it, the source
  becomes `'ai'` only if a plan arrives; otherwise it stays auto. A manual add changes it to
  `'manual'` only when the user starts an ad-hoc session, not when they edit an auto session.
- Backfill stops at 13 days so a routine started months ago does not create hundreds of records.
- Rest days are resolved live from the routine; they have no session and no history row.
- If the app is closed at midnight, the next open performs the same pass. Nothing depends on a
  daemon.
- Race guard: bootstrap is serialized behind a module-level promise; React StrictMode double-mount
  must not create duplicate sessions.
- After midnight while open, the previous day's session becomes read-only immediately. The Today
  view re-renders with the new date and creates today's session if needed.

### Manual ad-hoc sessions

Available from a rest day, a no-routine day, or the empty plan state:

- "Log a workout" creates a session for today with `focus: 'Ad-hoc'`, `routineId: null`,
  `weekIndex: null`, `source: 'manual'`, status planned.
- It behaves like any other session: add exercises, log sets, finish.
- Ad-hoc sessions count as completed training but not as scheduled adherence.

## 2. Session rules

### Target model

- A session exercise has `targetSets`, `targetRepMin`, `targetRepMax`, and an optional note.
- These are targets only. Weight is never prescribed by the AI.
- Logged sets are independent records. The user may log more or fewer sets than targeted.
- A set exists only when it has reps ≥ 1. Weight defaults to 0 when blank (bodyweight).
- Weight is kg, stored as a number rounded to 2 decimals. Input step 0.5; typing 1.25 is allowed.
- Reps are integers 1–999.

### Editing

- Editable while `date === today` and status is `planned` or `completed`.
- Add exercise, remove exercise, reorder (up/down), edit targets and notes, add/remove sets, change
  weight/reps, edit session notes.
- Removing an exercise with logged sets asks for confirmation.
- Removing a set with values asks for confirmation; an empty draft row just disappears.
- Reopening a completed session is allowed on the same date.
- Past or skipped sessions are read-only. The UI shows a lock note instead of controls.

### Completion

- "Finish workout" sets `completedAt`, status completed, `updatedAt`.
- If no sets are logged, confirm: "No sets logged. Mark as completed anyway?" The alternative is
  "Keep training".
- Completion is not blocked by unlogged target sets. Real training varies.
- The post-workout card shows: total sets, total volume (kg), exercises trained, duration is not
  tracked.
- "Reopen" is available until midnight.

### AI plan replacement

- A session is "plan pending" when planned with zero exercises.
- Adding/removing exercises in the app is allowed and does not change source.
- When Stage 7 delivers a remote plan, it replaces the exercise list only if the local session has
  zero logged sets. The store applies the same guard during sync. A plan that arrives after the
  first set must not erase the workout.
- If the user edits the plan and then n8n writes a fresh plan before any set is logged, the remote
  plan wins (it is the newer intent). This is the documented conflict rule.

## 3. Today view

`src/views/TodayView.tsx` composition:

```
┌──────────────────────────────────────────────┐
│ Monday 16 November                    [⋯]    │
│ PPL 2-week · Week 1                           │
│                                               │
│ PUSH                              Planned     │
│ 4 exercises · 14 target sets                  │
│ ███████░░░░  8 / 14 sets                      │
│                                               │
│ [ Finish workout ]                            │
├──────────────────────────────────────────────┤
│ 7-day strip: M T W T F S S                    │
├──────────────────────────────────────────────┤
│ Bench Press                  chest · barbell  │
│ 4 × 6–8 · note                                 │
│ Last: 80×8, 80×7, 77.5×7                      │
│ Set 1  [ 80.0 ] kg  [ 8 ] reps  [×]          │
│ Set 2  [ 80.0 ] kg  [ 7 ] reps  [×]          │
│ + Add set                                     │
├──────────────────────────────────────────────┤
│ Incline Dumbbell Press                        │
│ …                                             │
└──────────────────────────────────────────────┘
```

### Header and week strip

- Long date, routine name and cycle week.
- Week strip: Monday–Sunday of the current week. Each day shows weekday initial, day number, a dot
  if a session exists, a check if completed, a slash if skipped, a hollow dot if rest, and today's
  ring. Tapping a past day opens its read-only detail (Stage 6 route); future days are not editable.
- On mobile the strip scrolls only if needed; it should fit seven columns.

### Status card

Derived status from Stage 1:

- `No routine` — CTA to Routine.
- `Rest` — rest card, plus "Log a workout" link.
- `Plan pending` — "Waiting for today's plan" + "Add exercises" + hint that n8n writes the plan.
- `Planned` / `In progress` / `Completed` / `Skipped`.

Metrics: exercises count, logged sets / target sets, volume so far. Volume uses the Stage 1 formula
but display is the raw `weight × reps` sum (muscle attribution is Stage 6).

### Exercise card

- Name, category, equipment chips, primary muscle chips.
- Target line: `4 × 6–8` plus note.
- Last-time line: the most recent completed session (excluding today) containing the same
  `exerciseId`; show up to three sets as `80×8, 80×7, 77.5×7`, or "First time".
- Set rows: set index, weight input, reps input, remove button. Inputs are thumb-sized (44px).
- "Add set" appends a row prefilled with the previous row's weight/reps, or the target min.
- Empty draft row is local state. On reps > 0 (or weight > 0 with reps), persist after a 300ms
  debounce and on blur. Show a subtle saving indicator.
- Enter in reps moves focus to the next row's weight, creating a row if needed.
- Invalid reps (0, negative, > 999) show inline error and do not persist.

### Plan editing mode

A toggle in the status card: "Edit plan" / "Done".

- Target inputs become editable: sets (1–12), rep min/max. Notes editable.
- Exercise order controls (up/down).
- Remove exercise.
- Add exercise opens the picker.
- Set logging remains available in both modes; the goal is not to force a modal workflow.
- Session notes textarea at the bottom, saved debounced.

### Exercise picker sheet

- Search input with 150ms debounce; filters: muscle group, equipment, category.
- Rows: name, primary muscles, equipment; tap to add.
- Multi-add: the sheet stays open after adding, with a checkmark and an "Added" state; a sticky
  "Done (n)" closes it.
- Defaults: 3 sets, 8–12 reps, no note. Targets editable immediately after.
- Custom exercise creation: a secondary action opens the Stage 3 form in the same sheet; on save the
  new exercise is added to the session.
- Empty search state suggests clearing filters and creating a custom exercise.

### Finish bar

- Desktop: sticky within the main column.
- Mobile: fixed above the tab bar with safe-area padding.
- Shows sets logged and "Finish workout".
- Disabled only while a set save is in flight; otherwise confirm if empty.
- After completion: summary card with "Reopen" and "View history" (Stage 6).

## 4. Store additions

```ts
ensureSessions(): Promise<void>;

createAdHocSession(): Promise<Session>;
updateSessionNotes(id: string, notes: string): Promise<void>;

addSessionExercise(sessionId: string, exercise: Exercise): Promise<void>;
updateSessionExercise(sessionId: string, exerciseRowId: string, patch: {
  targetSets?: number;
  targetRepMin?: number;
  targetRepMax?: number;
  note?: string;
}): Promise<void>;
removeSessionExercise(sessionId: string, exerciseRowId: string): Promise<void>;
moveSessionExercise(sessionId: string, exerciseRowId: string, direction: -1 | 1): Promise<void>;

logSet(sessionId: string, exerciseRowId: string, set: SetLog): Promise<void>;
updateSet(sessionId: string, exerciseRowId: string, setId: string, patch: Partial<SetLog>): Promise<void>;
removeSet(sessionId: string, exerciseRowId: string, setId: string): Promise<void>;

completeSession(id: string): Promise<void>;
reopenSession(id: string): Promise<void>; // same-day only
```

Implementation notes:

- Every action reads the latest session from the in-memory ref, normalizes the changed record,
  writes the whole session to IndexedDB, then updates state. Whole-record writes keep the session
  atomic and match the sync model.
- `updatedAt` changes on every persisted mutation.
- Guard in every mutating action: date must be today and status not skipped, otherwise throw a
  user-readable error.
- `logSet` generates a UUID if the set id is missing.
- Renumber `order` after add/remove/move.
- Normalization clamps values; the UI validates first for good messages.
- Stage 7 adds outbox recording around these writes; do not couple them now.

Selectors/hooks:

```ts
useTodaySession(): Session | null;
useSessionByDate(date: IsoDate): Session | null;
useLastPerformance(exerciseId: string): { date: IsoDate; sets: SetLog[] } | null;
useTodaySlot(): ResolvedSlot | null;
```

These compute from `sessions` and the active routine; no extra storage.

## 5. Date and time handling

- `todayIso()` uses local date parts, never `toISOString()` (which can be the previous/next day).
- Midnight timer: compute the delay to local 00:00:05, `setTimeout`, then re-run bootstrap and
  reschedule. Also re-run on visibility and on window focus.
- If the device clock changes while open, the next visibility change reconciles.
- No duration tracking and no start time. `completedAt` is audit data, not a timer.

## 6. Failure states

- DB write failure: keep the input value in local state, show a banner "Could not save. Retry", and
  retry on the next change. Do not silently drop a set.
- A session disappearing (reset/import in another tab): the view shows the empty state and
  re-bootstraps.
- Two tabs: last write wins at the record level; a `storage`/BroadcastChannel listener is optional.
  At minimum, reloading the snapshot on visibility change prevents a stale screen. Document that
  simultaneous editing in two tabs is not supported.
- A corrupt record is normalized on read; if it cannot be normalized, it is skipped and reported in
  a non-blocking banner.

## 7. Files

Create:

```
src/domain/session.ts              build, resolve, ensure, complete, derive status, volume
src/views/TodayView.tsx
src/components/WeekStrip.tsx
src/components/SessionStatusCard.tsx
src/components/SessionExerciseCard.tsx
src/components/SetLogger.tsx
src/components/ExercisePickerSheet.tsx
src/components/FinishBar.tsx
```

Update:

```
src/state/store.tsx                session actions, bootstrap serialization, selectors
src/state/hooks.ts                 today session, last performance, today slot
src/App.tsx                        midnight/visibility bootstrap, today route
src/styles.css                     today layout, set grid, sticky bar, picker
src/domain/date.ts                 todayIso, midnight delay helper
```

## 8. Verification checklist

```bash
pnpm typecheck
pnpm build
```

Set up a 2-week routine with today as a workout day and the previous 14 days containing scheduled
workouts.

- [ ] First boot creates today's planned session with zero exercises.
- [ ] Missing scheduled days in the last 13 days appear as skipped, with no exercises.
- [ ] Rest days create no session and show the rest state.
- [ ] "Add exercises" opens the picker; adding two exercises shows targets and last-time hints.
- [ ] Logging `80 × 8` persists across reload; an empty row does not.
- [ ] Removing a set with values asks for confirmation.
- [ ] Changing targets persists; reordering works.
- [ ] Finish with sets completes the session, shows summary, and locks editing after reload (still
      same day, so reopen is allowed).
- [ ] Reopen works before midnight; after midnight the session is read-only.
- [ ] Simulate midnight (change system date or temporarily shorten the timer) and confirm yesterday
      is skipped and today is created.
- [ ] An ad-hoc session on a rest day logs and completes.
- [ ] A past skipped session shows a read-only view.
- [ ] Two rapid reloads do not create duplicate sessions for one date.
- [ ] Mobile: one-hand logging, inputs not hidden by the keyboard, finish bar respects safe areas.
- [ ] No fake data appears in any empty state.

## 9. Risks

| Risk | Mitigation |
|------|------------|
| Duplicate sessions from StrictMode/two tabs | Serialized bootstrap + date uniqueness check in transaction |
| Input loss on flaky write | Local draft + retry banner |
| Midnight while training | Completion before midnight is the rule; UI warns after 23:30 once |
| AI plan overwrites a workout | Reject/replace only when no sets are logged |
| Large sessions slow writes | Whole-session writes are small; 30 exercises × 12 sets is still tiny |
| Bodyweight volume looks like zero | Explained in manual; counted in sets, not volume |

## 10. Exit criteria

A full training day can be completed offline: plan visible, sets logged per exercise, session
finished, missed days recorded. Stage 6 can compute PRs and volume from the sessions this stage
writes.
