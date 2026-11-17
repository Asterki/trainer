# Stage 1 — Design and contract

**Goal:** freeze the product model and the machine contract before touching product code.

**Depends on:** nothing.
**Produces:** `docs/design.md`, `docs/api/openapi.json`, `docs/ai/context-report.schema.json`,
`docs/ai/n8n-prompt.md`. No source files, no dependency changes, no database changes.

This stage is the gate for every later stage. If the model changes after Stage 3, it costs a
migration; if it changes after Stage 7, it costs an API version.

---

## 1. Product definition to write down

`docs/design.md` must cover, in plain language:

1. **Intent.** A personal training log that an AI can program daily without reading the full log.
2. **The loop.** Routine → scheduled slot → generated session → logged sets → derived history →
   next generated session.
3. **Screens.** Today, Routine, Progress, History, Settings, exercise picker/detail, session detail.
4. **Non-goals.** No accounts, no social features, no public sharing, no in-app LLM, no reminders,
   no cardio/HR tracking, no RPE, no body measurements, no nutrition, no lb units, no exercise
   images, no automatic routine generation (manual only in v1).
5. **Anti-goals.** A chatbot in the app; a server that stores plaintext logs; a calendar of future
   exercise lists; an exercise catalogue that the AI can extend at write time.
6. **Why local-first.** Fast logging in a gym with poor signal; ownership of data; simple backup.
7. **Why the relay exists.** n8n cannot reach IndexedDB. The relay is the meeting point and already
   has encrypted sync, auth and HLC ordering.
8. **Trust boundary.** The relay decrypts in memory for reports and validation. This is the same
   trade-off as the current MCP server and is accepted for personal use.

## 2. Canonical domain model

This is the shape to implement. Dates are local calendar strings, not UTC timestamps.

```ts
// src/domain/types.ts (target shape, not created in this stage)

export type IsoDate = string;      // YYYY-MM-DD, local calendar date
export type IsoDateTime = string;  // ISO 8601 with offset, for audit fields

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
  /** `wger:<id>` for seeded rows, UUID for custom rows. Stable forever. */
  id: string;
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
  weekIndex: number;   // 0-based
  weekday: Weekday;
  kind: 'workout' | 'rest';
  focus: string;       // "Push", "Upper", "Legs A"; empty on rest
  note: string;
}

export interface Routine {
  id: string;          // UUID
  name: string;
  notes: string;
  startDate: IsoDate;  // routine applies from this date; week 0 is its Monday-based week
  weekCount: number;   // 1..12
  slots: RoutineSlot[]; // exactly weekCount * 7, unique (weekIndex, weekday)
  active: boolean;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export type SessionStatus = 'planned' | 'completed' | 'skipped';
export type SessionSource = 'ai' | 'manual' | 'auto';

export interface SetLog {
  id: string;          // UUID, for row identity
  weight: number;      // kg, >= 0, rounded to 2 decimals
  reps: number;        // integer, 1..999
}

export interface SessionExercise {
  id: string;          // UUID, row identity
  exerciseId: string;  // catalogue id
  name: string;        // snapshot
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
  id: string;          // UUID
  date: IsoDate;
  routineId: string | null;
  routineName: string; // snapshot
  weekIndex: number | null;
  weekday: Weekday;
  focus: string;       // snapshot, "Ad-hoc" for manual sessions
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
  timezone: string;    // IANA, used for display and "today"
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

### Why these choices

- **Embedded exercises and sets.** A session is the unit of consistency and sync. Embedding avoids
  a five-store transaction and makes a session immutable by copying one record.
- **Snapshots.** `routineName`, `focus`, `weekIndex`, exercise names and muscles are copied. Renaming
  "Push" to "Push A" or deleting an exercise never changes history.
- **`source: 'auto'`.** The client creates empty scheduled sessions. It marks them skipped later.
  This is different from an AI plan and from a manual ad-hoc session, and history should say which.
- **No derived fields in storage.** XP, streaks, PRs and volume are computations. Deleting a session
  must immediately change the derived numbers.
- **No `completed` flag per set.** The presence of a set in `sets` means it was performed. Empty
  draft rows live in component state only.
- **No rest sessions.** Rest is a routine slot. Only workout days become sessions, so adherence is
  not diluted by rest days.

## 3. Derived rules to specify exactly

### 3.1 Today and session creation

- `today` is the local calendar date in the device timezone.
- The cycle is anchored to the **Monday of the week containing `startDate`**, so week 0 is a full
  calendar week and weekday slots line up with real weekdays. A routine does not schedule dates
  before `startDate`.
- `anchor = mondayOf(startDate)`; `days = daysBetween(anchor, date)` using local noon to avoid DST
  drift; `weekIndex = floor(days / 7) % weekCount`.
- `weekday` follows ISO (1 Monday … 7 Sunday).
- On app boot, on `visibilitychange`, and at local midnight:
  1. Ensure a session exists for today if the slot is a workout and no session exists.
  2. Backfill missing scheduled workout dates in the window `[max(startDate, today - 13), yesterday]`
     as `skipped`, `source: 'auto'`.
  3. Mark any `planned` session with `date < today` as `skipped`.
  4. If today's session was skipped by a clock edge, leave it; past is terminal.
- Backfill is capped at 14 days so activating an old routine does not create hundreds of records.
- Rest days show a rest state from the slot and create no session.

### 3.2 Editing and completion

- Editable: `session.date === today && session.status !== 'skipped'`.
- Completing sets `status: 'completed'`, `completedAt: now`, and trims nothing. Empty exercises are
  allowed but warned about.
- Reopening is allowed only on the same date.
- After midnight the session is read-only, including via API.
- The API may replace a planned session only when it has zero logged sets. This prevents a late or
  duplicate n8n run from erasing a workout in progress.

### 3.3 PRs

For every set with `reps > 0` and `weight > 0`, key by `(exerciseId, reps)`. The PR is the maximum
weight for that key, with the date it first achieved that maximum. Rep counts are displayed 1–20 and
grouped as `20+` beyond 20. Bodyweight sets (`weight = 0`) do not produce PRs.

### 3.4 Volume and muscle credit

For a set with `weight > 0` and `reps > 0`:

```
v = weight * reps
if primaryMuscles.length > 0:
    each primary muscle += v / primaryMuscles.length
    each secondary muscle += (v / 2) / secondaryMuscles.length
