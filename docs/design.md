# Trainer — design and contract

Status: Stage 1 design. This document freezes the product model and the machine contract before any
product code changes. The staged plan in [`docs/stages/README.md`](stages/README.md) remains the
source of truth; this document is the written design that Stages 2–8 implement.

Companion contract files:

- [`docs/api/openapi.json`](api/openapi.json) — OpenAPI 3.1 draft for the relay API.
- [`docs/ai/context-report.schema.json`](ai/context-report.schema.json) — JSON Schema for the
  context report consumed by n8n.
- [`docs/ai/n8n-prompt.md`](ai/n8n-prompt.md) — node-by-node n8n workflow and the system prompt.

---

## 1. Intent

Trainer is a personal, local-first training log for one person. It owns the repeating schedule and
the record of what was actually lifted. An external AI workflow reads a compact training report and
writes today's exercise plan; the user trains and logs weight and reps. Trainer derives progress
from those logs.

The AI never needs the full history. It needs today's focus, a short window of relevant sessions,
per-exercise trends, a bounded list of exercises it is allowed to choose, recent muscle volume and
adherence. That is the context report.

There are no accounts, no social features, no in-app language model and no model-provider key in
the browser. The app is single-user and works without a network.

## 2. The loop

```
routine → scheduled slot → generated session → logged sets → derived history → next generated session
```

1. The user builds a routine: a repeating cycle of 1–12 weeks, seven weekdays per week. Each slot is
   a workout with a focus label or rest.
2. On a scheduled workout day, the client creates a planned session with no exercises.
3. n8n reads `/api/v1/context`, asks a model for a plan from a bounded candidate list, and writes the
   plan back to the relay with `PUT /api/v1/sessions/{date}`.
4. The app receives the plan through normal encrypted sync and shows the exercises with target sets
   and rep ranges.
5. The user logs weight and reps for every set and finishes the workout.
6. PRs, volume, muscle balance, adherence and history are computed from the logged sessions.
7. Tomorrow's context report includes the new history, so the next plan can progress from it.

Rest days create no session. A missed scheduled workout becomes `skipped`; it remains visible in
history and adherence.

## 3. Goals, non-goals and anti-goals

### Goals

- Fast set logging in a gym, including with poor or no signal.
- One active routine that describes any weekly or multi-week schedule.
- An external AI workflow that can program each day from a compact, validated report.
- Exact, explainable PRs, volume, muscle attribution and adherence.
- Portable data: a complete JSON backup and a restore that replaces local state.
- Installable PWA with an offline shell.

### Non-goals for v1

- No accounts, authentication UI, multi-user spaces, sharing or social features.
- No in-app LLM, chat or model-provider API key.
- No push, email or in-app reminders. Status is visible in the app only.
- No cardio, heart-rate, body-measurement, nutrition or sleep tracking.
- No RPE, tempo, rest timers or per-set completion flags.
- No pounds toggle; weight is kilograms.
- No exercise images or videos.
- No automatic routine generation; the user builds routines manually in v1.
- No bodyweight load tracking or bodyweight volume. Bodyweight is logged as weight `0` and counts
  toward sets, not volume or PRs.
- No separate revocable API tokens yet.

### Anti-goals

- A chatbot inside the app.
- A server that stores plaintext logs.
- A calendar of future exercise lists. Only today's plan exists; future days are routine slots.
- A catalogue the AI can extend at write time. Plans reference known exercises only.
- A stored progress entity. Every metric is derived from sessions.

## 4. Why local-first, and why a relay

**Local-first.** Logging happens standing over a bench, often with no signal. Every action writes to
IndexedDB first and no screen waits on the network. The user owns a visible database and a plain JSON
backup. There is no account to lose and no server required for daily use.

**The relay.** n8n cannot read IndexedDB. The relay is the meeting point: it stores the same encrypted
entities the app syncs, authenticates with the sync passphrase, decrypts in memory to build the
report and validate writes, and serves a read-only MCP surface. It also gives the app multi-device
sync using the existing change log and HLC ordering.

**Trust boundary.** The relay is trusted for personal use. It can decrypt entities in memory while
serving a request. This is the same trade-off as the existing MCP server and is accepted. The
consequences are documented in §12: TLS is mandatory, the passphrase is a full-access secret, and
logs must never contain decrypted payloads or authorization headers.

