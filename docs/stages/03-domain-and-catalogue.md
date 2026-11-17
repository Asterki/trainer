# Stage 3 — Domain and catalogue

**Goal:** replace the task domain with the Trainer domain, create the `trainer` IndexedDB, ship the
wger-derived exercise catalogue, and make backup/restore real.

**Depends on:** Stages 1–2.
**Produces:** Trainer types, normalized persistence, catalogue loader/search, custom exercises,
settings, JSON export/import.

This is the foundation stage. Stages 4–7 must not need to change the session or routine shapes.

---

## 1. Files

### Create

```
src/domain/catalogue/groups.ts          muscle, equipment, category constants and labels
src/domain/catalogue/wger.ts            load, index, search the seeded catalogue
src/domain/catalogue/wger-exercises.json  generated, committed, text only
src/domain/catalogue/ATTRIBUTION.md     source, date, license, obligations
src/db/normalize.ts                     per-entity normalization and validation
scripts/build-exercises.mjs             wger fetch + map + write JSON + report
src/views/SettingsView.tsx              real settings, data, about sections
src/domain/backup.ts                    export/import validation and file naming
```

### Rewrite

```
src/domain/types.ts
src/db/database.ts
src/state/store.tsx
src/state/hooks.ts
src/main.tsx
src/App.tsx                              mount provider, remove temporary theme
src/styles.css                           add settings/data styles, delete leftovers
```

### Delete

```
src/domain/parser.ts
src/domain/progress.ts
src/domain/recurrence.ts
src/domain/suggestions.ts
src/notifications/ntfy.ts
src/notifications/schedule.ts
src/notifications/engine.ts
src/sync/engine.ts
src/sync/recorder.ts
src/sync/types.ts
```

Keep `src/sync/crypto.ts` and `src/sync/hlc.ts`; Stage 7 rebuilds the engine around the new entity
kinds. Keep the old versions in git history; do not copy task-specific merge rules forward.

`src/domain/date.ts` is kept and extended with local-date helpers:

```ts
export function toIsoDate(date: Date): string;
export function fromIsoDate(value: string): Date; // local noon
export function addDays(value: string, days: number): string;
export function isoWeekday(value: string): Weekday; // 1..7
export function isoWeekKey(value: string): string;  // YYYY-Www, Monday-based
export function daysBetween(a: string, b: string): number; // local noon
export function todayIso(): string;
```

No generic `utils.ts`.

## 2. IndexedDB `trainer` v1

Open with `indexedDB.open('trainer', 1)`. Never open or delete `tasker`.

| Store | Key | Indexes | Contents |
|-------|-----|---------|----------|
| `routines` | `id` | `active`, `updatedAt` | Full `Routine` records |
| `sessions` | `id` | `date`, `status`, `routineId`, `dateStatus` | Full `Session` records |
| `exercises` | `id` | `nameNormalized` | Custom exercises only |
| `settings` | `id` (`'app'`) | — | One `Settings` record |
| `outbox` | `seq` (auto) | `entity` | Sync queue, created now, used in Stage 7 |
| `versions` | `[entityType, entityId]` | — | Last synced HLC, created now |
| `sync_state` | `key` | — | Cursor and config metadata, created now |

Create all sync stores in v1 so Stage 7 does not require a schema upgrade. They can stay empty.

### Database module responsibilities

- `openDatabase()` with `blocked`/`versionchange` handling and a single cached promise.
- `loadSnapshot(): Promise<{ routines, sessions, customExercises, settings }>`.
- `readEntity<T>(kind, id)`, `writeEntity(kind, value)`, `deleteEntity(kind, id)` for the four
  domain kinds.
- `writeEntitySilently` for sync application in Stage 7 (no outbox record).
- `clearAllData()` (rows only) and `deleteDatabase()` (full reset, used by Settings).
- `ensureSettings()` writes defaults once.
- Outbox helpers matching the existing relay protocol: `listOutbox`, `putOutbox`, `removeOutbox`,
  `clearOutboxForEntity`, `readSyncState`, `writeSyncState`, `deleteSyncState`, `clearSyncStores`.
  They stay unused until Stage 7.
