# Stage 8 — MCP, manual, polish

**Goal:** expose the training data to external AI clients read-only, document the product, remove
every legacy trace, and ship a release that survives a real week of training.

**Depends on:** Stages 1–7.
**Produces:** read-only MCP tools, `USER_MANUAL.md` + in-app manual, final design polish, release
checklist.

---

## 1. Read-only MCP

The MCP endpoint already authenticates with the sync passphrase and decrypts the space. Stage 7
moved that logic into `server/src/space/`. Stage 8 replaces the task tools with training tools and
removes every write path.

### Tools

| Tool | Input | Output |
|------|-------|--------|
| `get_today` | none | Today's slot, session status, exercises, targets, logged sets |
| `get_context` | `date?` | The same compact report used by n8n |
| `list_routines` | none | Routines with week count, start date, active flag and slots |
| `get_routine` | `id` | One routine with the full slot grid |
| `list_exercises` | `query?`, `muscle?`, `equipment?`, `category?`, `limit?` | Compact catalogue rows |
| `get_exercise` | `id` | Exercise with instructions and aliases |
| `list_sessions` | `from?`, `to?`, `status?`, `focus?`, `limit?` | Session summaries or full sessions |
| `get_session` | `date` | One session with exercises and sets |
| `get_exercise_history` | `exerciseId`, `limit?` | Per-session top set, volume, sets |
| `get_prs` | `exerciseId?` | PRs by exercise and rep count |
| `get_muscle_volume` | `weeks?` | Weekly volume per muscle group |
| `get_adherence` | `weeks?` | Scheduled/completed/skipped and rate |

Rules:

- No create/update/delete tools. No raw sync access. No settings writes.
- Limits: sessions ≤ 200, exercises ≤ 100, history ≤ 100. Defaults are smaller.
- Dates are `YYYY-MM-DD`; reject anything else with a clear tool error.
- Outputs are compact JSON; do not include internal fields like outbox or HLC.
- Tool descriptions state that data is personal, read-only and may be incomplete if the app has not
  synced recently.
- The MCP server name is `trainer`; version `1.0.0`; instructions explain the routine/session model
  briefly so a model does not mistake a routine slot for an exercise list.

### Tests

Use an MCP client (Inspector or a desktop client) with the passphrase:

- [ ] Tools list contains only the read tools.
- [ ] `get_today` works on a rest day, a plan-pending day and a completed day.
- [ ] `list_sessions` respects date and status filters.
- [ ] `get_prs` matches the in-app PR table.
- [ ] `get_muscle_volume` matches the in-app bars for the same weeks.
- [ ] A write attempt has no tool to call; the server exposes no write handler.
- [ ] Unknown exercise id returns a tool error, not a crash.
- [ ] Auth failure returns 401 before any tool executes.

Remove from `server/src/mcp/tools.ts`: every task/project/category/place tool and their
normalizers. Keep the transport and auth. Rename `registerTaskerTools` to `registerTrainerTools`.

---

## 2. User manual

Two deliverables, same content:

- `USER_MANUAL.md` — canonical, readable in the repository.
- `src/docs/UserManual.tsx` — in-app manual opened from Settings and `?` (or the More sheet).

No markdown parser dependency. Keep the in-app manual as structured JSX sections and update both
files in the same change. Add a comment at the top of each pointing to the other.

### Required sections

1. **What Trainer is** — routine + log + AI-planned sessions, local-first, personal use.
2. **Install and offline** — add to home screen, first load caches the shell, offline behaviour.
3. **Your first routine** — create, start date, week count, focus/rest, 2-week PPL example:
   - Week 1: Push, Pull, Legs, Rest, Upper, Lower, Rest.
   - Week 2: Push B, Pull B, Legs B, Rest, Upper B, Lower B, Rest.
   - Explain that the AI chooses exercises, not the routine.
4. **Today** — status meanings: No routine, Rest, Plan pending, Planned, In progress, Completed,
   Skipped. What the week strip means.
5. **Logging** — per-set weight and reps, bodyweight `0`, targets vs actual, adding/removing sets,
   editing targets, finish, reopen before midnight.
6. **Missed days** — automatic skip at midnight, 14-day backfill, rest days excluded, ad-hoc
   workouts.
7. **Progress** — exact definitions:
   - PR = heaviest weight for a rep count.
   - Volume = weight × reps; primary full, secondary half; bodyweight excluded.
   - Adherence = completed / (completed + skipped).
   - Recent PR = an all-time best achieved in the selected period.