## 5. Canonical domain model

The target shape is implemented in `src/domain/types.ts` in Stage 3. This stage only documents it.
Dates are local calendar strings, never UTC timestamps for "today".

```ts
export type IsoDate = string;      // YYYY-MM-DD, local calendar date
export type IsoDateTime = string;  // ISO 8601 with offset, audit fields only
export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7; // ISO: 1 Monday … 7 Sunday

export type MuscleGroupId =
  | 'anterior-deltoid' | 'posterior-deltoid'
  | 'biceps-brachii' | 'brachialis' | 'triceps-brachii'
  | 'pectoralis-major' | 'latissimus-dorsi' | 'rhomboid'
  | 'trapezius' | 'serratus-anterior' | 'erector-spinae'
  | 'rectus-abdominis' | 'obliquus-externus-abdominis'
  | 'gluteus-maximus' | 'quadriceps-femoris' | 'hamstrings'
  | 'gastrocnemius' | 'soleus';

export type EquipmentId =
  | 'barbell' | 'dumbbell' | 'machine' | 'cable'
  | 'bodyweight' | 'kettlebell' | 'band' | 'other';

export type ExerciseCategory =
  | 'chest' | 'back' | 'shoulders' | 'arms'
  | 'legs' | 'calves' | 'abs' | 'full-body';

export interface Exercise {
  id: string;              // wger:<id> for seeded rows, UUID for custom rows
  name: string;
  aliases: string[];
  category: ExerciseCategory;
  primaryMuscles: MuscleGroupId[];
  secondaryMuscles: MuscleGroupId[];
  equipment: EquipmentId[];
  instructions: string;
  source: 'wger' | 'custom';
  createdAt: IsoDateTime | null; // custom only
}

export interface RoutineSlot {
  weekIndex: number;       // 0-based
  weekday: Weekday;
  kind: 'workout' | 'rest';
  focus: string;           // "Push", "Upper", "Legs A"; empty on rest
  note: string;
}

export interface Routine {
  id: string;              // UUID
  name: string;
  notes: string;
  startDate: IsoDate;      // routine applies from this date
  weekCount: number;       // 1..12
  slots: RoutineSlot[];    // exactly weekCount * 7, unique (weekIndex, weekday)
  active: boolean;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export type SessionStatus = 'planned' | 'completed' | 'skipped';
export type SessionSource = 'ai' | 'manual' | 'auto';

export interface SetLog {
  id: string;              // UUID, row identity
  weight: number;          // kg, >= 0, at most 2 decimals
  reps: number;            // integer, 1..999
}

export interface SessionExercise {
  id: string;              // UUID, row identity
  exerciseId: string;      // catalogue id
  name: string;            // snapshot
  primaryMuscles: MuscleGroupId[];   // snapshot
  secondaryMuscles: MuscleGroupId[]; // snapshot
  order: number;
  targetSets: number;      // 1..12
  targetRepMin: number;    // 1..50
  targetRepMax: number;    // >= min, <= 50
  note: string;
  sets: SetLog[];          // performed sets only
}

export interface Session {
  id: string;              // UUID
  date: IsoDate;
  routineId: string | null;
  routineName: string;     // snapshot
  weekIndex: number | null;
  weekday: Weekday;
  focus: string;           // snapshot; "Ad-hoc" for manual sessions
  status: SessionStatus;
  source: SessionSource;
  exercises: SessionExercise[];
  notes: string;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  completedAt: IsoDateTime | null;
  skippedAt: IsoDateTime | null;
}

export interface Settings {
  theme: 'nordic-light' | 'nordic-dark';
  soundEnabled: boolean;
  hapticsEnabled: boolean;
  timezone: string;        // IANA; display and "today"
}

export interface BackupFile {
  app: 'trainer';
  version: 1;
  exportedAt: IsoDateTime;
  routines: Routine[];
  sessions: Session[];
  customExercises: Exercise[]; // source === 'custom'
  settings: Settings;
}
```

### Model decisions

- **Embedded exercises and sets.** A session is the unit of consistency, sync and immutability.
  Copying one record protects history without a multi-store transaction.
