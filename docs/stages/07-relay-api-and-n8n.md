# Stage 7 — Relay API and n8n

**Goal:** the relay becomes the meeting point between Trainer and the morning AI workflow. The app
syncs new entity types, n8n reads a compact report, and a generated session plan lands in the app.

**Depends on:** Stages 1, 3, 5, 6.
**Produces:** Trainer entity sync, passphrase-authenticated `/api/v1`, context report, session
upsert, OpenAPI JSON, n8n workflow documentation, relay deployment notes.

This is the highest-risk stage. Build it in four phases and do not start Phase D until A–C pass.

---

## Phase A — Sync for Trainer entities

### A1. Entity kinds

Replace the task-era kinds in `src/sync/types.ts` and `server/src/db.ts`:

```ts
export type EntityKind = 'routine' | 'session' | 'exercise' | 'settings';
```

- `exercise` means **custom exercises only**. Seeded catalogue rows are code, not synced data.
- Keep `settings` as one record id `'app'`.
- Server `ENTITY_TYPES` must match exactly.
- Old task/category/project/place entities remain in existing SQLite files but are ignored. Do not
  delete them automatically.

### A2. Client engine

Recreate `src/sync/types.ts`, `recorder.ts`, `engine.ts` (the task versions are deleted in Stage 3;
use git history and the existing relay protocol as reference).

Keep unchanged:

- `src/sync/crypto.ts` (PBKDF2, AES-GCM, auth key derivation).
- `src/sync/hlc.ts`.

Recorder:

- Map stores to kinds: `routines → routine`, `sessions → session`, `exercises → exercise`,
  `settings → settings`.
- `entityPayload(kind, value)` returns the normalized record.
- Every user mutation enqueues an outbox record. Reuse the existing IndexedDB mutation listener or
  call a `recordChange` helper from the store after a successful write. Do not double-record.
- `writeEntitySilently` applies remote changes without enqueueing.

Engine merge rules:

| Kind | Rule |
|------|------|
| `routine` | Later HLC wins. Then enforce one active routine locally. |
| `session` | Later HLC wins, with terminal-status protection (below). |
| `exercise` | Later HLC wins; tombstones delete. |
| `settings` | Later HLC wins, field-wise settings are whole-record. |

Session merge protection:

1. If local is `completed` or `skipped` and remote is `planned`, keep the local terminal status and
   local sets. Apply nothing from the remote planned payload.
2. If remote is `completed` or `skipped`, apply it even if local has newer set edits; a terminal
   record is authoritative. This is the single-user trade-off.
3. If both are `planned`, apply the later payload. The API guard prevents a plan from replacing a
   session with logged sets, so a planned payload with sets should not normally exist remotely.
4. If both are terminal, later `updatedAt`/HLC wins.

After applying a routine batch, run `normalizeActiveRoutines()`: if several are active, keep the one
with the latest HLC/`updatedAt`, deactivate the others, and enqueue those changes.

Outbox and cursor behavior, snapshots/tombstones, client id, HLC, retry/backoff, auto-sync interval
and visibility sync follow the existing engine. Reuse its proven structure; do not redesign the
protocol.

### A3. Sync UI

Settings > Sync:

- Relay URL, passphrase, Connect / Disconnect, device name.
- Status: off, idle, syncing, error; pending count; last sync time; fingerprint.
- Warning: the passphrase also authorizes the AI API. Use a long random value.
- "Copy API setup" block: relay URL, `Authorization: Bearer` instructions, link to
  `/api/v1/openapi.json`.
- Disconnect stops sync but keeps local data.
- Changing the passphrase requires disconnect + reconnect; explain that it is a different space.

Session changes made by the API arrive through normal sync. The app does not poll `/api/v1`.

### A4. Sync verification

- Two browsers, same passphrase: create a routine in A, activate in B, log a session in B, see it in
  A.
- Complete in A while B is offline with a planned edit; reconnect; terminal completion wins.
- Delete a custom exercise; the tombstone propagates; sessions keep snapshots.
- Import/export still blocked while sync is connected.

---

## Phase B — Relay space and API foundation

### B1. Extract the space module

The current MCP code (`server/src/mcp/{crypto,hlc,space}.ts`) already decrypts entities and writes
encrypted changes. Extract the reusable domain:

```
server/src/space/crypto.ts     moved from mcp/crypto.ts
server/src/space/hlc.ts        moved from mcp/hlc.ts
server/src/space/store.ts      open space, decrypt entities, read/write entities
server/src/trainer/types.ts    server-side trainer records (duplicated intentionally)
server/src/trainer/normalize.ts
server/src/trainer/metrics.ts
server/src/trainer/catalogue.ts
```