8. **History** — read-only; filters; skipped sessions; no editing after midnight.
9. **Exercises** — catalogue search, muscles, equipment, custom exercises, duplicate-name rule,
   deleting an exercise does not change history.
10. **AI setup** — relay URL, passphrase, sync connect, `/api/v1/openapi.json`, n8n workflow,
    morning schedule, what happens when the plan is missing, security warning.
11. **Backup and restore** — export JSON, import replaces all data, disconnect sync first, reset
    deletes only Trainer, keep backups private (plaintext).
12. **Settings** — theme, sound, haptics, storage, attribution.
13. **Keyboard shortcuts** — 1–5 views, Esc, Enter behaviour in set inputs.
14. **Troubleshooting** — plan not arriving, sync error, offline edits, notification permissions
    (there are none), stale cache, reset.
15. **Data and privacy** — local IndexedDB, encrypted relay payloads, relay decrypts for reports,
    no accounts, no analytics.
16. **Attribution** — wger catalogue license and source, date retrieved.

Screenshots are optional. If added, use current UI only, no mock data that contradicts the app.
Text is enough for v1.

---

## 3. Visual and interaction polish

### Design pass

- Keep the Nordic palette; add semantic tokens only if missing:
  `--success` (completed), `--warning` (plan pending), `--danger` (skipped/error), `--rest`.
- Numeric emphasis: weights, reps, volume and PRs use tabular numerals (system monospace or
  `font-variant-numeric: tabular-nums`). Never hard-code a font file.
- Hierarchy on Today: date → focus → status → exercises → sets. One primary action per state.
- Empty states are one sentence plus one action; no illustrations required.
- Loading: skeleton for Today/Progress first paint, not a full-screen spinner forever.
- Error boundary at the app root with "Reload" and "Export data" if the DB still opens.
- Offline banner only when `navigator.onLine === false` or a sync request fails; do not nag.
- Sync status is quiet: a dot/label in Settings, plus a subtle pending count. No toast per sync.
- Toasts for save failures, export/import success, and destructive confirmations. Auto-dismiss 4s,
  pause on hover/focus, `aria-live="polite"`.
- Confirmations replace every `window.confirm`/`prompt`/`alert` in routine, session, exercise and
  data flows.

### Accessibility

- Landmarks: `<nav>`, `<main>`, `<header>`; one `<h1>` per view.
- All icon-only buttons have `aria-label`; decorative icons `aria-hidden`.
- Inputs have visible labels, not placeholder-only. Weight and reps have units.
- Focus ring visible on every interactive element, including grid cells.
- Keyboard: tabs, sheets, dialogs trap focus and restore it; Esc closes; no keyboard traps.
- Charts: `role="img"`, summary label, table alternative.
- Colour is never the only status signal; badges include text.
- Contrast: verify both themes against WCAG AA for text and controls.
- `prefers-reduced-motion` disables sheet and chart transitions.
- Touch targets ≥ 44×44 px; set inputs are comfortable with gym fingers.

### Mobile

- Bottom sheet reused for picker, slot editor, details and confirmations where appropriate.
- Swipe-to-close must not conflict with horizontal set inputs; verify pointer handling.
- Keyboard: focused weight/reps scroll into view above the keyboard; finish bar hides while typing
  if it covers inputs.
- Safe areas on iPhone: tab bar, finish bar, sheets.
- No hover-only information; last-time and PR hints must be visible or tap-accessible.
- Test at 320px width, 390px, 768px, 1024px and 1440px.

### PWA

- Manifest: name, short name, description, theme/background, display standalone, orientation any,
  icons 192/512 + maskable, start URL `/`, scope `/`.
- Install prompt: optional custom hint after the second visit; do not block the first run.
- Update flow: new service worker waits; show "New version ready — reload" rather than silently
  swapping mid-workout.
- Offline: shell cached; catalogue chunk cached after first use; IndexedDB writes unaffected.
- No push notifications; no notification permission prompt.

---

## 4. Final cleanup

Search and remove:

```bash
grep -rni "tasker\|ntfy\|todoist\|roadmap\|priority\|project\|category" \
  src server public index.html README.md USER_MANUAL.md docs --exclude-dir=node_modules
```

Allowed remainders: the old `tasker` IndexedDB name in a migration comment (if any), the wger
attribution text, and historical stage docs. Everything user-visible must say Trainer or use
training vocabulary.