- **Snapshots.** `routineName`, `focus`, `weekIndex`, exercise names and muscles are copied at
  session creation. Renaming a focus or deleting a custom exercise never rewrites history.
- **`source: 'auto'`.** The client creates empty scheduled sessions. A missing day is auto-skipped.
  This is distinct from an AI plan (`ai`) and an ad-hoc workout (`manual`), and history says which.
- **No derived fields.** PRs, volume, adherence and streaks are computed from sessions on demand.
- **No per-set completion flag.** A set exists only when it was performed. Empty draft rows are
  component state.
- **No rest sessions.** Rest lives on the routine slot, so adherence is not diluted by rest days.
- **One active routine.** Activation deactivates every other routine in one transaction. Backup or
  sync can produce two actives; normalization keeps the most recently updated.

### Persistence

The browser stores routines, sessions, custom exercises and settings in IndexedDB database `trainer`,
schema v1, using stores `routines`, `sessions`, `exercises`, `settings`, plus sync stores `outbox`,
`versions` and `sync_state` created empty for Stage 7. The seeded catalogue is code, not a store.
Tasker's `tasker` database is never opened, migrated or deleted.

## 6. Dates, cycles and session lifecycle

### Calendar rules

- "Today" is the local calendar date in the device timezone. It is produced from local date parts,
  never `Date.prototype.toISOString()`.
- ISO weekdays are 1 Monday through 7 Sunday.
- A routine is anchored to the **Monday of the week containing `startDate`**. Week 0 is that calendar
  week. The routine does not schedule dates before `startDate`.
- Cycle arithmetic:

```
anchor    = mondayOf(routine.startDate)
days      = daysBetween(anchor, date)   // local noon, integer
weekIndex = floor(days / 7) % routine.weekCount
weekday   = isoWeekday(date)
slot      = slots.find(s => s.weekIndex === weekIndex && s.weekday === weekday)
```

- If `date < startDate`, no slot resolves; the day belongs to no routine. If a corrupt routine has no
  matching slot, treat it as rest rather than throwing.
- A start date of Wednesday means Monday and Tuesday of that week are before the routine and resolve
  to nothing. Later weeks still line up with real Monday-based weeks.

### Bootstrap

On app mount after the snapshot loads, when the app becomes visible, and at local midnight while
open:

1. If an active routine has a workout slot today and no session exists for today, create a `planned`
   session with `source: 'auto'` and no exercises.
2. Backfill missing scheduled workout dates in the window from `max(startDate, today - 13)` through
   yesterday as `skipped`, `source: 'auto'`. This is the 14-day window including today; it prevents
   activating an old routine from creating hundreds of records.
3. Mark every `planned` session with `date < today` as `skipped`.
4. If today's session became skipped at a clock edge, leave it. The past is terminal.

Bootstrap is serialized behind a module-level promise so React StrictMode and two rapid reloads
cannot create duplicate sessions. A session date is unique; the write path checks the date index
inside the transaction.

### Manual sessions

A user may log an ad-hoc workout on a rest day or with no routine. It uses `focus: 'Ad-hoc'`,
`routineId: null`, `weekIndex: null`, `source: 'manual'`, and behaves like any other session. It
counts as completed training but not as scheduled adherence.

## 7. Editing, completion and replacement

- A session is editable while `session.date === today` and the status is `planned` or `completed`.
  A skipped session is read-only even on its date.
- Completing sets `status: 'completed'`, `completedAt`, and `updatedAt`. It does not trim or rewrite
  exercises. Empty exercises are allowed with a warning. Completing with no sets asks for
  confirmation.
- Reopening is allowed only on the same date. After midnight the session is read-only, including via
  the API. Completion is terminal at midnight.
- An AI or manual plan may replace the exercise list only while the session has zero logged sets.
  This prevents a late or duplicate n8n run from erasing a workout in progress.
- If the user edits a plan and n8n writes a fresh plan before the first set is logged, the remote plan
  wins. That is the documented conflict rule; it is the newer intent.
- Removing an exercise with logged sets, or a set with values, requires confirmation.

## 8. Derived rules

