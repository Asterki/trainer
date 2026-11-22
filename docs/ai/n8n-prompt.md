# Trainer — n8n prompt and workflow contract

This document is the Stage 1 contract for the morning AI workflow. It describes the nodes, the
system prompt, validation and the exact HTTP calls. Stage 7 turns this into the deployable
`docs/ai/n8n-workflow.md` and stores the same prompt in the workflow.

Companion files:

- [`context-report.schema.json`](context-report.schema.json) — JSON Schema for the context report.
- [`../api/openapi.json`](../api/openapi.json) — OpenAPI 3.1 contract for the relay.

## 1. Prerequisites

- A running Trainer relay over HTTPS, with `TRAINER_TIMEZONE` set to the gym's IANA timezone.
- The relay sync passphrase, stored in n8n as a **Header Auth** credential named `Trainer relay`.
  The credential value is `Bearer <passphrase>` for the `Authorization` header.
- At least one active routine with a workout slot today. The workflow does nothing useful on rest
  days or with no active routine.
- A model node in n8n with JSON output support. The prompt requires JSON only.

Never put the passphrase in the workflow JSON, a prompt, an expression, a log or an error message.
TLS is mandatory. Treat every n8n execution record as sensitive because it can contain training
data.

## 2. Workflow at a glance

```
Schedule Trigger (06:00)
        │
        ▼
HTTP Request: GET /api/v1/context
        │
        ▼
Code: validate report + build compact prompt
        │
        ├── no routine / rest day ──► No-op (end)
        ▼
LLM: choose exercises and targets (JSON only)
        │
        ▼
Code: validate plan, clamp, build PUT body
        │
        ▼
HTTP Request: PUT /api/v1/sessions/{date}
        │
        ├── 409 / 422 ──► Error workflow (do not retry)
        └── 429 / 5xx ──► bounded retry, then error workflow
```

## 3. Node by node

### 3.1 Schedule Trigger

- Type: Schedule Trigger.
- Rule: every day at **06:00** in the gym timezone. If n8n's instance timezone differs, set the
  workflow timezone explicitly or schedule in UTC with the offset.
- One run per day. A manual trigger is enabled for testing.
- The relay also validates the target date; a run around midnight is accepted only within ±1 day.

### 3.2 HTTP Request — context

- Method: `GET`
- URL: `{RELAY_URL}/api/v1/context`
- Authentication: Header Auth credential `Trainer relay` (`Authorization: Bearer <passphrase>`).
- Send query parameter `date` only when doing a pinned test. Omitting it uses today in the relay
  timezone.
- Accept: `application/json`
- Timeout: 20 seconds.
- Do not retry `401` or `400`. Retry `429` and `5xx` at most twice with backoff.

Expected response: the `ContextReport` shape. `routine` may be `null`. `routine.isRest` may be true.

### 3.3 Code — validate and build the prompt

This node is a guard, not a formatter only. It must:

1. Parse the response as JSON.
2. Reject a report whose `version` is present and not `1`. A missing version is treated as `1` for
   compatibility with the Stage 1 draft; the relay includes it from Stage 7 onwards.
3. Stop cleanly when `routine` is `null` or `routine.isRest` is `true`; there is no session to plan.
4. Require `candidates` to be a non-empty array. If empty, stop and notify; do not invent an
   exercise.
5. Build a compact prompt from the report:
   - the date and today's focus;
   - up to 6 recent sessions, each with exercise names, weights and reps;
   - up to 20 exercise stats with last performance, PRs by rep count and volume trend;
   - the candidate list with ids, names, primary and secondary muscles and equipment;
   - the last 8 weeks of muscle volume and the 8-week adherence summary.
6. Never include the passphrase, the raw request headers or any server field outside the schema.

The code node output is the prompt string plus a small object with `date`, `focus` and the allowed
candidate ids. The allowed ids are needed again by the validator.

A compact prompt body is better than dumping the report. Example prompt data:

```text
Date: 2026-11-16
Focus: Push
Routine: PPL 2-week, week 0 (week 1 of 2)
Recent Push sessions:
  2026-11-09 completed: Bench Press 80x8, 80x7; Incline DB Press 30x10, 30x9
  2026-11-02 completed: Bench Press 77.5x8, 77.5x8; Overhead Press 45x8
Exercise stats:
  Bench Press (wger:73): last 2026-11-09 80x8; PRs 5:95 8:80; trend 1200, 1350, 1280
  ...
Candidates (choose ids only from this list):
  wger:73 Bench Press | primary: pectoralis-major | secondary: triceps-brachii, anterior-deltoid | barbell
  wger:145 Incline Dumbbell Press | primary: pectoralis-major | secondary: triceps-brachii, anterior-deltoid | dumbbell
  ...
Muscle volume (last 8 weeks):
  2026-W45: pectoralis-major 8200, triceps-brachii 4100, ...
Adherence: 16 scheduled, 12 completed, 4 skipped, rate 0.75
```

### 3.4 LLM

- Use a model with reliable JSON output and a temperature low enough for stable plans (0.2–0.5).
- The system prompt is in §4. Keep it in the workflow, not in this document's editable copy, once
  Stage 7 lands.
- The user message is the compact prompt from §3.3.
- Require a single JSON object and no markdown fences.
- Do not give the model tools, browsing, the full catalogue or the passphrase.

Expected output shape:

```json
{
  "focus": "Push",
  "notes": "Week 1 push, slightly reduced pressing volume.",
  "exercises": [
    {
      "exerciseId": "wger:73",
      "targetSets": 4,
      "targetRepMin": 6,
      "targetRepMax": 8,
      "note": "Leave one rep in reserve."
    },
    {
      "exerciseId": "wger:145",
      "targetSets": 3,
      "targetRepMin": 8,
      "targetRepMax": 12
    }
  ]
}
```

### 3.5 Code — validate and clamp the plan

The plan is untrusted model output. This node must:

1. Parse JSON; strip markdown fences only if present; reject anything else.
2. Require 3–8 exercises after deduplication by `exerciseId`.
3. Reject any `exerciseId` not present in the context `candidates` array. Do not resolve names here;
   the API accepts ids and the workflow should use ids only.
4. Drop duplicate exercises, keeping the first occurrence.
5. Clamp `targetSets` to 2–5, `targetRepMin`/`targetRepMax` to 5–15, and swap them if min > max.
   Narrow ranges are preferred for compounds; leave the model's values if they are already inside
   the policy.
6. Trim notes to 500 characters. Replace an empty focus with the routine focus; never let the model
   change today's focus.
7. Cap session notes at 2000 characters.
8. Fail loudly if fewer than 3 valid exercises remain. Do not send a one-exercise or empty plan.
9. Build:

```json
{
  "source": "ai",
  "focus": "Push",
  "notes": "Week 1 push, slightly reduced pressing volume.",
  "exercises": [
    {
      "exerciseId": "wger:73",
      "targetSets": 4,
      "targetRepMin": 6,
      "targetRepMax": 8,
      "note": "Leave one rep in reserve."
    }
  ]
}
```

The API accepts 1–12 sets and 1–50 reps, but the workflow policy is intentionally narrower:
3–8 exercises, 2–5 sets, 5–15 reps. The API never accepts a weight from the model.

### 3.6 HTTP Request — write the plan

- Method: `PUT`
- URL: `{RELAY_URL}/api/v1/sessions/{date}` where `{date}` is the report's `date`.
- Authentication: the same Header Auth credential.
- Header: `Content-Type: application/json`.
- Body: the validated object from §3.5.
- Timeout: 20 seconds.
- Success: `200` with the full stored session. Log only the session date and id, never the body.

The app receives the plan through its normal encrypted sync; n8n does not call the app.

### 3.7 Error branch

- Send failures to an n8n error workflow or a notification channel the user actually reads.
- **Do not retry** `409` or `422`; the state is intentional. A duplicate run after a set is logged
  must not erase the workout.