- `store.ts` exposes `openSpace(keys, user)`, `entitiesByKind`, `findSessionByDate`,
  `readRoutine`, `readCustomExercises`, `writeEncryptedEntity(kind, id, payload)`.
- Writing uses the space's HLC clock and `pushChanges`, exactly like the MCP peer, so clients merge
  it normally.
- Both `/api/v1` and `/mcp` use this module. Tool-specific shaping stays in each surface.
- No generic `utils.ts`. Normalization and metrics live in `trainer/`.

This duplicates client rules in the server domain. That is deliberate: the server deployable cannot
import browser code, and the repository forbids a shared utility package. Keep the parity checklist
in section F.

### B2. API auth

`server/src/api/auth.ts`:

- Read `Authorization: Bearer <passphrase>`.
- Reject missing/short keys (min 8 chars) with `401`.
- Derive keys with the existing `keysFor(passphrase)`; `findUser(authKeyHash(keys.authKey))`.
  Unknown space → `401 unknown_sync_space`.
- Cache derived keys in memory for 10 minutes keyed by SHA-256 of the passphrase, capped at 50
  entries. Never log the passphrase or derived keys.
- Rate limit per space and per IP: 120 requests/minute; derive operations capped at 20/minute.
- Do not allow browser origins on `/api/v1` except an explicit `API_CORS_ORIGINS` (default empty;
  n8n is server-to-server). Keep the existing sync/MCP CORS behavior separate.
- Body limit 256 KB for API routes.
- Error shape: `{ error: string, message: string, details?: unknown }`.

### B3. Express wiring

In `server/src/index.ts`:

```
app.use('/api/v1', apiRouter)
app.get('/api/v1/openapi.json', ...)   // public, no auth
```

Keep `/v1/sync/*`, `/health`, `/mcp`. Update `/health` to report `service: 'trainer-sync'` and
`api: true`.

`TRAINER_TIMEZONE` (IANA, default `UTC`) resolves "today" for GET defaults and PUT date validation.
Use `Intl.DateTimeFormat('en-CA', { timeZone })` to get `YYYY-MM-DD`; do not add a date library.

---

## Phase C — Endpoints

### C1. `GET /api/v1/context?date=YYYY-MM-DD`

Default date = today in `TRAINER_TIMEZONE`.

Response: exactly the Stage 1 shape.

Builder steps:

1. Open the space; decrypt routines, sessions, custom exercises, settings.
2. Pick the active routine (latest `updatedAt` if more than one).
3. Resolve the slot for the date. If no active routine, `routine: null`.
4. Recent sessions: last 6 completed/skipped matching the focus (trimmed, case-insensitive);
   fallback to the last 6 completed/skipped overall.
5. Exercise stats: for exercises present in those sessions, last performance, PRs, volume trend
   (last 3 occurrences), cap 20.
6. Candidate exercises: union of exercises in recent same-focus sessions and exercises sharing their
   primary muscles, plus a focus heuristic:
   - push/chest/shoulders/triceps → chest, shoulders, arms
   - pull/back/biceps → back, arms
   - legs/lower → legs, calves
   - upper → chest, back, shoulders, arms
   - full/body → all categories
   Merge custom exercises; cap 40; dedupe; include id, name, primary, secondary, equipment.
7. Muscle volume for the last 8 ISO weeks using the Stage 1 rule.
8. Adherence for the last 8 weeks using the Stage 6 rule.

Hard caps protect the token budget. If there is no history, `recentSessions` and `exerciseStats` are
empty and candidates come from the focus heuristic.

### C2. Read endpoints

| Endpoint | Response |
|----------|----------|
| `GET /routines` | `{ routines: Routine[] }`, active first |
| `GET /exercises?query=&muscle=&equipment=&category=&limit=` | `{ exercises: CompactExercise[] }`, limit ≤ 100, default 50 |
| `GET /sessions?from=&to=&status=&focus=&limit=` | `{ sessions: Session[] }`, default last 30 days, limit ≤ 200 |
| `GET /prs?exerciseId=` | `{ prs: PrEntry[] }`; all exercises when omitted |
| `GET /muscles/volume?weeks=` | `{ weeks: MuscleWeek[] }`, weeks 1–52, default 12 |

- All dates validated.
- 404 for an unknown `exerciseId` on `/prs` is not needed; return an empty list.
- Sessions include full sets; this is the AI/debug surface. It is not used by the app.

### C3. `PUT /api/v1/sessions/{date}`

Request as in Stage 1.

Order of checks:

1. Auth → 401.
2. Valid date → 400.
3. Date within today ±1 day in `TRAINER_TIMEZONE` → 400 `date_out_of_range`.
4. Body shape → 400 with field details.
5. Resolve the active routine and slot. No active routine or rest day → 409 `no_scheduled_workout`.
6. Find an existing session for the date.
   - completed or skipped → 409 `session_closed`.
   - any set with reps > 0 → 409 `session_in_progress`.
   - manual ad-hoc → 409 `manual_session`.
7. Resolve exercises:
   - `exerciseId` must exist in the catalogue or custom exercises → 422 `unknown_exercise`.
   - `name` normalized; exact unique match required; none → 422; multiple → 409
     `ambiguous_exercise` with up to 5 candidates.
8. Build the session:
   - Reuse the existing id, `createdAt`, routine snapshots.
   - Set `source: 'ai'`, `focus` from the body or the slot, `status: 'planned'`, exercises in order.
   - Snapshot name and muscles from the catalogue.
   - `updatedAt = now`, clear `completedAt`/`skippedAt` (should already be null).
9. Encrypt and write with a fresh HLC; return the full session.

If no session record exists for a scheduled date (n8n ran before the app created it), create one
from the slot with `source: 'ai'`. The app will merge it by date.

Validation limits: 30 exercises, sets 1–12, reps 1–50, note ≤ 500, session notes ≤ 2000.

### C4. OpenAPI

- Canonical file: `server/openapi.json`, copied from the Stage 1 draft and kept current.
- Served raw at `/api/v1/openapi.json` with `Cache-Control: public, max-age=300`.
- OpenAPI 3.1, `BearerAuth`, examples for every endpoint, error schema, and the exact context
  response.
- The spec is the n8n contract. If the response changes, bump a `version` field in the context
  payload and document it.

### C5. Error handling

- Central JSON error middleware; never return HTML.
- Log request id, method, path, status and duration. Never log bodies, keys or decrypted payloads.
- `500` returns `{ error: 'internal' }` with no stack.
- Unknown routes under `/api/v1` → 404 JSON.

---

## Phase D — n8n and deployment

### D1. n8n workflow

Document in `docs/ai/n8n-workflow.md`:

1. **Schedule Trigger** — 06:00 in `TRAINER_TIMEZONE` (or the user's gym timezone).
2. **HTTP Request: context** — GET `/api/v1/context`, Header Auth credential with the passphrase.
3. **Code: prompt** — verify the report, format a compact prompt with recent sessions, PRs,
   candidates and the focus.
4. **LLM** — system rules:
   - Choose 3–8 exercises only from `candidates` ids.
   - Match today's focus and cover its primary muscles.
   - Use target sets 2–5 and rep ranges 5–15, narrower for compounds.
   - Progress from last performance: add reps before load; never prescribe weight.
   - Vary exercises from the last same-focus session; keep one or two anchors.
   - Return JSON only.
5. **Code: validate** — parse JSON, reject unknown ids, clamp ranges, drop duplicates, cap 8.
6. **HTTP Request: put** — PUT `/api/v1/sessions/{date}` with the plan.
7. **Error branch** — send the error to an n8n notification workflow. Do not retry a 409.
8. **Dry run** — use a pinned context fixture and a staging relay before enabling the schedule.

Include a sample system prompt and a sample request/response in the doc. The prompt must not include
the full catalogue or the user's passphrase.

### D2. Deployment

- `server/Dockerfile` exists; verify it builds the new files.
- Env:
  - `PORT` (default 8787)
  - `DB_PATH` (default `data/trainer.db`; existing deployments keep their path)
  - `TRAINER_TIMEZONE`
  - `SYNC_RETENTION_DAYS`
  - `MCP_ENABLED`
  - `CORS_ORIGINS` (the SPA origin)
  - `API_CORS_ORIGINS` (empty by default)
- Persist the SQLite volume. Document a backup command using `sqlite3 ... ".backup"` or a WAL-safe
  file copy with the service stopped.
- TLS reverse proxy is required. Do not expose plain HTTP.
- The SPA remains static on Vercel; no Vercel functions and no cron. `vercel.json` is unchanged.
- The relay serves the OpenAPI spec; the app links to it.

### D3. Operational checks

```bash
# health
curl -s https://relay.example/health

# context
curl -s -H "Authorization: Bearer $TRAINER_KEY" \
  "https://relay.example/api/v1/context?date=2026-11-16" | jq

# plan
curl -s -X PUT -H "Authorization: Bearer $TRAINER_KEY" \
  -H "Content-Type: application/json" \
  -d '{"exercises":[{"exerciseId":"wger:192","targetSets":4,"targetRepMin":6,"targetRepMax":8}]}' \
  "https://relay.example/api/v1/sessions/2026-11-16" | jq

# unknown exercise -> 422
# completed session -> 409
```

---

## Phase E — Parity checklist (client vs server)

The same rules exist in two places. Before closing this stage, compare them line by line:

- [ ] Muscle ids and the 18-group list are identical.
- [ ] Volume split: primary full/split, secondary half/split, fallback when no primary.
- [ ] PR key `(exerciseId, reps)`, max weight, earliest tie date.
- [ ] Adherence excludes rest and ad-hoc, rate denominator completed+skipped.
- [ ] Session normalization: status/source enums, targets, set bounds, order.
- [ ] Routine normalization: slot count, week count, active flag.
- [ ] Date anchors: Monday cycle start, local dates, ISO week keys.
- [ ] Catalogue ids `wger:<id>` and dedupe/name normalization.
- [ ] Name resolution rejects unknown and ambiguous names.
- [ ] Bodyweight weight 0 excluded from PR/volume.

Use one fixture session set and compare the API report with the in-app Progress numbers. Record the
results in the PR description or a short `docs/stages/07-parity.md` note. No automated test suite.

---

## Files

Create:

```
server/src/api/index.ts          router wiring
server/src/api/auth.ts           passphrase auth, cache, rate limit
server/src/api/context.ts        report builder
server/src/api/sessions.ts       GET range + PUT by date
server/src/api/catalogue.ts      exercise search
server/src/api/metrics.ts        PRs + muscle volume routes
server/src/api/openapi.ts        serve server/openapi.json
server/src/space/crypto.ts       moved
server/src/space/hlc.ts          moved
server/src/space/store.ts        decrypt/read/write entities
server/src/trainer/types.ts
server/src/trainer/normalize.ts
server/src/trainer/metrics.ts
server/src/trainer/catalogue.ts
server/openapi.json
docs/ai/n8n-workflow.md
```

Update:

```
server/src/index.ts              mount API, health, CORS, limits
server/src/db.ts                 ENTITY_TYPES
server/src/mcp/*                 use space module (tools rewritten in Stage 8)
src/sync/types.ts                new EntityKind
src/sync/recorder.ts             new kinds
src/sync/engine.ts               new merge rules
src/db/database.ts               outbox recording for new kinds
src/state/store.tsx              enqueue changes
src/views/SettingsView.tsx       sync + API setup
src/App.tsx                      sync bootstrap/status
```

## Verification checklist

```bash
pnpm typecheck
pnpm build
cd server && pnpm build   # or the server's documented build command
```

- [ ] Client and server entity types match; push/pull round-trips all four kinds.
- [ ] A routine created offline syncs and activates on the second device.
- [ ] Custom exercises sync; seeded catalogue does not.
- [ ] `/context` returns a compact report under ~15 KB for 8 weeks of data.
- [ ] Context includes the correct focus, recent same-focus sessions, PRs and candidates.
- [ ] PUT creates a plan; the app receives it and shows exercises with targets.
- [ ] PUT after a set is logged returns 409 and the app keeps the logged set.
- [ ] PUT on a rest day returns 409.
- [ ] Unknown/ambiguous name returns 422/409 with candidates.
- [ ] Completed session cannot be overwritten.
- [ ] OpenAPI is valid and served without auth.
- [ ] n8n dry run writes a plan that the app displays after sync.
- [ ] Auth failures, rate limits and oversized bodies return JSON errors.
- [ ] Logs contain no passphrase, payload or plaintext.
- [ ] Offline app still loads; sync resumes on reconnect.

## Risks

| Risk | Mitigation |
|------|------------|
| Duplicated client/server rules drift | Parity checklist + shared fixture, reviewed each change |
| PBKDF2 cost per request | 10-minute in-memory key cache, derivation rate limit |
| Clock/timezone mismatch | Relay timezone env, explicit dates, ±1 day write window |
| n8n writes after training starts | Server rejects when sets exist; client merge guard |
| Sync overwrites terminal sessions | Terminal-status protection; tests via manual two-device flow |
| Context too large | Hard caps, candidates instead of full catalogue, compact fields |
| Passphrase exposure | Header auth, n8n credentials, TLS, no logging, long random key |
| SQLite corruption | WAL, backups, documented restore |

## Exit criteria

A morning n8n run can read the report, produce a plan, write it to the relay, and the app shows it
without any manual step. All logs remain local-first and syncable. Stage 8 can expose read-only MCP
and finish the product.
