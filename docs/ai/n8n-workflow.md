# Trainer — n8n morning workflow

This is the Stage 7 deployment contract for the morning AI plan. The canonical machine contracts are
[`server/openapi.json`](../../server/openapi.json) (served at `/api/v1/openapi.json`) and
[`context-report.schema.json`](context-report.schema.json). The relay never calls n8n; n8n calls the
relay over HTTPS and the app receives the plan through normal encrypted sync.

**Never put the passphrase in workflow JSON, a prompt, an expression, a log or a notification.**
Store it in an n8n Header Auth credential. TLS is mandatory.

## 1. Workflow shape

```
Schedule Trigger 06:00 (gym timezone)
        │
        ▼
HTTP Request  GET  {RELAY_URL}/api/v1/context
        │
        ▼
Code          validate report, build compact prompt
        │
        ├── routine null / rest day / no candidates ──► No-op
        ▼
LLM           choose 3–8 candidate exercises, JSON only
        │
        ▼
Code          parse, validate, clamp, dedupe, cap 8
        │
        ▼
HTTP Request  PUT  {RELAY_URL}/api/v1/sessions/{date}
        │
        ├── 409 / 422 ──► Error workflow, no retry
        └── 429 / 5xx ──► retry twice with backoff, then error workflow
```

Create one Header Auth credential named `Trainer relay`:

- Header name: `Authorization`
- Value: `Bearer <sync passphrase>`

## 2. Nodes

### 2.1 Schedule Trigger

