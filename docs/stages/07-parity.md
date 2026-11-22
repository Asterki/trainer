# Stage 7 — client/server parity

The relay deliberately duplicates Trainer's domain rules because the server deployable cannot import
browser code and the repository forbids a shared helper package. This note records the comparison
made while closing the server half of Stage 7.

## Method

- Compared `src/domain/{types,date,routine,session,metrics}.ts` with
  `server/src/trainer/{types,date,routine,session,metrics}.ts`.
- Compared `src/db/normalize.ts` with `server/src/trainer/normalize.ts`.
- Compared `src/domain/catalogue/*` with `server/src/trainer/catalogue/*`.
- Compared the shapes in `docs/ai/context-report.schema.json`, `server/openapi.json` and the
  builders in `server/src/api/`.
- The source comparison found only import-path differences (`./x` vs `./x.js`) plus the relay-only
  `todayInTimezone` helper in `server/src/trainer/date.ts`.
- No automated test suite was added, per repository policy. A live two-device sync run and a real
  relay fixture comparison remain part of the manual Stage 7 checklist; this note covers the
  line-by-line rule comparison.

## Checklist

| Rule | Result | Evidence |
|------|--------|----------|
| Muscle ids and the 18-group list are identical | Pass | Both use `MUSCLE_GROUP_IDS` from the copied `catalogue/groups` module; the OpenAPI/schema enums match. |
| Volume split: primary full/split, secondary half/split, fallback when no primary | Pass | `addMuscleAttribution` is identical in `src/domain/metrics.ts` and `server/src/trainer/metrics.ts`. |
| PR key `(exerciseId, reps)`, max weight, earliest tie date | Pass | `computePrs` is identical; bodyweight `weight <= 0` is excluded in both. |
| Adherence excludes rest and ad-hoc, denominator completed + skipped | Pass | `adherence` is identical; the server report maps only the summary fields. |
| Session normalization: status/source enums, targets, set bounds, order | Pass | `normalizeSession`/`normalizeSessionExercises` copied verbatim apart from import paths. |
| Routine normalization: slot count, week count, active flag | Pass | `normalizeRoutine`/`normalizeRoutines` copied verbatim; active routine selection uses latest `updatedAt`. |
| Date anchors: Monday cycle start, local dates, ISO week keys | Pass | `mondayOf`, `cycleStart`, `isoWeekKey` and `isoWeekday` are identical. |
| Catalogue ids `wger:<id>` and dedupe/name normalization | Pass | `fromRow` prefixes `wger:`; `normalizeExerciseText` and catalogue merge are identical. |
| Name resolution rejects unknown and ambiguous names | Pass | `server/src/api/sessions.ts` normalizes names, returns `422 unknown_exercise` for zero matches and `409 ambiguous_exercise` with up to five candidates for multiple matches. |
| Bodyweight weight 0 excluded from PR/volume | Pass | PRs skip `weight <= 0`; volume multiplies by 0, so bodyweight contributes no load volume. |
| API context shape matches the Stage 1 report | Pass | Builder emits `version`, `date`, `generatedAt`, `routine`, `recentSessions`, `exerciseStats`, `candidates`, `muscleVolume`, `adherence`; schema and OpenAPI are the same file content as `docs/api/openapi.json`. |
| API write cannot replace a logged or closed session | Pass | `PUT` returns `409` for `completed`/`skipped`, any logged set, and manual ad-hoc sessions; terminal merge protection lives in the client engine. |
| API resolves only catalogue/custom exercises | Pass | Ids are checked against the seeded + custom catalogue; names must match exactly one normalized catalogue name. |

## Known boundaries

- The relay uses `TRAINER_TIMEZONE` (default `UTC`) while a device may use its own settings
  timezone. The API accepts writes for today ±1 day in the relay timezone to absorb the edge.
- The context report's `generatedAt` uses `Date.toISOString()` (`Z`) while examples use `+00:00`;
  both are valid ISO 8601 date-times.
- Old task/category/project/place rows remain in existing SQLite files and are ignored. The legacy
  MCP tools still compile, but Stage 8 owns their replacement.
- Manual verification still required on real data: `/context` under ~15 KB for eight weeks, a PUT
  visible in the app after sync, a 409 after logging a set, and a rest-day 409.
