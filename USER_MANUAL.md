# Trainer — User Manual

The in-app manual lives in `src/docs/UserManual.tsx`. The two files say the same thing: when you
change one, change the other.

## What Trainer is

Trainer is a personal routine builder and workout log. You plan a repeating cycle of weeks and
weekdays. Each slot is a workout focus — Push, Pull, Legs, Upper, Lower, whatever you call it — or
rest. On a scheduled workout day Trainer prepares a session. You log the weight and reps of every
set; Trainer derives personal records, volume, adherence and history from those logs.

Trainer has no account, no ads, no analytics and no in-app AI. Everything is stored in this browser
first. Sync and the AI plan are optional extras you host yourself.

## Install and offline use

- Open Trainer in a modern browser, then use the browser's **Install** action or **Add to Home
  Screen**. It behaves like an app and keeps working without a network.
- The first load caches the app shell. Exercise media is cached as you browse it.
- Without a connection you can still build routines, log sets and read history. When sync is on,
  changes queue locally and upload when you reconnect.
- The last plan you received stays visible offline. A plan is only fetched when your browser syncs
  with your relay.
- Updating the app takes effect when the new service worker activates; reload once if the version in
  Settings looks old.

## Building a routine

Open **Routine** in the rail (mobile: **Routine** tab).

1. Press **New routine**, give it a name, a start date and 1–12 weeks.
2. In the weekly grid, press a slot and choose **Workout** with a focus label, or **Rest**. A slot
   can carry a short note.
3. Use **Copy previous week** to repeat a week, **Clear week** to empty one, and the week controls to
   add or remove weeks.
4. Press **Activate**. Exactly one routine is active at a time; activating another retires the old
   one. The active routine drives everything on Today.

A routine slot owns only the focus/rest label and its note. It never lists exercises — those come
from the generated session or from you.

The grid works with the keyboard: Tab moves between slots, arrow keys move around the grid, Enter
opens the slot editor, Escape closes it.

## Today and its statuses

**Today** shows the date, your current streak, today's slot and session. The badge tells you what to
expect:

| Status | Meaning |
| --- | --- |
| **No routine** | Nothing is active. Build a routine, or log a one-off workout. |
| **Rest** / *Rest day* | Today's slot is rest. No session or history is created. |
| **Upcoming** / *Scheduled* | The active routine starts in the future. Nothing is created before the start date. |
| **No session today** | A scheduled workout that the app has not prepared yet. Use **Log a workout**. |
| **Plan pending** | The session exists but has no exercises yet. Add them yourself or wait for your n8n workflow. |
| **Planned** | Exercises and target sets are ready. |
| **In progress** | At least one set is logged. |
| **Completed** | Finished. Reopen on the same day if you need to fix something. |
| **Skipped** | The day passed without a completed session. Read-only. |

Sessions are created only for scheduled workout days. Rest days, days before the routine starts and
days outside the cycle never create sessions. You can still log an unscheduled workout with **Log a
workout**; it appears in History but not in adherence.

## Logging sets

Open Today, then:

1. Enter the weight in kilograms. `0` means bodyweight. Two decimals are allowed.
2. Enter the reps — a whole number from 1 to 999.
3. Press **Enter** or the check button to commit the set. The set appears in the exercise's list.
4. Use **Add set** to append another set, or copy the previous set's values.
5. Add a session note and a rating from 1 (drained) to 5 (fresh) if you want.
6. Press **Finish** when the workout is done.

Finishing with no sets asks for confirmation. A completed session is terminal at midnight: you can
reopen it during the same day, but after that it is history. Weight is stored in kilograms; if you
choose pounds in Settings, Trainer converts for display and input.

**Bodyweight sets** use `0` kg. They count as sets and reps, but contribute no volume and never
create a weight PR.

## Missed days

When you open Trainer, scheduled workout days from the last 13 days that have no completed session
are backfilled as **Skipped**. Planned sessions whose date has passed are also closed as skipped.
Skipped sessions are read-only and count against adherence.

Nothing is invented for gaps: a rest day stays rest, and days before a routine starts stay empty.

## Progress

**Progress** has three tabs: **Overview**, **Exercises** and **Muscles**. Everything is computed from
completed sessions; nothing is stored twice.

- **Personal record (PR)** — the heaviest weight you have logged for a given rep count. A tie goes to
  the earliest date. Bodyweight (`0` kg) sets are excluded. Each exercise and rep count has its own
  PR.
- **Volume** — weight × reps. Primary muscles receive full credit, secondary muscles half credit. A
  session's volume is the sum of its sets; weekly muscle volume groups sessions by ISO week.
- **Adherence** — completed ÷ (completed + skipped) for scheduled workout days in the selected
  weeks. Rest days and ad-hoc sessions are excluded. A week with no scheduled days has no rate.
- **Streak** — consecutive completed scheduled sessions, in date order. A skipped session resets the
  current streak; your best streak is kept.
- **Estimated 1RM** — a derived estimate from a top set, shown for context. It is not a PR.

Overview shows recent sessions, recent PRs, adherence, focus balance and milestones. Exercises shows
per-exercise trends and history. Muscles shows weekly volume per muscle group. Charts are SVG and
each one has a text/table equivalent for screen readers.

## History

**History** lists sessions newest first, grouped by month. Filter by focus, exercise or date range;
**Clear filters** resets them, and **Load more** extends the list. Open a session to see its
exercises, target sets, logged sets and notes.