- `requestPersistentStorage()` calls `navigator.storage.persist()` once; log the result, do not
  block startup.

### Normalization rules

All data crossing a boundary (IndexedDB read, backup import, sync apply in Stage 7, API write on the
server) goes through the same rules, implemented per entity in `src/db/normalize.ts`:

- IDs: non-empty strings; generated with `crypto.randomUUID()`.
- Dates: strict `YYYY-MM-DD`, valid calendar date. Audit timestamps: valid ISO strings.
- `Routine.weekCount`: clamp 1–12; `slots` must contain exactly `weekCount * 7` unique
  `(weekIndex, weekday)` pairs; fill missing with rest; drop extras; clamp focus to 40 chars.
- `Routine.active`: boolean; the store guarantees at most one.
- `Session.status`: one of the three values; invalid → `planned`.
- `Session.source`: one of the three values; invalid → `manual`.
- `SessionExercise`: `targetSets` 1–12, rep min/max 1–50 and ordered, `order` renumbered 0..n.
- `SetLog`: weight 0–1000 rounded to 2 decimals; reps integer 1–999. Sets with reps 0 are dropped.
- `Settings`: known theme values, timezone string, booleans. Unknown keys dropped.
- Lists deduplicate by id; array order is preserved except where `order` is explicit.

Normalizers return new objects. Never mutate input.

## 3. Catalogue constants

`groups.ts` exports labelled constants, not free strings:

```ts
export const MUSCLE_GROUPS: Array<{ id: MuscleGroupId; label: string }> = [
  { id: 'anterior-deltoid', label: 'Anterior deltoid' },
  { id: 'posterior-deltoid', label: 'Posterior deltoid' },
  { id: 'biceps-brachii', label: 'Biceps brachii' },
  { id: 'brachialis', label: 'Brachialis' },
  { id: 'triceps-brachii', label: 'Triceps brachii' },
  { id: 'pectoralis-major', label: 'Pectoralis major' },
  { id: 'latissimus-dorsi', label: 'Latissimus dorsi' },
  { id: 'rhomboid', label: 'Rhomboid' },
  { id: 'trapezius', label: 'Trapezius' },
  { id: 'serratus-anterior', label: 'Serratus anterior' },
  { id: 'erector-spinae', label: 'Erector spinae' },
  { id: 'rectus-abdominis', label: 'Rectus abdominis' },
  { id: 'obliquus-externus-abdominis', label: 'Obliquus externus abdominis' },
  { id: 'gluteus-maximus', label: 'Gluteus maximus' },
  { id: 'quadriceps-femoris', label: 'Quadriceps femoris' },
  { id: 'hamstrings', label: 'Hamstrings' },
  { id: 'gastrocnemius', label: 'Gastrocnemius' },
  { id: 'soleus', label: 'Soleus' },
];
```

Equipment: `barbell`, `dumbbell`, `machine`, `cable`, `bodyweight`, `kettlebell`, `band`, `other`.
Categories: `chest`, `back`, `shoulders`, `arms`, `legs`, `calves`, `abs`, `full-body`.

Provide lookup maps and display labels. Do not scatter muscle strings through components.

## 4. Catalogue build script

`scripts/build-exercises.mjs`, run manually, Node 20+, no new dependency:

```
node scripts/build-exercises.mjs
```

Steps:

1. Fetch `https://wger.de/api/v2/exerciseinfo/?language=2&limit=100` and follow `next` links.
2. Use a descriptive User-Agent, 30s timeout, up to 3 retries with backoff, and a 250ms delay
   between pages.
3. Keep exercises with a non-empty English name, category and at least one mapped primary muscle.
4. Map category names case-insensitively to `ExerciseCategory`.
5. Map wger muscle names to `MuscleGroupId`; write every unmapped name to the build report.
6. Map equipment names to `EquipmentId`; unknown or missing → `other`; bodyweight/reps-only
   exercises should include `bodyweight`.
