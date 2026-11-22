# Trainer

Trainer is a local-first routine builder and workout logger. You define a repeating cycle of weeks
and weekdays; each slot is a workout focus (Push, Pull, Legs, Upper, Lower…) or rest. An external
n8n workflow reads a compact training report and writes today's planned session — exercises, target
sets and rep ranges — through an authenticated API. You train, log every set, and Trainer derives
personal records, muscle volume, adherence and history from those logs.

There is no account system and no in-app AI. Trainer is a TypeScript single-page application
deployed as static files, plus a self-hosted relay for encrypted sync and the AI contract.

---

## Stack

- React 18, TypeScript, Vite 6, pnpm. Plain CSS with Nordic design tokens, no UI framework.
- IndexedDB database `trainer` (schema v1). All routines, sessions, custom exercises and settings
  are local. Every action writes locally first; no screen waits on the network.
- Custom service worker (`public/sw.js`) for an installable, offline PWA.
- Relay: Express + SQLite in `server/`, storing encrypted entities and exposing `/api/v1/*` and a
  read-only MCP endpoint.
- Charts are hand-built accessible SVG; icons are `react-icons`.

## Commands

```bash
pnpm install
pnpm dev             # Vite dev server
pnpm typecheck       # app + config type check
pnpm build           # type check + production build
pnpm preview         # preview the production build
```

```bash
cd server
pnpm install
pnpm dev             # relay dev server
pnpm typecheck
pnpm build
pnpm start
```

Rebuilding the committed wger catalogue and exercise media is manual and needs network access plus
`ffmpeg` for GIF stills:

```bash
node scripts/build-exercises.mjs
node scripts/build-exercises.mjs --server-out ../server/src/trainer/catalogue/wger-exercises.json
```

Builds never fetch the network; the generated JSON and media are committed.

## The training loop

1. **Routine** — 1–12 weeks, seven slots per week, one active routine at a time. A slot owns only a
   focus/rest label and a note; the AI composes exercises per session.
2. **Scheduled slot** — local calendar dates (`YYYY-MM-DD`) and ISO weekdays (1 = Monday).
3. **Generated session** — snapshots routine name, focus, week index, exercise names and muscles at
   creation. Rest days never create sessions.
4. **Logged sets** — weight in kilograms (0 for bodyweight, two decimals) and integer reps 1–999.
   A session is editable only while its date is today and it is not skipped.
5. **Derived history** — PRs (heaviest weight per rep count, earliest date on a tie, bodyweight
   excluded), volume (weight × reps, primary muscles full credit, secondary half), adherence
   (completed ÷ completed + skipped for scheduled workout days) and streaks. Nothing derived is
   stored.
6. **Missed days** — scheduled workout days from the last 13 days are backfilled as `skipped`;
   unfinished planned past sessions also become `skipped`.

Sessions, custom exercises and settings export as a single JSON backup in Settings. Import is
replace-only and blocked while sync is connected.

## Sync and relay

The client encrypts each entity with a key derived from the sync passphrase (PBKDF2 + HKDF), then
pushes changes to the relay over TLS. The relay stores ciphertext and a per-entity HLC change log;
it never stores the passphrase. Clients merge by HLC on their next sync.

The relay also decrypts in memory with a `Bearer <sync passphrase>` request to build the training
report and validate AI writes. This trust trade-off is deliberate: the relay is yours, self-hosted,
and must be served over TLS.

### API

- `GET /health`
- `GET /api/v1/openapi.json` (public)
- `GET /api/v1/context?date=YYYY-MM-DD`
- `GET /api/v1/routines`
- `GET /api/v1/exercises?query=&muscle=&equipment=&category=&limit=`
- `GET /api/v1/sessions?from=&to=&status=&focus=&limit=`
- `PUT /api/v1/sessions/{date}`
- `GET /api/v1/prs?exerciseId=`
- `GET /api/v1/muscles/volume?weeks=`

All but the OpenAPI document require `Authorization: Bearer <sync passphrase>`. The full contract is
in [`server/openapi.json`](./server/openapi.json) and
[`docs/api/openapi.json`](./docs/api/openapi.json); the report shape is
[`docs/ai/context-report.schema.json`](./docs/ai/context-report.schema.json).

