You are an expert full-stack developer. Build **Trainer**, an end-to-end, production-ready,
local-first routine builder and workout logger. Follow the staged plan precisely, avoiding
placeholders, mock implementations, and shortcuts.

**Source of truth:** [`docs/stages/README.md`](docs/stages/README.md) and the numbered stage files
beside it. Read them in order before changing code. If this brief and the stage plan disagree, the
stage plan wins. Do not reopen decisions the README marks as locked.

## Product

Trainer owns the routine and the log. The user defines a repeating cycle of weeks and weekdays,
where each slot is either a workout with a focus label (Push, Pull, Legs, Upper, Lower…) or rest.
An external n8n workflow reads a compact training report and writes today's planned session
(exercises, target sets, target rep ranges) through an authenticated API. The user trains and logs
the weight and reps of every set. PRs, muscle volume, adherence and history are derived from those
logs.

The loop is: **routine → scheduled slot → generated session → logged sets → derived history →
next generated session.**

There is no account system, no in-app LLM, and no AI provider key in the app.

## Source of truth and stage workflow

- `docs/stages/README.md` defines the product, glossary, invariants and decisions.
- Stages: 01 design/contract, 02 rebrand/strip, 03 domain/catalogue, 04 routine builder,
  05 today/logging, 06 progress/reports, 07 relay API/n8n, 08 MCP/manual/polish.
- Implement stages in order. Each stage must leave the app runnable and must not break an earlier
  stage's manual checklist.
- Stage 1 is design and contract only: `docs/design.md`, draft OpenAPI, context-report schema and
  the n8n contract. No product code in that stage.
- Every stage ends with the same gate:
  ```bash
  pnpm typecheck
  pnpm build
  ```
  Then run that stage's manual checklist in a desktop browser and a narrow mobile viewport. The
  checklists are the acceptance tests; the repository policy forbids extensive automated tests.
- Intermediate stages may show honest empty states ("No routine yet", "Plan not generated yet") but
  never fake data or dead controls.
- The current repository is the legacy Tasker todo app. Stage 2 rebrands and strips it; Stage 3
  replaces the task domain. Do not build new task features while the transition is in progress.

## Design system

Incorporate a clean Nordic aesthetic: crisp typography, generous functional whitespace, and
high-contrast readable states. Palette and type scale come from `DESIGN.Md` (ice blue/slate accents,
cool gray surfaces). Add semantic tokens only where needed: `--success` (completed), `--warning`
(plan pending), `--danger` (skipped/error), `--rest`.

- **Desktop:** cohesive left rail with Today, Routine, Progress, History, Settings. Rail collapses to
  icons below 1100px. One primary action per state. No floating action button.
- **Mobile:** bottom tab bar with Today, Routine, Progress, More. Creation, pickers and detail panels
  use a swipe-to-close bottom sheet in the thumb zone. Touch targets at least 44×44px; respect safe
  areas. No horizontal page scroll.
- Weights, reps, volume and PRs use tabular numerals. Status is never signalled by colour alone.
- Charts are pure accessible SVG (`role="img"`, labels, table fallback). No chart library.
- Reuse `BottomSheet` and the existing primitives. Keep `prefers-reduced-motion` support.

## Architecture and runtime

- **Frontend:** TypeScript SPA using React 18, Vite 6 and pnpm. It deploys to Vercel as static
  files. `vercel.json` is the SPA rewrite plus service-worker/manifest/asset headers — no Vercel
  functions and no cron.
- **Environment:** Vite modes and build-time defines (`__APP_VERSION__`, `__APP_MODE__`,
  `__BUILD_TIME__`). Keep `vite.config.ts` as the build pipeline configuration; no server-side
  configuration is required for the SPA.
- **Data:** single-user, local-first. All routines, sessions, custom exercises and settings live in
  IndexedDB database `trainer` (schema v1). Never open, migrate or delete Tasker's `tasker` database.
  Every user action writes locally first; no screen waits on the network.
- **PWA:** installable, custom `public/sw.js` with shell precache and runtime caching, cache names
  `trainer-*`. Trainer has **no push notifications and no reminder engine**. Remove the legacy ntfy
  and web-push code; no notification permission prompt.
- **Relay:** a self-hosted Express + SQLite service in `server/`. It stores encrypted entities,
  provides `/api/v1/*` authenticated with `Authorization: Bearer <sync passphrase>`, serves the
  OpenAPI spec, and exposes a read-only `/mcp`. It decrypts in memory to build reports and validate
  writes; this trust trade-off is accepted. TLS is mandatory.