- `401` means the credential is wrong or the passphrase changed; stop and notify.
- `429` and `5xx` may be retried at most twice with backoff.
- Include the status, machine error code and date in the notification. Do not include the response
  body if it may contain training data; log the error code and a short message only.

### 3.8 Manual test and dry run

Before enabling the schedule:

1. Pin a context fixture from a real relay response and run the prompt and validator nodes.
2. Point the PUT node at a staging relay or a test space.
3. Verify the app receives the plan after sync, shows the exercises and targets, and that a second
   run after logging one set returns `409 session_in_progress` without changing the session.
4. Verify a rest day produces no PUT and a 409 `no_scheduled_workout` if forced.

## 4. System prompt

Use this text as the system prompt. It is intentionally strict; the validator is the final authority.

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
   with min <= max. Use narrower ranges for compounds and slightly wider ranges for isolation.
4. Never prescribe weight. Weight is the lifter's decision. Do not put weight, RPE, tempo, rest
   times or percentages in the output.
5. Progress conservatively from last performance and the volume trend: add reps before load, and
   do not jump load when recent volume is falling. Respect recent PRs as evidence of capability.
6. Do not repeat the last same-focus session verbatim. Keep one or two anchor exercises and vary
   the rest. Prefer exercises with recent history when the focus allows it.
7. Respect the muscle volume report: avoid piling more volume onto a muscle that is already far
   ahead of the rest this week.
8. If the report is empty or has no usable history, choose a balanced session from the candidates
   for the focus. Do not ask questions and do not explain your reasoning.
9. Return one JSON object with exactly this shape:
   {"focus": string, "notes": string, "exercises": [
     {"exerciseId": string, "targetSets": number, "targetRepMin": number,
      "targetRepMax": number, "note": string}
   ]}
   Use the scheduled focus as "focus". Keep "notes" under 300 characters and each exercise note
   under 200 characters. Do not return markdown, comments or extra keys.
```

The user message is the formatted context from §3.3. Do not append the full JSON report if the
compact prompt is already built; the compact form is what keeps the request small.

## 5. Sample context request and response

Request:

```http
GET /api/v1/context?date=2026-11-16 HTTP/1.1
Host: relay.example.com
Authorization: Bearer <sync passphrase>
Accept: application/json
```

Response (abridged to one recent session and one stat):

```json
{
  "version": 1,
  "date": "2026-11-16",
  "generatedAt": "2026-11-16T06:00:00+00:00",
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
          "sets": [
            { "weight": 80, "reps": 8 },
            { "weight": 80, "reps": 7 }
          ],
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
      "last": {
        "date": "2026-11-09",
        "sets": [{ "weight": 80, "reps": 8 }]
      },
      "prs": { "5": 95, "8": 80 },
      "volumeTrend": [1200, 1350, 1280]
    }
  ],
  "candidates": [
    {
      "exerciseId": "wger:73",
      "name": "Bench Press",
      "primaryMuscles": ["pectoralis-major"],
      "secondaryMuscles": ["triceps-brachii", "anterior-deltoid"],
      "equipment": ["barbell"]
    },
    {
      "exerciseId": "wger:145",
      "name": "Incline Dumbbell Press",
      "primaryMuscles": ["pectoralis-major"],
      "secondaryMuscles": ["triceps-brachii", "anterior-deltoid"],
      "equipment": ["dumbbell"]
    }
  ],
  "muscleVolume": [
    {
      "week": "2026-W45",
      "muscles": {
        "pectoralis-major": 8200,
        "triceps-brachii": 4100
      }
    }
  ],
  "adherence": {
    "weeks": 8,
    "scheduled": 16,
    "completed": 12,
    "skipped": 4,
    "rate": 0.75
  }
}
```

## 6. Sample plan request and response

Request:

```http
PUT /api/v1/sessions/2026-11-16 HTTP/1.1
Host: relay.example.com
Authorization: Bearer <sync passphrase>
Content-Type: application/json