7. Convert description HTML to plain text: `<br>`/`</p>` → newline, strip tags, decode common
   entities, collapse blank lines, cap at 1200 characters.
8. Deduplicate by normalized name, keeping the lowest wger id. If two different exercises share a
   name, keep the first and log the collision; the API name resolver depends on usable uniqueness.
9. Emit compact JSON:

```json
[
  {
    "wgerId": 192,
    "name": "Bench Press",
    "category": "chest",
    "primary": ["pectoralis-major"],
    "secondary": ["triceps-brachii", "anterior-deltoid"],
    "equipment": ["barbell"],
    "instructions": "Lie on a flat bench…"
  }
]
```

10. Write `src/domain/catalogue/wger-exercises.json`, `ATTRIBUTION.md`, and a console summary:
    total fetched, kept, dropped by reason, unmapped muscles/equipment, duplicate names.
11. Optional `--server-out <path>` writes the same JSON for Stage 7's relay catalogue copy.

Licensing tasks:

- Check the license shown by wger for the exercise data at build time; record the exact name, URL
  and retrieval date in `ATTRIBUTION.md`.
- Include attribution in Settings > About and in the README.
- Do not bundle images. Do not scrape beyond the documented API.

The generated JSON is committed. `pnpm build` never touches the network.

## 5. Catalogue loader and search

`wger.ts`:

- Dynamic `import('./wger-exercises.json')` so the catalogue is a separate chunk, loaded on first
  use and cached in module scope.
- Map rows to `Exercise` with `id: 'wger:' + wgerId`, `source: 'wger'`, `createdAt: null`.
- Build normalized-name and alias indexes once.
- `loadCatalogue(): Promise<Exercise[]>` merges seeded rows with custom rows passed in by the store.
- `searchExercises(exercises, { query, muscle, equipment, category, limit })`:
  - Normalize query: lower-case, NFD, strip diacritics, collapse whitespace and punctuation.
  - Rank exact > starts-with > word-start > contains; alias matches rank just below name matches.
  - Filter by muscle (primary or secondary), equipment and category.
  - Stable alphabetical tie-break; default limit 50.
- `getExerciseById(exercises, id)`.

Custom exercises are loaded from IndexedDB by the store and merged into the in-memory list. The
seeded list itself is never written to IndexedDB.

## 6. Store surface for this stage

`TaskerProvider` becomes `TrainerProvider`. One context is fine; keep refs for async actions as the
current store does.

State:

```ts
{
  ready: boolean;
  routines: Routine[];
  sessions: Session[];
  customExercises: Exercise[];
  settings: Settings;
  error: string | null;
}
```

Actions in Stage 3:

```ts
updateSettings(patch: Partial<Settings>): Promise<void>;

createRoutine(input: RoutineInput): Promise<Routine>;
updateRoutine(id: string, patch: RoutinePatch): Promise<void>;
deleteRoutine(id: string): Promise<void>;
setActiveRoutine(id: string): Promise<void>;   // one transaction

createCustomExercise(input: CustomExerciseInput): Promise<Exercise>;
updateCustomExercise(id: string, patch: CustomExercisePatch): Promise<void>;
deleteCustomExercise(id: string): Promise<void>;

buildBackup(): BackupFile;
restoreBackup(file: unknown): Promise<void>;
resetEverything(): Promise<void>;

// Stage 5 fills these in:
ensureTodaySession(): Promise<void>;
```

Session actions are declared and stubbed only if Stage 5 follows immediately; prefer leaving them
out to avoid dead API. The store must expose `sessions` read-only now.

Theme migration: on first boot, if no `settings` row and `localStorage['trainer.theme']` is valid,
use it; then delete the temporary key.

All writes:

1. Normalize.
2. Write to IndexedDB.
3. Update React state from the normalized record.
4. (Stage 7) enqueue outbox. The outbox hooks exist but are not called yet.

## 7. Custom exercises

- Accessible from Settings > Exercises and from the exercise picker (Stage 5).
- Fields: name, category, primary muscles (at least one), secondary muscles (optional, must not
  overlap primary), equipment (optional), instructions (optional, ≤ 1200 chars), aliases (optional,
  comma-separated, ≤ 5).
- Name 2–80 characters. Reject a case/punctuation-insensitive duplicate of any catalogue name to
  keep name resolution unambiguous. Show the conflicting exercise.
- `source: 'custom'`, UUID id, `createdAt` set.
- Editing preserves the id. Sessions keep snapshots, so renames do not alter history.
- Deleting requires confirmation; sessions keep snapshots.

## 8. Backup and restore

Export:

- `buildBackup()` returns `BackupFile` v1 with routines, sessions, custom exercises and settings.
- Seeded catalogue is not included.
- File name: `trainer-backup-YYYY-MM-DD.json`, pretty-printed.
- Download via Blob + temporary anchor. No server.

Import:

- Accept a JSON file up to 10 MB.
- Parse and validate: `app === 'trainer'`, integer `version === 1`, arrays present, settings object.
- Normalize every record; report counts before replacing.
- Replace all rows in one readwrite transaction across the four stores, then reload the snapshot.
- Reject if sync is configured/connected (Stage 7 keeps this rule), with a clear message to
  disconnect first.
- Reject newer versions with "This backup was made by a newer Trainer."
- Never merge. Import is replace-only; the confirmation names the counts being replaced.

Reset:

- "Delete all Trainer data" requires typing `DELETE`.
- Closes the DB, calls `indexedDB.deleteDatabase('trainer')`, clears sync-related localStorage keys,
  reloads.
- Never touches `tasker`.

## 9. Settings view

Sections in this stage:

1. **Appearance** — light/dark.
2. **Training** — sound and haptics toggles (used when logging sets in Stage 5).
3. **Exercises** — custom exercise list, create/edit/delete.
4. **Data** — export, import, reset, storage persistence status, record counts.
5. **About** — version, offline/PWA note, catalogue attribution and license link.

Sync and API sections arrive in Stage 7. Notifications do not exist.

## 10. Verification checklist

```bash
pnpm build
pnpm typecheck
```

- [ ] Fresh profile: `trainer` DB v1 is created with all stores and indexes; `tasker` stays absent
      or untouched.
- [ ] Settings persist across reload.
- [ ] Catalogue loads offline after first load and search returns sensible ranked results.
- [ ] Filter by muscle and equipment works; no result state is clear.
- [ ] Creating a custom exercise persists, appears in search, rejects duplicates.
- [ ] Renaming a custom exercise keeps its id.
- [ ] Export produces a file with `app: "trainer"`, `version: 1` and the expected counts.
- [ ] Importing that file round-trips routines, sessions and custom exercises.
- [ ] Importing a tasker backup is rejected.
- [ ] Reset removes only `trainer`.
- [ ] Legacy task domain files are deleted; no task strings in the UI.
- [ ] `pnpm build` has no unused-import or type errors.

## 11. Risks

| Risk | Mitigation |
|------|------------|
| wger API shape drift | Build script fails loudly; JSON is committed so app builds are stable |
| wger license ambiguity | Record exact terms in ATTRIBUTION; personal use; no image redistribution |
| Duplicate names break API resolution | Build-time dedupe; custom-name uniqueness check |
| Large catalogue chunk | Dynamic import; compact fields; no images |
| Sync stores created but unused | Documented; Stage 7 uses them without a DB upgrade |
| Theme migration loses preference | Read temporary localStorage key once, then delete |

## 12. Exit criteria

The app has a real Trainer data layer and a usable exercise catalogue. No task entity, parser,
progress or notification code remains. Stages 4 and 5 can build entirely on the store actions and
types defined here.
