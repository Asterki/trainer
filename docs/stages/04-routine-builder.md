# Stage 4 — Routine builder

**Goal:** let the user define the repeating cycle that drives every session: N weeks × 7 weekdays,
each slot a workout focus or rest, with one active routine.

**Depends on:** Stage 3.
**Produces:** cycle arithmetic, Routine view, slot editor, activation rules, 14-day preview.

---

## 1. The model this stage owns

A routine is a schedule, not an exercise list.

```
PPL 2-week (active, start 2026-11-16)
Week 0   Mon Push   Tue Pull   Wed Legs   Thu Rest   Fri Upper   Sat Lower   Sun Rest
Week 1   Mon Push B Tue Pull B Wed Legs B Thu Rest   Fri Upper B Sat Lower B Sun Rest
```

Week 0 Push and Week 1 Push are different slots. They may use the same focus label or different
ones ("Push" / "Push B"), and the AI will generate different exercises from history and the weekly
context. Trainer never stores exercises on a slot.

### Cycle arithmetic (`src/domain/routine.ts`)

```ts
export function mondayOf(date: IsoDate): IsoDate;
export function cycleStart(routine: Routine): IsoDate; // mondayOf(startDate)

export interface ResolvedSlot {
  weekIndex: number;
  weekday: Weekday;
  kind: 'workout' | 'rest';
  focus: string;
  note: string;
  date: IsoDate;
}

export function resolveSlot(routine: Routine, date: IsoDate): ResolvedSlot | null;
export function upcomingSlots(routine: Routine, from: IsoDate, days: number): ResolvedSlot[];
export function nextWorkout(routine: Routine, from: IsoDate): ResolvedSlot | null;
```

`resolveSlot` returns `null` when `date < routine.startDate` or the routine is invalid/empty.

```
anchor    = mondayOf(routine.startDate)
days      = daysBetween(anchor, date)  // local noon, integer
weekIndex = floor(days / 7) % routine.weekCount
weekday   = isoWeekday(date)
slot      = routine.slots.find(s => s.weekIndex === weekIndex && s.weekday === weekday)
```

Edge rules:

- A start date of Wednesday means Monday/Tuesday of that week are before the routine and return
  `null`; the visible cycle still begins Monday so all later weeks align.
- DST never shifts the day index because calculations use local noon.
- If a route has no matching slot (corrupt data), return a rest slot rather than throwing.
- `nextWorkout` scans at most `weekCount * 7 * 2` days and returns null if every slot is rest.

## 2. Store additions

In `TrainerProvider` (Stage 3 surface):

```ts
createRoutine(input: {
  name: string;
  notes?: string;
  startDate: IsoDate;
  weekCount: number;
  slots?: RoutineSlot[]; // optional initial pattern
}): Promise<Routine>;

updateRoutine(id: string, patch: {
  name?: string;
  notes?: string;
  startDate?: IsoDate;
  weekCount?: number;
  slots?: RoutineSlot[];
}): Promise<void>;

deleteRoutine(id: string): Promise<void>;
setActiveRoutine(id: string): Promise<void>;
```

Rules:

- `createRoutine` defaults to 1 week, all rest, start date = today, and generates the exact slot
  grid. It does not activate automatically.
- `setActiveRoutine` runs one readwrite transaction: set `active = false` on every other routine,
  set `active = true` and `updatedAt` on the target, then update state. Exactly one active routine.
- `deleteRoutine` is allowed for an active routine after confirmation. Sessions keep snapshots.
- `updateRoutine` normalizes; if `weekCount` shrinks, slots outside the new range are dropped. If it
  grows, new slots are rest. The UI confirms before losing non-rest slots.
- Changing `startDate` affects future session creation only. Existing sessions keep `weekIndex` and
  `routineName` snapshots.
- Activating a routine with a start date far in the past does not immediately create history. The
  Stage 5 backfill still caps at 14 days.

If more than one active routine is found on load (backup or sync edge), keep the most recently
updated and deactivate the rest in one transaction.

## 3. Routine view layout

`src/views/RoutineView.tsx`:

### No routines

Centered empty state:

- "Build a routine"
- Two sentences: a routine is a repeating cycle of weeks; each weekday is a workout focus or rest;
  the AI chooses the exercises for each session.
- Primary button: "Create routine".

### With routines

A list of routine cards, active first, then by `updatedAt`:

- Name, "Active" badge, week count, start date.
- Miniature 7-column preview of week 0 (focus initials or rest dot).
- Actions: Edit, Set active (if inactive), Duplicate, Delete.
- "New routine" button.

Selecting a routine opens the editor in the main pane (desktop) or a full-height sheet (mobile).

## 4. Routine editor

### Header

- Name input (2–60 chars, required).
- Start date (`input type="date"`, required).
- Week count stepper: 1–12, with "Add week" and "Remove last week".
- Active toggle/button: "Set as active routine".
- Save and Discard. Dirty-state indicator.

### Grid

Desktop: a table with 7 weekday columns and `weekCount` rows.

```
            Mon      Tue      Wed      Thu      Fri      Sat      Sun
Week 1      Push     Pull     Legs     Rest     Upper    Lower    Rest
Week 2      Push B   Pull B   Legs B   Rest     Upper B  Lower B  Rest
```

Each cell is a button showing:

- Workout: focus label, plus a small dot for a note.
- Rest: muted "Rest".

Clicking opens the slot sheet.

Mobile: each week is a section with seven full-width day rows. Same sheet. No horizontal scrolling
grid on narrow screens.

Grid requirements:

- Keyboard: cells are buttons in DOM order; Enter/Space opens the sheet; arrow-key navigation is
  optional but preferred.
- Current day column highlighted if today falls in the displayed cycle week.
- A legend: workout dot, rest dot, note dot.

### Slot sheet

Uses the existing `BottomSheet`:

- Segmented control: Workout / Rest.
- Focus input, with suggestion chips: Push, Pull, Legs, Upper, Lower, Full body, Cardio, Mobility.
  Free text is allowed. Max 40 chars.
- Note input, max 200 chars.
- Save / Cancel.
- Switching to Rest clears the focus in the saved slot (the draft can keep it until save).

### Week tools

Per week, a small menu:

- **Copy previous week** — copies kind/focus/note into this week's seven slots.
- **Clear week** — sets all seven to rest, with confirmation.
- **Apply pattern** — optional: the user can type a comma-separated pattern like
  `Push, Pull, Legs, Rest, Upper, Lower, Rest` and fill a week. This is a fast path, not required for
  acceptance.

These tools matter for the 2-week PPL case: build week 1, copy to week 2, then rename the focuses.

### Preview

Below the grid: "Next 14 days", a compact list from today:

```
Mon 16 Nov · Week 1 · Push
Tue 17 Nov · Week 1 · Pull
Wed 18 Nov · Week 1 · Legs
Thu 19 Nov · Week 1 · Rest
```

If the routine starts in the future, the preview begins at the start date and says so.

### Validation

- Name required, trimmed, 2–60.
- Start date valid.
- Week count 1–12.
- At least one workout slot.
- Every workout slot needs a focus; if blank on save, default to "Workout" rather than blocking.
- Save is disabled only for name/start-date errors. Slot issues are auto-corrected visibly.

### Unsaved changes

- Navigating away with a dirty editor asks "Discard changes?".
- Save is explicit, not autosave. Structural edits are too easy to misfire on mobile.
- After a successful save, show a short toast and clear dirty state.

## 5. Activation and switching

- If no routine is active, the editor's primary action is "Set as active".
- Activating asks: "Use this routine from {startDate}? Existing sessions are unchanged."
- If another routine is active: "Switch active routine? {Old} will stop scheduling new sessions.
  Existing sessions and history are kept."
- The active routine is what TodayView resolves. Inactive routines can be edited and previewed but
  never generate sessions.
- Deleting the active routine leaves no active routine. Today shows the no-routine state.

## 6. Duplication

- Duplicate copies name + " copy", notes, start date (today if the original start is in the past),
  week count and slots.
- The copy is inactive.
- New ids for the routine; slot values copied.

## 7. Files

Create:

```
src/domain/routine.ts
src/views/RoutineView.tsx
src/components/RoutineGrid.tsx
src/components/RoutineSlotSheet.tsx
src/components/RoutinePreview.tsx
src/components/ConfirmDialog.tsx     // replaces window.confirm for destructive actions
```

Update:

```
src/state/store.tsx                  routine actions, active invariant
src/state/hooks.ts                   useActiveRoutine, useRoutine(id)
src/App.tsx                          Routine route + dirty guard
src/styles.css                       routine grid, week sections, slot sheet, preview
```

Do not add a drag-and-drop dependency. Reordering weeks or days is not a requirement; week count and
slot edits cover the model.

## 8. Edge cases

| Case | Behaviour |
|------|-----------|
| Start date in the future | No sessions until that date; preview starts there |
| Start date in the past | Backfill caps at 14 days in Stage 5 |
| All slots rest | Save blocked with "Add at least one workout day" |
| Remove a week with workout slots | Confirm; those dates stop being scheduled |
| Switch active routine mid-week | New routine starts scheduling from its start date; old sessions stay |
| Duplicate then edit | Independent; no shared references |
| Delete a routine with history | Allowed; sessions keep name/focus snapshots |
| Two active routines after import | Normalize to most recently updated |
| Timezone change | Dates recalculate locally; stored dates do not shift |

## 9. Verification checklist

```bash
pnpm typecheck
pnpm build
```

- [ ] Create a 2-week routine with Push/Pull/Legs/Rest/Upper/Lower/Rest in week 1.
- [ ] Copy week 1 to week 2 and rename the focuses; both weeks persist.
- [ ] Set the routine active; the badge moves and no other routine is active.
- [ ] Preview shows the correct focus for each of the next 14 days.
- [ ] Change the start date and confirm the preview shifts without changing saved sessions.
- [ ] Shrink week count from 2 to 1; the UI warns about lost workout slots.
- [ ] All-rest routine cannot be saved.
- [ ] Delete an active routine; Today falls back to "No active routine".
- [ ] Duplicate a routine; the copy is inactive and independent.
- [ ] Unsaved changes prompt on navigation.
- [ ] Mobile: every slot is editable from a thumb-reachable sheet; no horizontal scroll.
- [ ] Keyboard: cells open with Enter/Space; focus returns to the cell after the sheet closes.

## 10. Risks

| Risk | Mitigation |
|------|------------|
| User expects exercises on routine days | Copy and empty states explain the AI/session split |
| Week anchoring confusion | Monday anchor, preview, and week labels make it visible |
| Accidental structure loss | Explicit save, dirty guard, confirmations for destructive actions |
| Active-routine races | Single transaction; load-time normalization |

## 11. Exit criteria

The user can describe any repeating weekly or multi-week schedule, activate it, and see exactly
which focus applies to the next 14 days. Stage 5 can resolve today's slot and create a session from
it without changing the routine model.