History is read-only. Past and skipped sessions cannot be edited, and deleting a session is not
supported in v1.

## Exercise catalogue and custom exercises

The seeded catalogue comes from [wger](https://wger.de/) and contains strength and mobility
exercises with muscles, equipment, category, instructions, aliases and, where available, an image or
animation. Search it from the exercise picker or from **Settings → Exercises**.

Settings → Exercises lets you:

- search by text, muscle or equipment;
- create a **custom exercise** with a name, category, primary and secondary muscles, equipment,
  aliases and instructions;
- edit or delete custom exercises. Deleting requires typing `DELETE` in the confirmation field.

Seeded exercises cannot be edited. Custom exercises are stored in this browser and are included in
sync and backups. Sessions snapshot exercise names and muscles, so editing or deleting a catalogue
entry never rewrites an old session.

## AI plan, relay and n8n

Trainer itself never calls an AI and holds no provider key. The optional loop is:

1. You run the relay (`server/`) over HTTPS with your own domain.
2. In **Settings → Sync**, enter the relay URL and a passphrase of at least 8 characters, then
   connect. The relay stores only encrypted entities.
3. Your n8n workflow reads `GET /api/v1/context`, asks your model for exercises and target sets, and
   writes `PUT /api/v1/sessions/{date}` with `Authorization: Bearer <passphrase>`.
4. The plan arrives on your devices through normal encrypted sync.

The AI prescribes exercises, sets and rep ranges only — never weight. Writes use a catalogue id or an
exact resolved name. Unknown names are rejected with `422`, ambiguous names with `409`, and an
existing completed/skipped session or one with logged sets cannot be overwritten. The plan appears as
**Plan pending** until it has exercises, and you can always edit it on the day.

Setup details: [`docs/ai/n8n-workflow.md`](docs/ai/n8n-workflow.md), the API contract in
[`docs/api/openapi.json`](docs/api/openapi.json), and **Copy API setup** in the Sync card.

> **Security warning.** Your passphrase derives the encryption key *and* authenticates the API. Anyone
> who has it can read and write your training space. Never put it in an n8n node, workflow JSON, a
> prompt, a log or a notification — store it in an n8n **Header Auth** credential. Serve the relay
> over TLS only; plain HTTP exposes the passphrase to the network. Self-hosting means you own
> backups, updates and access control of the relay.

## Backup, import and reset

**Settings → Data** shows counts and storage status.

- **Export backup** downloads one JSON file with routines, sessions, custom exercises and settings.
  The seeded catalogue is not included.
- **Import backup** replaces everything in this browser with the file's contents. It is blocked
  while sync is connected; disconnect first.
- **Delete all Trainer data** removes the local `trainer` database after you type `DELETE`. Export
  first — this cannot be undone.

If sync is connected, backups are still the safest way to keep a copy outside the relay.

## Settings

- **Appearance** — theme (Nordic light/dark/system), interface sound, haptics.
- **Training** — weight unit for display and input (kg/lb).
- **Body** — height in centimetres and body weight.
- **Exercises** — catalogue search and custom exercise management.
- **Sync** — relay URL, passphrase, connect/disconnect, relay and device status, pending changes,
  last sync, space fingerprint, copy API setup.
- **Data** — counts, export, import, reset.
- **About** — version, storage, catalogue/licence credits and the wger link.

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| `1` | Today |
| `2` | Routine |
| `3` | Progress |
| `4` | History |
| `5` | Settings |
| `Esc` | Close a sheet, dialog or overlay |
| `Enter` | Commit the set you are editing |
| Arrow keys | Move between routine slots |

Shortcuts are ignored while you type in an input.

## Troubleshooting

- **Sync will not connect** — check the relay URL is HTTPS and reachable, the passphrase has at least
  8 characters and matches the one used on your other device. A brand-new passphrase creates a new,
  empty space; use the same one everywhere.
- **Changes stay pending** — the relay is offline or the browser is offline. They upload on the next
  successful sync; nothing is lost.
- **Plan stays pending** — the n8n workflow has not written today's session. Check its run history
  and the relay's `/health`.
- **A plan was rejected** — the AI used a name Trainer cannot resolve. Return a catalogue id or an
  exact existing name; `422` means unknown, `409` ambiguous.
- **Today looks wrong after midnight** — reload. The app rolls over at local midnight and closes
  yesterday's session.
- **The app shows an old version** — reload once so the new service worker activates.
- **Data disappeared** — browser storage was cleared, or a different browser profile is in use.
  Restore your latest backup, or reconnect sync to a space that still has the data.

## Data and privacy

Trainer stores routines, sessions, custom exercises and settings in the `trainer` IndexedDB database
in your browser. Without sync, no training data leaves the device. With sync, entities are encrypted
on the device and the relay stores ciphertext plus change metadata; the relay decrypts in memory only
to build the report and validate AI writes. There is no telemetry and no third-party script.

Clearing site data deletes local Trainer data. Export a backup regularly if you do not use sync.

## wger attribution

Exercise text, metadata and media come from [wger](https://wger.de/). Individual records are licensed
CC BY-SA 4.0, CC BY-SA 3.0 or CC0; author and licence are kept with each record and shown with each
image. Trainer maps wger names and muscles into its own taxonomy and bundles no videos.

The body diagram vendors MIT-licensed polygon data from `@mjcdev/react-body-highlighter`. Full
credits: `src/domain/catalogue/ATTRIBUTION.md`.