else if secondaryMuscles.length > 0:
    each secondary muscle += v / secondaryMuscles.length
```

Only completed sessions count. Aggregate by ISO week (Monday–Sunday). Displayed as kg volume.
Sets with `weight = 0` count toward set totals but not volume. This is a documented limitation for
pull-ups and dips; a bodyweight setting is a later feature.

### 3.5 Adherence

Over a range, for scheduled workout dates only:

```
scheduled  = completed + skipped + planned-in-range
completed  = sessions with status completed
skipped    = sessions with status skipped
rate       = completed / (completed + skipped)
```

`planned` in the future is excluded from the rate. Rest days are excluded. Ad-hoc sessions count as
completed but not as scheduled; display them separately.

### 3.6 Status shown on Today

Derived, not stored:

- `Rest` — slot is rest.
- `No routine` — no active routine.
- `Plan pending` — planned session with zero exercises.
- `Planned` — planned session with exercises and zero logged sets.
- `In progress` — planned session with at least one logged set.
- `Completed` — completed.
- `Skipped` — skipped.

## 4. Seed catalogue contract

- Source: wger exercise API, English (`language=2`), text fields only.
- The build script must record the exact license and attribution found at build time. Do not assume;
  write `src/domain/catalogue/ATTRIBUTION.md` with source URL, date, license name and share-alike
  obligations.
- Map wger muscle names to the 18 `MuscleGroupId` values above. Preserve unmapped names in a build
  report so they can be added deliberately.
- Map wger equipment to `EquipmentId`. Machines, cables, barbells and dumbbells are equipment.
- Deterministic ids: `wger:<wger exercise id>`. Re-running the script must not reorder or renumber.
- Exclude exercises without an English name, without a category, or with an empty muscle list.
- Deduplicate by normalized name, keeping the lowest wger id.
- The catalogue is read-only in the app. Custom exercises are stored separately.
- Target size: the full usable English catalogue, expected 200–400 rows. No images.

## 5. API contract to draft

Canonical file: `docs/api/openapi.json` (JSON so the relay can serve it without a YAML parser).
Base path `/api/v1`. Auth: `Authorization: Bearer <sync passphrase>`.

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/v1/context?date=YYYY-MM-DD` | Compact report for the LLM |
| GET | `/api/v1/routines` | All routines, active first |
| GET | `/api/v1/exercises?query=&muscle=&equipment=&limit=` | Compact catalogue search |
| GET | `/api/v1/sessions?from=&to=` | Sessions in a date range |
| GET | `/api/v1/prs?exerciseId=` | PRs, optionally one exercise |
| GET | `/api/v1/muscles/volume?weeks=` | Weekly volume per muscle group |
| PUT | `/api/v1/sessions/{date}` | Create/replace today's planned session |
| GET | `/api/v1/openapi.json` | Public spec, no auth |