All metrics are computed from sessions. Only `completed` sessions contribute to PRs, volume and
muscle metrics. Skipped and planned sessions contribute only to adherence.

### 8.1 PRs

For every set with `weight > 0` and `reps > 0`, key by `(exerciseId, reps)`. The PR is the maximum
weight for that key, and the date is the **earliest** date that first achieved that maximum. Ties go
to the earlier date. Bodyweight sets (`weight = 0`) produce no PR.

Rep counts are displayed 1–20, with reps above 20 grouped as `20+`; the group's entry is the
heaviest set above 20 and the detail shows its exact rep count. The exercise name comes from the most
recent session snapshot.

### 8.2 Volume and muscle credit

For a set with `weight > 0` and `reps > 0`:

```
v = weight * reps
if primaryMuscles.length > 0:
    each primary muscle   += v / primaryMuscles.length
    each secondary muscle += (v / 2) / secondaryMuscles.length
else if secondaryMuscles.length > 0:
    each secondary muscle += v / secondaryMuscles.length
```

Volume is shown in kilograms. Sets with `weight = 0` count toward set totals but add no volume. This
is a documented limitation for pull-ups and dips. Aggregation uses ISO weeks, Monday–Sunday. Weeks
with no training appear with zeros so charts show gaps. Muscle totals can exceed raw session volume
because secondary muscles receive half credit in addition to the primary credit.

### 8.3 Adherence

For scheduled workout dates in a range:

```
scheduled = completed + skipped + planned-in-range
completed = sessions with status completed
skipped   = sessions with status skipped
rate      = completed / (completed + skipped)
```

Future `planned` sessions are excluded from the rate because they have no outcome yet. Rest days
never create sessions and are excluded. Ad-hoc sessions are reported separately, count as completed
training, and are excluded from the scheduled rate. When `completed + skipped` is zero, the rate is
null and the UI shows "—".

### 8.4 Status shown on Today

Derived, never stored:

| Status | Condition |
|--------|-----------|
| **No routine** | No active routine |
| **Rest** | Today's slot is rest |
| **Plan pending** | Planned session with zero exercises |
| **Planned** | Planned session with exercises and zero logged sets |
| **In progress** | Planned session with at least one logged set |
| **Completed** | Session status completed |
| **Skipped** | Session status skipped |

Status is always shown with text and an icon or shape, never colour alone.

## 9. Screens

### Today

The daily workspace. It shows the long date, routine name and cycle week; a Monday–Sunday week strip;
a derived status card; the exercise plan with targets and last performance; per-set weight and reps
inputs; and a finish bar.

- **No routine** — explains the missing routine with a link to Routine.
- **Rest** — a rest card and an optional "Log a workout" path.
- **Plan pending** — "Waiting for today's plan", an "Add exercises" action, and a short explanation
  that the external workflow writes the plan.
- **Planned / In progress** — target sets, logged sets, volume so far, and the finish action.
- **Completed** — a summary with total sets, total volume and exercises trained, plus "Reopen" while
  it is still today and "View history".
- **Skipped** — a muted explanation and read-only detail.

Set rows use kilograms and reps. Weight `0` is explicitly bodyweight. Empty draft rows live only in
component state; a set is persisted when reps are at least 1. The finish bar is sticky on desktop and
fixed above the mobile tab bar with safe-area padding. History is never editable from Today.

### Routine

A list of routines (active first) and the cycle editor. A routine card shows name, active badge, week
count, start date and a miniature seven-day preview. Actions are Edit, Set active, Duplicate and
Delete.

The editor has a name, start date, week-count stepper (1–12), an active control, Save and Discard.
The grid is seven weekday columns by `weekCount` rows; each cell is a workout focus or rest and opens
a bottom sheet with a Workout/Rest choice, a focus with suggestion chips and a note. Week tools copy
the previous week or clear a week. A "Next 14 days" preview resolves the actual dates. On mobile each
week becomes seven full-width day rows; there is no horizontal grid scroll.

At least one workout slot is required to save. A blank workout focus defaults to "Workout". A dirty
editor prompts before navigation. Structural edits save explicitly, never by autosave. Switching the
active routine never changes existing sessions; deleting one leaves history intact.

### Progress

Three tabs, all derived: Overview, Exercises and Muscles.