{
  "source": "ai",
  "focus": "Push",
  "notes": "Week 1 push, slightly reduced pressing volume.",
  "exercises": [
    {
      "exerciseId": "wger:73",
      "targetSets": 4,
      "targetRepMin": 6,
      "targetRepMax": 8,
      "note": "Leave one rep in reserve."
    },
    {
      "exerciseId": "wger:145",
      "targetSets": 3,
      "targetRepMin": 8,
      "targetRepMax": 12
    }
  ]
}
```

Response `200` (abridged to one exercise row):

```json
{
  "id": "8f2b1d4a-6f2e-4a8b-9d7c-3a1e5b6c7d8e",
  "date": "2026-11-16",
  "routineId": "6d1c2f6e-6f6a-4c3e-9f0a-6d1c2f6e6f6a",
  "routineName": "PPL 2-week",
  "weekIndex": 0,
  "weekday": 1,
  "focus": "Push",
  "status": "planned",
  "source": "ai",
  "exercises": [
    {
      "id": "2c7e6a1b-4f3d-4b9a-8e2c-1d5f7a9b0c3e",
      "exerciseId": "wger:73",
      "name": "Bench Press",
      "primaryMuscles": ["pectoralis-major"],
      "secondaryMuscles": ["triceps-brachii", "anterior-deltoid"],
      "order": 0,
      "targetSets": 4,
      "targetRepMin": 6,
      "targetRepMax": 8,
      "note": "Leave one rep in reserve.",
      "sets": []
    }
  ],
  "notes": "Week 1 push, slightly reduced pressing volume.",
  "createdAt": "2026-11-16T06:00:01+00:00",
  "updatedAt": "2026-11-16T06:00:01+00:00",
  "completedAt": null,
  "skippedAt": null
}
```

## 7. Status codes the workflow must handle

| Status | Code | Meaning | Action |
|--------|------|---------|--------|
| 200 | — | Plan stored | End successfully |
| 400 | `invalid_body`, `invalid_date`, `date_out_of_range` | Bad request or wrong day | Notify; do not retry |
| 401 | `unauthorized`, `unknown_sync_space` | Bad passphrase or wrong space | Stop; fix the credential |
| 409 | `no_scheduled_workout` | Rest day or no active routine | End; nothing to plan |
| 409 | `session_closed` | Completed or skipped | Do not overwrite |
| 409 | `session_in_progress` | At least one set logged | Do not overwrite |
| 409 | `manual_session` | Ad-hoc workout | Do not overwrite |
| 409 | `ambiguous_exercise` | Name matched several exercises | Notify with candidate ids |
| 422 | `unknown_exercise` | Id or name not in the catalogue | Notify; fix the prompt or catalogue |
| 429 | `rate_limited` | Too many requests | Bounded retry with backoff |
| 500 | `internal` | Relay failure | Bounded retry, then notify |

The relay returns JSON errors in the shape
`{ "error": "session_closed", "message": "This session is already complete.", "details": { "date": "2026-11-16" } }`.
Never parse or display the passphrase from a request or a stored credential.

## 8. Security and operational notes

- The bearer key is the sync passphrase and grants full read/write to the space. Use a long random
  value; rotate by disconnecting and reconnecting the app, then updating the n8n credential.
- Store the credential in n8n's credential store. Do not paste it into HTTP node headers,
  expressions, the workflow JSON or this document.
- TLS is mandatory. Reject an `http://` relay URL.
- n8n execution history can contain the report and plan. Restrict access to the n8n instance and
  consider pruning successful executions.
- The relay rate-limits API routes and passphrase derivation. A normal morning run is one context
  read and one plan write.
- A missed run is harmless: the app still creates today's empty planned session, and the user can
  add exercises manually. The next run plans the next day.

## 9. Stage 7 follow-ups

Stage 7 copies this contract into `docs/ai/n8n-workflow.md`, adds the importable workflow shape,
deployment environment variables and the staging-relay test. The prompt rules, status handling and
payload shapes above are binding for Stage 7; if they change, update the OpenAPI document and the
context schema together.
