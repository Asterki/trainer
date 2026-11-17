# Trainer — staged implementation plan

Status: **planning only**. No product code has been changed for Trainer yet.

This folder is the working plan for turning the existing Tasker todo app into **Trainer**, a
local-first routine builder and workout logger driven by an external AI workflow (n8n).

Read the stage files in order. Each one is written to be reviewable on its own and to leave the
app in a runnable state.

## Product in one paragraph

Trainer owns the routine and the log. You define a repeating cycle of weeks and weekdays, where
each slot is either a workout with a focus label (Push, Pull, Legs, Upper, Lower…) or rest. An AI
workflow reads a compact report of your training and writes today's planned session — exercises,
target sets, and target rep ranges — back through an authenticated API. You open the app, train,
and log the weight and reps of every set. Trainer derives PRs, muscle volume, adherence and history
from those logs. There is no in-app LLM and no account system.

## Stage map

| # | Stage | Main output | Depends on |
|---|-------|-------------|------------|
| 1 | [Design and contract](01-design-and-contract.md) | `docs/design.md`, draft OpenAPI, report schema, n8n contract | — |
| 2 | [Rebrand and strip](02-rebrand-and-strip.md) | Trainer shell, task features removed, new identity | 1 |
| 3 | [Domain and catalogue](03-domain-and-catalogue.md) | Trainer types, IndexedDB v1, exercise catalogue, backup | 1, 2 |
| 4 | [Routine builder](04-routine-builder.md) | N-week cycle editor, one active routine, cycle arithmetic | 3 |
| 5 | [Today and logging](05-today-and-logging.md) | Today status, session plans, per-set logging, auto-skip | 3, 4 |
| 6 | [Progress and reports](06-progress-and-reports.md) | PRs, muscle volume, adherence, history | 5 |
| 7 | [Relay API and n8n](07-relay-api-and-n8n.md) | Authenticated context + session API, OpenAPI, n8n flow | 1, 3, 5, 6 |
| 8 | [MCP, manual, polish](08-mcp-manual-polish.md) | Read-only MCP, user manual, final QA | all |

## Architecture at a glance

```
┌─────────────────────────────┐
│ Browser (Vercel static SPA) │
│                             │
│  React shell                │
│  IndexedDB `trainer`        │
│  Service worker (offline)   │
│  Sync client (encrypted)    │
└──────────────┬──────────────┘
               │ encrypted entity sync
┌──────────────▼──────────────┐        ┌──────────────────┐
│ Relay (self-hosted Express) │◄───────┤ n8n (morning)    │
│  SQLite + change log        │  HTTPS │  GET context     │
│  Passphrase-derived keys    │        │  LLM             │
│  /api/v1/*  (read + write)  │        │  PUT session     │
│  /mcp       (read-only)     │        └──────────────────┘
└─────────────────────────────┘
```

- The relay stores encrypted entities. Like the current MCP endpoint, the API decrypts in memory
  with the passphrase-derived key to build reports and validate writes. The relay is trusted.
- n8n never talks to IndexedDB. It talks to the relay. The app receives the generated plan through
  normal sync.
- Offline still works. The app keeps the last known plan and all logs locally.

## Glossary

| Term | Meaning |
|------|---------|
| **Exercise** | A movement in the catalogue (Bench Press, Squat). Has muscles and equipment. Never a machine record. |
| **Routine** | A cycle of `weekCount × 7` slots with a start date. One routine is active at a time. |
| **Slot** | One weekday in one week of a routine: `workout` with a focus label, or `rest`. Owns no exercises. |
| **Session** | One real calendar date. Planned, completed, or skipped. Holds the exercise plan and the actual set logs. |
| **Session exercise** | A snapshot of an exercise inside a session, with targets, note, and logged sets. |
| **Set log** | One performed set: weight in kg and reps. |
| **PR** | Heaviest weight ever lifted for a given rep count, per exercise. Derived. |
| **Volume** | `weight × reps` per set, credited to primary muscles in full and secondary muscles at half. Derived. |
| **Adherence** | Scheduled workouts versus completed and skipped sessions over a range. Derived. |
| **Context report** | The compact JSON the relay returns to n8n for the LLM. |
| **Cycle week** | `floor(daysSinceMondayOf(startDate) / 7) % weekCount`. Week 0 is the start week. |

## Invariants that every stage must preserve

1. **Local-first.** Every user action writes to IndexedDB first. No screen waits on the network.
2. **One active routine.** Activating a routine deactivates the others in one transaction.
3. **Snapshots protect history.** Sessions copy routine name, focus, week index, exercise name and
   muscles at creation. Editing the catalogue or routine never rewrites a past session.
4. **Past sessions are read-only.** A session may be edited only while its date is today and it is
   not skipped. Completion is terminal at midnight.
5. **Every scheduled day is accountable.** The client creates session records for scheduled workout
   days. Unfinished past days become `skipped`; rest days do not create sessions.
6. **Derived data is never stored.** PRs, volume, adherence and streaks are computed from sessions.
   There is no progress entity to migration or corrupt.
7. **The AI cannot invent exercises.** API writes reference a catalogue id or a resolved exact name.
   Unknown or ambiguous names are rejected.
8. **kg and reps only.** Weight is a number in kilograms; reps is an integer. Bodyweight logs `0`.
9. **No new runtime dependency without a written reason.** Charts are SVG, dates use `Intl` and
   local date strings, icons use the existing `react-icons`.
10. **Domain code lives in its domain.** No `utils.ts` or generic shared helper package. Pure rules
    live in `src/domain/*`; storage in `src/db`; sync in `src/sync`; server rules in `server/src/*`.

## Completion protocol for each stage

Every stage ends with the same gate:

```bash
pnpm typecheck
pnpm build
```

Then the stage's manual checklist, run in a desktop browser and a narrow mobile viewport. Because
the repository policy forbids extensive automated tests, the checklists are the acceptance tests.
A stage is not done if it breaks an earlier stage's checklist.

Intermediate stages may show honest empty states ("No routine yet", "Plan not generated yet"), but
must never show fake data or dead controls.

## Decisions locked before Stage 1

These came from the design conversation and are not reopened unless the plan review changes them.

- Routine slots own a focus/rest flag only. The AI composes the exercise list per session.
- One active routine. Cycles may be 1–12 weeks; weekdays are real weekdays.
- Rep targets are ranges; sets are a count. Actual weight is logged per set.
- Muscle progress uses volume with primary full / secondary half.
- PR is heaviest weight for a given rep count.
- The catalogue is seeded from wger (text only) plus custom exercises. Machines are equipment.
- n8n handles AI. The app has no LLM calls and no API keys for model providers.
- The API is authenticated with the same sync passphrase used by the relay.
- Fresh database `trainer`. Tasker's `tasker` database is left untouched.
- No notifications/reminders in Trainer. Status is in-app. ntfy and web push are removed.

## Review checklist for this plan

Before implementation starts, confirm:

- [ ] Stage boundaries and order are right.
- [ ] The data model in Stage 1 is sufficient for every screen.
- [ ] The API contract in Stage 7 matches the intended n8n workflow.
- [ ] The 14-day backfill and auto-skip rules match how you want missed days recorded.
- [ ] The defaults in Stage 1 (kg, bodyweight, text-only catalogue, today-only editing) are accepted.
- [ ] Any stage should be split, merged, or deferred.