- **Overview** — completed workouts, total volume, sets logged, adherence rate; an adherence bar
  chart; muscle balance; recent PRs; recent sessions.
- **Exercises** — exercises present in completed sessions, sorted by most recent, with last date and
  best set. Selecting one opens exercise detail.
- **Muscles** — volume by muscle for 4, 12 or 26 weeks, a weekly trend for one muscle, and a
  Volume/Weighted sets toggle with a table fallback.

Empty states are honest: "Progress appears after your first completed session."

### History

A read-only list of completed and skipped sessions grouped by month, newest first. Filters cover
status, focus, exercise and date preset. Each row shows date, focus, routine, status, sets, volume and
exercise count; ad-hoc sessions carry an "Ad-hoc" badge. A skipped session shows "No workout logged"
and no metrics. Selecting a row opens session detail. There are no inputs, delete actions or reopen
controls in History.

### Settings

Appearance (theme), Training (sound and haptics), Exercises (custom exercise list and editor), Data
(export, import, reset, storage persistence, record counts), Sync (relay URL, passphrase, connect,
status, pending count, last sync, fingerprint, API setup) and About (version, offline/PWA note,
catalogue attribution and license). Sync and the API section arrive in Stage 7. Notifications do not
exist.

### Exercise picker and exercise detail

The picker is a searchable bottom sheet with muscle, equipment and category filters, multi-add, and
inline creation of a custom exercise. Defaults for a new plan row are 3 sets and 8–12 reps.

Exercise detail shows name, category, equipment, primary and secondary muscles, instructions, and
derived stats: sessions, sets, best set, total volume, first and last performed, PR count, a PR table
by rep count and a top-set or volume trend. Everything is derived and read-only.

### Session detail

A read-only record for one date: date, focus, routine and cycle week, status, source, exercises with
targets versus actual sets, per-exercise volume, session volume, set count and notes. A completed
session from today may be reopened only from Today.

### Interface rules

- Desktop uses a left rail with Today, Routine, Progress, History, Settings. The rail collapses to
  icons below 1100px.
- Mobile uses a bottom tab bar with Today, Routine, Progress, More. More opens History, Settings and
  About.
- Creation, pickers and detail panels use the existing swipe-to-close `BottomSheet` in the thumb zone.
- One primary action per state. No floating action button.
- Touch targets are at least 44×44 px, safe areas are respected and pages never scroll horizontally.
- Weights, reps, volume and PRs use tabular numerals.
- Charts are pure SVG with `role="img"`, labels and a table fallback. No chart library.
- Focus rings, keyboard operation and `prefers-reduced-motion` are required.
- Palette and type scale come from `DESIGN.Md`: ice blue/slate accents on cool gray surfaces.
  Semantic tokens add `--success` (completed), `--warning` (plan pending), `--danger` (skipped or
  error) and `--rest`.

## 10. Exercise catalogue

- The seeded catalogue comes from the wger exercise API, English (`language=2`), text fields only.
- The build script records the exact license name, source URL and retrieval date in
  `src/domain/catalogue/ATTRIBUTION.md`; attribution appears in Settings > About and the README.
- Muscle names map to the 18 `MuscleGroupId` values. Unmapped names are preserved in a build report
  and added deliberately, never guessed at runtime.
- Equipment maps to the eight `EquipmentId` values. Machines, cables, barbells and dumbbells are all
  equipment; they are not exercises.
- Seeded ids are deterministic: `wger:<wger exercise id>`. Re-running the script does not reorder or
  renumber rows.
- Rows without an English name, a category or a usable primary muscle are excluded. Duplicate
  normalized names keep the lowest wger id.
- The target size is the full usable English catalogue, expected 200–400 rows. No images.
- The seeded catalogue is read-only. Custom exercises are stored separately with UUID ids and a
  uniqueness check against normalized catalogue names, so API name resolution stays unambiguous.
- The generated JSON is committed. Builds never fetch the network.

## 11. API contract