- **AI:** n8n calls the relay, never IndexedDB. The app receives generated plans through normal sync
  and keeps the last known plan offline.
- **Portability:** JSON export/import of the full Trainer state in Settings, plus reset. Import is
  replace-only and blocked while sync is connected.

## Domain rules to preserve

- Dates are local calendar strings (`YYYY-MM-DD`), never `toISOString()` for "today". ISO weekdays
  are 1 (Monday) through 7 (Sunday).
- A routine is a cycle of `weekCount × 7` slots with a start date. Cycles are 1–12 weeks. Exactly one
  routine is active at a time, enforced in one transaction.
- Routine slots own only focus/rest and a note. The AI composes exercises per session.
- Sessions snapshot routine name, focus, week index, exercise name and muscles at creation. Editing
  the catalogue or routine never rewrites history.
- Only scheduled workout days create sessions. Rest days never do. Missing scheduled days in the
  last 13 days are backfilled as `skipped`; unfinished planned past sessions become `skipped`.
- A session is editable only while its date is today and it is not skipped. Completion is terminal
  at midnight; history is read-only.
- Weight is kilograms (number, 0 for bodyweight, 2 decimals max); reps are integers 1–999. The AI
  prescribes sets and rep ranges only, never weight.
- Derived data is never stored: PRs, volume, adherence and streaks are computed from sessions.
  - PR = heaviest weight for a given rep count, earliest date on a tie. Bodyweight sets are excluded.
  - Volume = `weight × reps`; primary muscles get full credit, secondary muscles half.
  - Adherence = completed / (completed + skipped) for scheduled workout days; rest and ad-hoc
    sessions are excluded from the rate.
- The AI cannot invent exercises. API writes use a catalogue id or a resolved exact name; unknown
  or ambiguous names are rejected (`422` / `409`). Seeded catalogue ids are `wger:<id>`.
- The app never prescribes or generates a routine automatically in v1.

## Structural boundaries

- Pure rules live in `src/domain/*`; storage in `src/db`; React state in `src/state`; sync in
  `src/sync`; views in `src/views`; shared UI in `src/components`; catalogue data in
  `src/domain/catalogue`.
- Server domain rules live in `server/src/trainer/*`, encrypted-space access in `server/src/space/*`,
  API routing in `server/src/api/*`.
- **STRICTLY FORBIDDEN:** do not create a separate shared function library, generic `utils.ts` or
  cross-cutting helper package. Code lives inside its structural domain. Client and server duplicate
  domain rules deliberately because the server cannot import browser code; keep them in parity using
  the Stage 7 checklist.
- **STRICTLY FORBIDDEN:** do not write extensive unit, integration or E2E tests. Focus on clean,
  production-grade application code.
- **KEEP IT SIMPLE:** avoid overengineering. Optimise for maintenance, readable code paths and
  performant UI updates. No new runtime dependency without a written reason. Charts are SVG, dates
  use `Intl` and local date strings, icons use the existing `react-icons`.

## Key commands

```bash
pnpm dev             # Vite dev server
pnpm typecheck       # app + config type check
pnpm build           # type check + production build
pnpm preview         # preview the production build

cd server
pnpm dev             # relay dev server
pnpm typecheck
pnpm build
pnpm start
```

Stage 3 adds `node scripts/build-exercises.mjs` for the committed wger catalogue. Builds never fetch
the network; the generated JSON is committed.

## Required deliverables

1. Complete, functional code for the frontend, custom service worker, relay API, MCP endpoint and
   deployment configuration (`vercel.json`, `server/Dockerfile`).
2. `docs/design.md`, `docs/api/openapi.json`, `docs/ai/context-report.schema.json` and the n8n
   workflow documentation.
3. `USER_MANUAL.md` and the in-app manual (`src/docs/UserManual.tsx`), kept in sync. The manual must
   cover: what Trainer is; install/offline; building a routine; Today statuses; logging sets and
   bodyweight 0; missed days; exact progress definitions; read-only history; exercise catalogue and
   custom exercises; AI/relay/n8n setup and security warning; backup, import and reset; settings;
   keyboard shortcuts; troubleshooting; data/privacy; wger attribution.

## Explicitly out of scope for v1

Do not build: bodyweight load tracking and bodyweight volume, lb/kg toggle, RPE, tempo, rest timers,
exercise images/videos, AI-authored routines, in-app LLM chat, push/email reminders, separate
revocable API tokens, multi-user spaces or sharing, Apple Health/Google Fit import, cardio and
heart-rate tracking, drag-and-drop routine editing.