Delete/verify:

- No `src/notifications/`.
- No task parser/progress/recurrence/suggestions.
- No task sync kinds or server task tools/types.
- No ntfy settings, topic, token fields.
- No XP, streak, achievement, combo, celebration, lane, place, priority.
- No `window.prompt`, `window.alert`, `window.confirm` in app flows.
- No unused dependencies in `package.json`; react-icons is still used.
- `pnpm-lock.yaml` updated only if dependencies changed (they should not).
- `vercel.json` still static SPA with SW headers; no functions.
- `server/Dockerfile` builds the final server.
- README architecture diagram and commands match reality.

Version: set `package.json` and the in-app About to `1.0.0` only when the release checklist passes.

---

## 5. Release verification matrix

Run on a fresh browser profile and a phone.

### Core loop

- [ ] Create a 2-week routine, activate it, today resolves correctly.
- [ ] n8n writes a plan; sync brings it in; exercises and targets appear.
- [ ] Log every set; finish; Today shows completed; Progress and History update immediately.
- [ ] Rest day shows rest; ad-hoc session logs and completes.
- [ ] Miss a day; it becomes skipped; adherence reflects it.
- [ ] Reopen today's completed session, fix a set, finish again.

### Data

- [ ] Export; reset; import; routines, sessions and custom exercises return.
- [ ] Import rejects a Tasker backup and a newer version.
- [ ] DB contains `trainer` only; `tasker` untouched.
- [ ] Storage persistence status shown.
- [ ] 500-session fixture stays responsive (manual seed script or dev-only data, not committed).

### Offline and sync

- [ ] Airplane mode: reload, navigate, log, finish.
- [ ] Reconnect: changes sync both ways.
- [ ] Two devices: routine, session plan and completion converge; only one routine active.
- [ ] Sync error shows a clear state and retries without duplicating records.
- [ ] Passphrase change/disconnect behaves as documented.

### API and AI

- [ ] `/health` reports Trainer and API.
- [ ] `/api/v1/openapi.json` loads unauthenticated and validates.
- [ ] Context report under token budget with 8 weeks of data.
- [ ] n8n dry run + scheduled run.
- [ ] Unknown exercise, rest day, completed session and logged-set cases return the documented JSON
      errors.
- [ ] MCP read-only tools return matching numbers.
- [ ] Relay logs contain no secrets or plaintext.

### Quality

- [ ] Lighthouse: PWA installable, performance ≥ 90 on a mid-range mobile profile, accessibility
      ≥ 95, best practices ≥ 95.
- [ ] No console errors on any view.
- [ ] Both themes, 320px–1440px, keyboard-only pass, screen-reader spot check (VoiceOver or NVDA).
- [ ] `pnpm typecheck` and `pnpm build` clean.
- [ ] Server build clean.
- [ ] Install and launch from the home screen with the network off.

---

## 6. Documentation to finish

- `README.md`: what Trainer is, screenshots optional, stack, commands, local-first model, relay,
  API, n8n, MCP, deployment (Vercel + Docker), environment variables, backup, security trade-off,
  license/attribution, stage docs link.
- `DESIGN.Md`: final tokens, typography, spacing, component states, chart palette, motion rules.
- `USER_MANUAL.md` + in-app manual: complete.
- `docs/api/openapi.json` / `server/openapi.json`: final.
- `docs/ai/n8n-workflow.md`: final, with screenshots optional.
- `docs/stages/`: keep as the historical plan; mark each stage complete at the top when done.
- `AGENTS.md`: update the project brief to Trainer so future agents are not told to build a todo
  app or web-push reminders. This is important repository hygiene.

---

## 7. Post-v1 backlog (explicitly out of scope)

Do not build these in this plan; record them for later:

- Bodyweight load tracking (bodyweight + added weight) and bodyweight volume.
- lb/kg display toggle.
- RPE, tempo, rest timers.
- Exercise images or videos.
- AI-authored routines (not just sessions).
- In-app LLM chat.
- Push/email reminders.
- Separate revocable API tokens.
- Multi-user spaces or sharing.
- Apple Health / Google Fit import.
- Cardio and heart-rate tracking.
- Drag-and-drop routine editing.

---

## 8. Exit criteria

Trainer is a complete, documented, installable app: routine → AI plan → logged workout → derived
progress history, with encrypted sync, an authenticated API, read-only MCP, and no Tasker remnants.
The manual explains every feature and the notification-free design is explicit.