The canonical machine contract is [`docs/api/openapi.json`](api/openapi.json). Base path `/api/v1`.
Authentication is `Authorization: Bearer <sync passphrase>`. The API is server-to-server for n8n and
debugging; the app itself does not poll it.

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/v1/context?date=YYYY-MM-DD` | Compact report for the LLM |
| GET | `/api/v1/routines` | All routines, active first |
| GET | `/api/v1/exercises?query=&muscle=&equipment=&category=&limit=` | Compact catalogue search |
| GET | `/api/v1/sessions?from=&to=&status=&focus=&limit=` | Sessions in a date range |
| GET | `/api/v1/prs?exerciseId=` | PRs, optionally for one exercise |
| GET | `/api/v1/muscles/volume?weeks=` | Weekly volume per muscle group |
| PUT | `/api/v1/sessions/{date}` | Create or replace today's planned session |
| GET | `/api/v1/openapi.json` | Public OpenAPI 3.1 spec, no auth |

### Context report

`GET /context` returns exactly the Stage 1 shape, including a `version` field for future compatibility
(currently `1`). The schema is [`docs/ai/context-report.schema.json`](ai/context-report.schema.json).

```json
{
  "version": 1,
  "date": "2026-11-16",
  "generatedAt": "2026-11-16T06:00:00+00:00",
  "routine": {
    "id": "6d1c2f6e-6f6a-4c3e-9f0a-6d1c2f6e6f6a", "name": "PPL 2-week", "weekIndex": 0, "weekday": 1,
    "focus": "Push", "isRest": false
  },
  "recentSessions": [
    {
      "date": "2026-11-09", "focus": "Push", "status": "completed",
      "exercises": [
        {
          "exerciseId": "wger:192", "name": "Bench Press",
          "primaryMuscles": ["pectoralis-major"],
          "sets": [{"weight": 80, "reps": 8}, {"weight": 80, "reps": 7}],
          "topWeight": 80, "volume": 1200
        }
      ]
    }
  ],
  "exerciseStats": [
    {
      "exerciseId": "wger:192", "name": "Bench Press",
      "primaryMuscles": ["pectoralis-major"],
      "last": {"date": "2026-11-09", "sets": [{"weight": 80, "reps": 8}]},
      "prs": {"5": 95, "8": 80},
      "volumeTrend": [1200, 1350, 1280]
    }
  ],
  "candidates": [
    {
      "exerciseId": "wger:145", "name": "Incline Dumbbell Press",
      "primaryMuscles": ["pectoralis-major"],
      "secondaryMuscles": ["triceps-brachii", "anterior-deltoid"],
      "equipment": ["dumbbell"]
    }
  ],
  "muscleVolume": [
    {"week": "2026-W45", "muscles": {"pectoralis-major": 8200, "triceps-brachii": 4100}}
  ],
  "adherence": {
    "weeks": 8, "scheduled": 16, "completed": 12, "skipped": 4, "rate": 0.75
  }
}
```

`routine` is `null` when there is no active routine. `last` is `null` only if no performance exists.

Compaction limits, enforced by the relay:

- `recentSessions`: the 6 most recent completed or skipped sessions with the same focus, otherwise
  the 6 most recent completed or skipped sessions overall.
- `exerciseStats`: at most 20 exercises drawn from those recent sessions; `volumeTrend` holds the
  last three occurrences.
- `candidates`: at most 40 exercises, drawn from recent same-focus exercises plus exercises sharing
  their primary muscles, with a focus-based category heuristic. Custom exercises are merged in.
  Candidate entries carry ids, names, muscles and equipment only.
- `muscleVolume`: 8 ISO weeks.
- `adherence`: 8 weeks.
- The whole report targets under roughly 15 KB with 8 weeks of data.

### Writing today's plan

`PUT /sessions/{date}` accepts:

```json
{
  "source": "ai",
  "focus": "Push",
  "notes": "Week 1 push, slightly reduced pressing volume.",
  "exercises": [
    {
      "exerciseId": "wger:192",
      "targetSets": 4,
      "targetRepMin": 6,
      "targetRepMax": 8,
      "note": "Leave one rep in reserve."
    },
    {
      "name": "Incline Dumbbell Press",
      "targetSets": 3,
      "targetRepMin": 8,
      "targetRepMax": 12
    }
  ]
}
```

Rules:

- At most 30 exercises; `targetSets` 1–12; rep range 1–50 with min ≤ max; note ≤ 500 characters;
  session notes ≤ 2000 characters.
- `exerciseId` wins. Otherwise `name` is normalized (case, punctuation, whitespace) and must match
  exactly one catalogue or custom exercise. Unknown names return `422`; ambiguous names return `409`
  with up to five candidate ids.
- Writes from yesterday through 14 days ahead in the relay timezone: a one-day grace for timezone edges and a 14-day planning horizon for n8n.
- `409` if the session is completed or skipped, if any set is already logged, or if it is an ad-hoc
  manual session. `409` if the day is a rest day or there is no active routine.
- The response is the full stored session. The write is encrypted and ordered with a fresh HLC, so
  clients merge it normally.
- `400` malformed body or invalid date; `401` auth failure; `429` rate limit; `500` internal error
  with no stack.

Errors use the shape `{ "error": "session_closed", "message": "This session is already complete.", "details": { "date": "2026-11-16" } }`.

## 12. Security and operations

- The bearer key is the sync passphrase. It grants full read/write to the space. Use a long random
  passphrase, store it in the n8n credential store, and never place it in workflow JSON or logs.
- TLS is mandatory. The relay must not be exposed over plain HTTP.
- The relay decrypts entities in memory to build reports and validate writes. Logs must never print
  decrypted payloads, derived keys or the `Authorization` header. Logs record request id, method,
  path, status and duration only.
- Rate limit API routes per token and IP: 120 requests per minute; passphrase derivation is capped at
  20 per minute. Body limit 256 KB. Derivation keys are cached in memory for 10 minutes, capped at 50
  entries.
- Browser origins are not allowed on `/api/v1` unless explicitly listed in `API_CORS_ORIGINS`
  (default empty); n8n is server-to-server. Sync and MCP keep their separate CORS behavior.
- Backups are plaintext JSON by design because the user asked for a portable export. Treat a backup
  file as sensitive.
- A separate revocable API token is a later enhancement. v1 uses the passphrase.

## 13. Sync, backup and reset

- All routines, sessions, custom exercises and settings sync as encrypted entities. The seeded
  catalogue does not sync; it is code.
- Session merge protects terminal state: a local completed or skipped session is not replaced by a
  remote planned payload; a remote terminal record is authoritative; two planned records take the
  later payload; two terminal records take the later update.
- Every user action writes locally first and enqueues an outbox record only after the local write
  succeeds. Remote writes apply silently and do not enqueue.
- Export creates `trainer-backup-YYYY-MM-DD.json` with `app: "trainer"`, `version: 1`, routines,
  sessions, custom exercises and settings. The seeded catalogue is excluded.
- Import is replace-only, validated and normalized, and blocked while sync is connected. A newer
  version is rejected. Import never merges.
- Reset requires typing `DELETE`, deletes only the `trainer` database and sync-related local keys,
  and never touches `tasker`.

## 14. Decisions locked by this stage

- Routine slots own a focus/rest flag and a note only; the AI composes exercises per session.
- One active routine; cycles are 1–12 weeks; weekdays are real ISO weekdays; the cycle is Monday
  anchored.
- Rep targets are ranges; sets are a count. The AI never prescribes weight.
- PR is the heaviest weight for a given rep count, earliest date on a tie.
- Muscle volume uses primary full credit and secondary half credit.
- The catalogue is seeded from wger (text only) plus custom exercises. Machines are equipment.
- n8n handles AI. The app has no LLM calls and no model-provider keys.
- The API uses the sync passphrase. A separate revocable token is deferred.
- The database is `trainer`; Tasker's `tasker` database is untouched.
- There are no notifications or reminders. ntfy and web push are removed.
- Weight is kilograms; bodyweight is `0`; there is no lb toggle.
- Sessions are editable only on their own date, and completion is terminal at midnight.
- Missed scheduled workouts are backfilled as skipped for at most the last 14 days.

## 15. Open questions for review

These do not block Stage 1 and are recorded so later stages do not reopen them by accident:

- Should the API be able to create or edit routines? v1 says no.
- Should a missed day be backfilled before the routine's activation date? v1 says no.
- Should a future version support revocable API tokens and bodyweight load tracking? Yes, later; not
  in v1.