`GET /context` response draft:

```json
{
  "date": "2026-11-16",
  "generatedAt": "2026-11-16T06:00:00+00:00",
  "routine": {
    "id": "…", "name": "PPL 2-week", "weekIndex": 0, "weekday": 1,
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

Compaction limits, all enforced server-side:

- `recentSessions`: 6 most recent completed/skipped sessions with the same focus, else 6 most recent.
- `exerciseStats`: at most 20 exercises, chosen from those recent sessions.
- `candidates`: at most 40 exercises, from recent same-focus sessions' exercises plus exercises
  sharing their primary muscles. This keeps the LLM able to choose ids without a 300-row catalogue.
- `muscleVolume`: 8 ISO weeks.
- `adherence`: 8 weeks.

`PUT /sessions/{date}` request draft:

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

- Max 30 exercises, `targetSets` 1–12, rep range 1–50, note ≤ 500 chars.
- `exerciseId` wins. Otherwise `name` is normalized (case, punctuation, whitespace) and must match
  exactly one catalogue exercise. Ambiguous → `409` with candidate ids. Unknown → `422`.
- Writes only to today's date in the relay timezone (plus a ±1 day grace for timezone edges).
- `409` if the session is completed or skipped, or if any set is already logged.
- Response is the full stored session.
- Auth failure `401`. Malformed body `400`. Rate limit `429`.

## 6. Context report schema

`docs/ai/context-report.schema.json` is a JSON Schema draft for the `GET /context` response, with
`additionalProperties: false` on the stable objects. The relay has a hand-written validator for the
same rules; the schema is the documentation and n8n reference.

## 7. n8n flow to write

`docs/ai/n8n-prompt.md` describes the workflow node by node:

1. **Schedule Trigger** — every day at 06:00 in the gym timezone.
2. **HTTP Request** — `GET {relay}/api/v1/context`, Header Auth `Authorization: Bearer <key>`.
3. **Code** — validate the report, format a compact prompt.
4. **LLM** — system prompt with rules: use only `candidates` ids, 3–8 exercises, respect focus,
   target sets 2–5, rep ranges 5–15, progressive overload from `exerciseStats`.
5. **Code** — parse JSON, reject unknown ids, clamp numeric ranges, produce the PUT body.
6. **HTTP Request** — `PUT {relay}/api/v1/sessions/{date}`.
7. **Error branch** — notify via an n8n error workflow; never retry blindly after a `409`.
8. **Manual test** — a pinned context fixture and a dry-run PUT to a staging relay.

The prompt must tell the model: do not invent exercises, do not prescribe weight, do not repeat a
session verbatim, and prefer exercises with recent history. Weight is the user's job; targets are
sets and rep ranges only.

## 8. Security and operations to document

- The bearer key is the sync passphrase. It grants full read/write to the space. Use a long random
  passphrase; store it as an n8n credential, never in the workflow JSON.
- TLS is mandatory; the relay must not be exposed over plain HTTP.
- The relay decrypts in memory. Logs must never print decrypted payloads or the Authorization header.
- Rate limit API routes per token/IP. Body limit 256 KB.
- Backups contain plaintext by design (the user asked for JSON export). Treat the file as sensitive.
- A separate revocable API token is a later enhancement; note it, do not build it.

## 9. Deliverables checklist

- [ ] `docs/design.md` written and reviewed.
- [ ] `docs/api/openapi.json` validates against OpenAPI 3.1.
- [ ] `docs/ai/context-report.schema.json` validates the example above.
- [ ] `docs/ai/n8n-prompt.md` includes the system prompt and a sample request/response.
- [ ] Data model accepted with no field missing for Stages 4–6.
- [ ] Defaults confirmed: kg, bodyweight 0, text-only catalogue, today-only editing, 14-day backfill.
- [ ] No source files changed.

## 10. Risks and open questions

| Risk | Mitigation |
|------|------------|
| Report too large for the model | Hard limits; candidates instead of full catalogue |
| Timezone mismatch between n8n, relay and phone | Explicit date, relay `TRAINER_TIMEZONE`, ±1 day write grace |
| AI repeats sessions | Prompt includes recent sessions and explicit variety rule |
| User logs after midnight | Past is read-only; document "finish before midnight" |
| wger data quality (duplicate names, missing muscles) | Build-time normalization report; custom exercises for gaps |
| Passphrase in n8n | Long random key, n8n credential store, TLS, optional token later |

Open for review: whether the API should also create routines (currently no), and whether a missed
day should be backfilled before the routine's activation date (currently no).