- Every day at **06:00** in `TRAINER_TIMEZONE` (or the gym's timezone). Set the workflow timezone
  explicitly if the n8n instance timezone differs.
- Keep a manual trigger for tests. The relay accepts a write only for today ±1 day.

### 2.2 HTTP Request — context

- `GET {RELAY_URL}/api/v1/context`
- Authentication: Header Auth credential `Trainer relay`.
- Query `date=YYYY-MM-DD` only for a pinned test; omit it in production so the relay uses its
  configured timezone.
- Do not retry `400` or `401`. Retry `429` and `5xx` at most twice.

The response is the `ContextReport` shape:

```json
{
  "version": 1,
  "date": "2026-11-16",
  "generatedAt": "2026-11-16T06:00:00.000Z",
  "routine": {
    "id": "6d1c2f6e-6f6a-4c3e-9f0a-6d1c2f6e6f6a",
    "name": "PPL 2-week",
    "weekIndex": 0,
    "weekday": 1,
    "focus": "Push",
    "isRest": false
  },
  "recentSessions": [
    {
      "date": "2026-11-09",
      "focus": "Push",
      "status": "completed",
      "exercises": [
        {
          "exerciseId": "wger:73",
          "name": "Bench Press",
          "primaryMuscles": ["pectoralis-major"],
          "sets": [{"weight": 80, "reps": 8}, {"weight": 80, "reps": 7}],
          "topWeight": 80,
          "volume": 1200
        }
      ]
    }
  ],
  "exerciseStats": [
    {
      "exerciseId": "wger:73",
      "name": "Bench Press",
      "primaryMuscles": ["pectoralis-major"],
      "last": {"date": "2026-11-09", "sets": [{"weight": 80, "reps": 8}]},
      "prs": {"5": 95, "8": 80},
      "volumeTrend": [1200, 1350, 1280]
    }
  ],
  "candidates": [
    {
      "exerciseId": "wger:145",
      "name": "Incline Dumbbell Press",
      "primaryMuscles": ["pectoralis-major"],
      "secondaryMuscles": ["triceps-brachii", "anterior-deltoid"],
      "equipment": ["dumbbell"]
    }
  ],
  "muscleVolume": [{"week": "2026-W45", "muscles": {"pectoralis-major": 8200}}],
  "adherence": {"weeks": 8, "scheduled": 16, "completed": 12, "skipped": 4, "rate": 0.75}
}
```

### 2.3 Code — validate report and build prompt

```js
const report = $json;
if (report.version !== undefined && report.version !== 1) throw new Error('Unsupported context version');
if (!report.routine || report.routine.isRest) return [{ json: { skip: true, reason: 'rest_or_no_routine' } }];
if (!Array.isArray(report.candidates) || report.candidates.length === 0) {
  throw new Error('No candidate exercises; do not invent one');
}

const lines = [
  `Date: ${report.date}`,
  `Focus: ${report.routine.focus}`,
  `Routine: ${report.routine.name}, week ${report.routine.weekIndex + 1}`,
  'Recent sessions:',
];
for (const session of report.recentSessions) {
  const exercises = session.exercises
    .map((exercise) => `${exercise.name} ${exercise.sets.map((set) => `${set.weight}x${set.reps}`).join(', ')}`)
    .join('; ');
  lines.push(`  ${session.date} ${session.status}: ${exercises}`);
}
lines.push('Exercise stats:');
for (const stat of report.exerciseStats) {
  const last = stat.last ? `${stat.last.date} ${stat.last.sets.map((set) => `${set.weight}x${set.reps}`).join(', ')}` : 'none';
  lines.push(`  ${stat.name} (${stat.exerciseId}): last ${last}; PRs ${JSON.stringify(stat.prs)}; trend ${stat.volumeTrend.join(', ')}`);
}
lines.push('Candidates (choose ids only from this list):');
for (const candidate of report.candidates) {
  lines.push(
    `  ${candidate.exerciseId} ${candidate.name} | primary: ${candidate.primaryMuscles.join(', ')}` +
      ` | secondary: ${candidate.secondaryMuscles.join(', ')} | ${candidate.equipment.join(', ')}`,
  );
}
lines.push('Muscle volume (last 8 weeks):');
for (const week of report.muscleVolume) {
  lines.push(`  ${week.week}: ${Object.entries(week.muscles).map(([muscle, volume]) => `${muscle} ${volume}`).join(', ')}`);
}
const adherence = report.adherence;
lines.push(
  `Adherence: ${adherence.scheduled} scheduled, ${adherence.completed} completed, ${adherence.skipped} skipped, rate ${adherence.rate ?? 'n/a'}`,
);

return [{
  json: {
    date: report.date,
    focus: report.routine.focus,
    candidateIds: report.candidates.map((candidate) => candidate.exerciseId),
    prompt: lines.join('\n'),
  },
}];
```

The prompt never includes the passphrase or the full catalogue.

### 2.4 LLM

Use a model with reliable JSON output at a low temperature (0.2–0.5), no tools and no browsing.
System prompt:

```text
You are the programming assistant for a single lifter using Trainer, a local-first workout log.

You receive today's date, the scheduled focus, recent training sessions, per-exercise stats
(last performance, PRs by rep count, volume trend), a bounded candidate list, recent muscle
volume and adherence.

Your job: write today's session plan as JSON only.

Hard rules:
1. Choose 3 to 8 exercises, and choose exerciseId only from the candidate list. Never invent an
   exercise, never use a name that is not in the list, and never return an exercise twice.
2. Match today's focus and cover its main muscles. Use primary muscles to judge coverage.
3. Prescribe targetSets between 2 and 5. Prescribe targetRepMin and targetRepMax between 5 and 15,
   with min <= max. Use narrower ranges for compounds and wider ranges for isolation.
4. Never prescribe weight. Weight is the lifter's decision. Do not output weight, RPE, tempo,
   rest times or percentages.
5. Progress conservatively from last performance and volume: add reps before load. Respect PRs and
   do not increase load when recent volume is falling.
6. Do not repeat the last same-focus session verbatim. Keep one or two anchor exercises and vary
   the rest.
7. Respect muscle volume: avoid adding volume to a muscle already far ahead this week.
8. If history is empty, choose a balanced session from the candidates for the focus. Do not ask
   questions and do not explain your reasoning.
9. Return one JSON object with exactly this shape:
   {"focus": string, "notes": string, "exercises": [
     {"exerciseId": string, "targetSets": number, "targetRepMin": number,
      "targetRepMax": number, "note": string}
   ]}
   Use the scheduled focus. Keep "notes" under 300 characters and each exercise note under 200.
   Do not return markdown, comments or extra keys.
```

### 2.5 Code — validate and clamp the plan

```js
const context = $('Code: validate report').first().json;
const raw = typeof $json.text === 'string' ? $json.text : JSON.stringify($json);
const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
const plan = JSON.parse(cleaned);

const allowed = new Set(context.candidateIds);
const seen = new Set();
const exercises = [];
for (const item of Array.isArray(plan.exercises) ? plan.exercises : []) {
  if (!allowed.has(item.exerciseId) || seen.has(item.exerciseId)) continue;
  seen.add(item.exerciseId);
  let min = Math.round(Number(item.targetRepMin));
  let max = Math.round(Number(item.targetRepMax));
  if (!Number.isFinite(min) || !Number.isFinite(max)) continue;
  min = Math.min(15, Math.max(5, min));
  max = Math.min(15, Math.max(5, max));
  if (min > max) [min, max] = [max, min];
  exercises.push({
    exerciseId: item.exerciseId,
    targetSets: Math.min(5, Math.max(2, Math.round(Number(item.targetSets)) || 3)),
    targetRepMin: min,
    targetRepMax: max,
    note: String(item.note ?? '').slice(0, 500),
  });
}
if (exercises.length < 3) throw new Error('Fewer than 3 valid candidate exercises');
if (exercises.length > 8) exercises.length = 8;

return [{
  json: {
    source: 'ai',
    focus: context.focus,
    notes: String(plan.notes ?? '').slice(0, 2000),
    exercises,
  },
}];
```

The API itself accepts 1–12 sets and 1–50 reps; the workflow policy is deliberately narrower.
The API never accepts a weight from the model.

### 2.6 HTTP Request — write the plan

- `PUT {RELAY_URL}/api/v1/sessions/{date}` where `{date}` is `context.date`.
- Same Header Auth credential, `Content-Type: application/json`, 20 second timeout.
- Body: the validated object from §2.5.
- Success: `200` with the full stored session. Log only date and session id, never the body.

### 2.7 Error branch

- Send failures to an n8n error workflow or a notification channel the user reads.
- **Do not retry `409` or `422`.** The state is intentional; a second run must not overwrite a
  logged workout.
- `401` means the credential or passphrase space is wrong; stop and notify.
- `429` and `5xx` may be retried twice with backoff.
- Notify the status, machine error code and date only. Do not include response bodies.

## 3. Dry run before enabling the schedule

1. Pin a real context response as a fixture and run the prompt and validator nodes.
2. Point the PUT node at a staging relay and a test space.
3. Confirm the app receives the plan after sync and shows exercises with targets.
4. Log one set manually, rerun the workflow, and confirm `409 session_in_progress` with the set
   preserved.
5. Force a rest day and confirm `409 no_scheduled_workout`.

Operational checks:

```bash
curl -s https://relay.example/health

curl -s -H "Authorization: Bearer $TRAINER_KEY" \
  "https://relay.example/api/v1/context?date=2026-11-16" | jq

curl -s -X PUT -H "Authorization: Bearer $TRAINER_KEY" \
  -H "Content-Type: application/json" \
  -d '{"exercises":[{"exerciseId":"wger:73","targetSets":4,"targetRepMin":6,"targetRepMax":8}]}' \
  "https://relay.example/api/v1/sessions/2026-11-16" | jq
```

## 4. Status codes

| Status | Code | Meaning | Action |
|--------|------|---------|--------|
| 200 | — | Plan stored | End successfully |
| 400 | `invalid_body`, `invalid_date`, `date_out_of_range` | Bad request or wrong day | Notify; do not retry |
| 401 | `unauthorized`, `unknown_sync_space` | Bad passphrase or wrong space | Stop; fix the credential |
| 403 | `origin_not_allowed` | Browser origin not configured | Use server-to-server auth |
| 409 | `no_scheduled_workout` | Rest day or no active routine | End; nothing to plan |
| 409 | `session_closed` | Completed or skipped | Do not overwrite |
| 409 | `session_in_progress` | At least one set logged | Do not overwrite |
| 409 | `manual_session` | Ad-hoc workout | Do not overwrite |
| 409 | `ambiguous_exercise` | Name matched several exercises | Notify with candidate ids |
| 422 | `unknown_exercise` | Id or name not in the catalogue | Notify; fix the prompt or catalogue |
| 429 | `rate_limited` | Too many requests or derivations | Bounded retry with backoff |
| 500 | `internal` | Relay failure | Bounded retry, then notify |

Errors use `{ "error": string, "message": string, "details"?: unknown }`.

## 5. Security notes

- The bearer key is the sync passphrase and grants full read/write to the space. Use a long random
  value. Rotate by disconnecting and reconnecting the app, then updating the n8n credential.
- The relay logs only request id, method, path, status and duration. It never logs headers, bodies,
  passphrases, derived keys or decrypted records.
- n8n execution history can contain training data and the plan. Restrict instance access and prune
  successful executions if that matters.
- A normal morning run is one context read and one plan write. The relay limits API requests to
  120/minute per space and IP, and passphrase derivations to 20/minute per IP.