`PUT /api/v1/sessions/{date}` accepts a catalogue id or a resolved exact exercise name. Unknown
names return `422`, ambiguous names `409`, and completed/skipped sessions or sessions with logged
sets cannot be replaced. The AI prescribes sets and rep ranges only, never weight.

The n8n wiring, prompt and error branches are documented in
[`docs/ai/n8n-workflow.md`](./docs/ai/n8n-workflow.md).

### MCP

`POST /mcp` (Streamable HTTP) exposes read-only tools authenticated with the same passphrase:
`get_today`, `get_context`, `list_routines`, `get_routine`, `list_exercises`, `get_exercise`,
`list_sessions`, `get_session`, `get_exercise_history`, `get_prs`, `get_muscle_volume`,
`get_adherence`. There are no write tools. Set `MCP_ENABLED=false` to disable the endpoint.

## Deployment

### App (Vercel or any static host)

`pnpm build` writes `dist/`. [`vercel.json`](./vercel.json) supplies the SPA rewrite and the
service-worker, manifest, icon and exercise-media headers. There are no Vercel functions and no
cron. Any static host with the same rewrite (`/* → /index.html`) works.

Vite defines `__APP_VERSION__`, `__APP_MODE__` and `__BUILD_TIME__` at build time. The only client
environment variable is optional:

| Variable | Purpose |
| --- | --- |
| `VITE_SYNC_URL` | Default relay URL shown in the Sync card |

### Relay (Docker)

```bash
cd server
docker build -t trainer-relay .
docker run -d --name trainer-relay -p 8787:8787 \
  -v trainer-data:/data \
  -e CORS_ORIGINS=https://your-app.example \
  -e API_CORS_ORIGINS=https://your-n8n.example \
  trainer-relay
```

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8787` | HTTP port |
| `DB_PATH` | `/data/trainer.db` in Docker, `data/tasker.db` locally | SQLite file |
| `TRAINER_TIMEZONE` | `UTC` | Relay timezone for "today" in the API |
| `CORS_ORIGINS` | empty | Browser origins allowed to call sync |
| `API_CORS_ORIGINS` | empty | Browser origins allowed to call `/api/v1`; n8n is server-to-server |
| `MCP_ENABLED` | `true` | Exposes `POST /mcp` when not `false` |
| `MCP_ORIGINS` | empty | Browser origins allowed to call `/mcp` |
| `SYNC_RETENTION_DAYS` | `365` | Change-log retention |

TLS is mandatory. Terminate HTTPS in front of the relay (Caddy, nginx, Traefik, a platform proxy)
and never expose it over plain HTTP.

## Catalogue and media

The seeded catalogue is generated from [wger](https://wger.de/) and committed as
`src/domain/catalogue/wger-exercises.json` plus `public/exercise-media/`. Exercise text and media
are licensed CC BY-SA 4.0, CC BY-SA 3.0 or CC0 per record; every image keeps its author and license
in the catalogue row and in the app. The body diagram vendors MIT-licensed polygon data from
`@mjcdev/react-body-highlighter`. See
[`src/domain/catalogue/ATTRIBUTION.md`](./src/domain/catalogue/ATTRIBUTION.md).

## Documentation

- [`USER_MANUAL.md`](./USER_MANUAL.md) — the manual, mirrored inside the app.
- [`docs/design.md`](./docs/design.md) — product and design contract.
- [`docs/stages/`](./docs/stages/) — the staged implementation plan and acceptance checklists.
- [`docs/api/openapi.json`](./docs/api/openapi.json) — the API contract.
- [`docs/ai/`](./docs/ai/) — context report schema, n8n workflow and prompt.

## Data and privacy

Your routines, sessions and settings stay in your browser's IndexedDB unless you turn on sync, and
then they leave the device only encrypted, to the relay you configure. Reset in Settings deletes the
local `trainer` database; export a backup first. Trainer never opens or modifies the legacy `tasker`
database.
