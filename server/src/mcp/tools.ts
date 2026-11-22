/**
 * Read-only MCP tools over the decrypted Trainer sync space.
 *
 * A model can read the routine, sessions, catalogue and derived metrics, but
 * has no way to create, update or delete anything. Numbers come from the same
 * pure domain functions the app and the relay API use.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { UserRow } from '../db.js';
import {
  entitiesByKind,
  findSessionByDate,
  openSpace,
  readCustomExercises,
  readRoutine,
  type Space,
} from '../space/store.js';
import type { SyncKeys } from '../space/crypto.js';
import { buildContextReport } from '../api/context.js';
import {
  EQUIPMENT_IDS,
  EXERCISE_CATEGORY_IDS,
  MUSCLE_GROUP_IDS,
} from '../trainer/catalogue/groups.js';
import {
  getExerciseById,
  loadCatalogue,
  searchExercises,
} from '../trainer/catalogue/wger.js';
import { isValidIsoDate, todayInTimezone } from '../trainer/date.js';
import {
  adherence,
  computePrs,
  exerciseHistory,
  muscleWeeks,
  prsForExercise,
} from '../trainer/metrics.js';
import { normalizeSettings } from '../trainer/normalize.js';
import { resolveSlot } from '../trainer/routine.js';
import type { Exercise, IsoDate, Routine, Session } from '../trainer/types.js';

export interface McpContext {
  user: UserRow;
  keys: SyncKeys;
}

const dateSchema = z
  .string()
  .refine((value) => isValidIsoDate(value), 'Expected a valid date in YYYY-MM-DD format.');

const statusSchema = z.enum(['planned', 'completed', 'skipped']);

const READ_ONLY = { annotations: { readOnlyHint: true as const } };

function ok(value: unknown) {
  return {
    content: [
      { type: 'text' as const, text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) },
    ],
  };
}

function fail(message: string) {
  return { content: [{ type: 'text' as const, text: message }], isError: true };
}

function todayOf(space: Space): IsoDate {
  const entity = space.entities.get('settings:app');
  const settings = entity ? normalizeSettings(entity.payload) : null;
  return settings ? todayInTimezone(settings.timezone) : todayInTimezone('UTC');
}

function compact(exercise: Exercise) {
  return {
    id: exercise.id,
    name: exercise.name,
    category: exercise.category,
    primaryMuscles: exercise.primaryMuscles,
    secondaryMuscles: exercise.secondaryMuscles,
    equipment: exercise.equipment,
    source: exercise.source,
  };
}

function summaryOf(session: Session) {
  return {
    id: session.id,
    date: session.date,
    focus: session.focus,
    status: session.status,
    source: session.source,
    routineName: session.routineName,
    rating: session.rating,
    exerciseCount: session.exercises.length,
  };
}

export function registerTrainerTools(server: McpServer, context: McpContext): void {
  let cached: Promise<Space> | null = null;
  const space = () => (cached ??= openSpace(context.user, context.keys));
  const catalogue = async () => loadCatalogue(readCustomExercises(await space()));

  server.registerTool(
    'get_today',
    {
      ...READ_ONLY,
      title: 'Get today',
      description:
        "Today's routine slot, session status and logged sets for the signed-in trainer. Personal data, read-only, and may be incomplete if the app has not synced recently.",
      inputSchema: {},
    },
    async () => {
      try {
        const snapshot = await space();
        const date = todayOf(snapshot);
        const routine = readRoutine(snapshot);
        const slot = routine ? resolveSlot(routine, date) : null;
        const session = findSessionByDate(snapshot, date);

        return ok({
          date,
          routine: routine ? { id: routine.id, name: routine.name } : null,
          slot: slot
            ? {
                weekIndex: slot.weekIndex,
                weekday: slot.weekday,
                focus: slot.focus,
                isRest: slot.kind === 'rest',
                note: slot.note,
              }
            : null,
          session,
        });
      } catch (error) {
        return fail(error instanceof Error ? error.message : 'Could not read today.');
      }
    },
  );

  server.registerTool(
    'get_context',
    {
      ...READ_ONLY,
      title: 'Get context report',
      description:
        'The compact training report used by the planning workflow: routine slot, recent sessions, exercise stats, candidates, muscle volume and adherence. Personal data, read-only, and may be incomplete if the app has not synced recently.',
      inputSchema: {
        date: dateSchema.optional().describe('Calendar date (YYYY-MM-DD). Defaults to today.'),
      },
    },
    async ({ date }) => {
      try {
        const snapshot = await space();
        return ok(await buildContextReport(snapshot, date ?? todayOf(snapshot)));
      } catch (error) {
        return fail(error instanceof Error ? error.message : 'Could not build the report.');
      }
    },
  );

  server.registerTool(
    'list_routines',
    {
      ...READ_ONLY,
      title: 'List routines',
      description:
        'All routines with their week count, start date, active flag and full slot grid. A routine slot names a focus or rest; it does not list exercises.',
      inputSchema: {},
    },
    async () => {
      const snapshot = await space();
      const routines = entitiesByKind<Routine>(snapshot, 'routine').sort(
        (a, b) => Number(b.active) - Number(a.active) || b.updatedAt.localeCompare(a.updatedAt),
      );
      return ok({ count: routines.length, routines });
    },
  );

  server.registerTool(
    'get_routine',
    {
      ...READ_ONLY,
      title: 'Get routine',
      description: 'One routine by id, including every week and weekday slot.',
      inputSchema: {
        id: z.string().describe('Routine id'),
      },
    },
    async ({ id }) => {
      const routine = readRoutine(await space(), id);
      if (!routine) return fail(`Routine ${id} was not found.`);
      return ok({ routine });
    },
  );

  server.registerTool(
    'list_exercises',
    {
      ...READ_ONLY,
      title: 'List exercises',
      description:
        'Search the seeded wger catalogue plus custom exercises by text, muscle, equipment or category.',
      inputSchema: {
        query: z.string().max(100).optional(),
        muscle: z.enum(MUSCLE_GROUP_IDS as [string, ...string[]]).optional(),
        equipment: z.enum(EQUIPMENT_IDS as [string, ...string[]]).optional(),
        category: z.enum(EXERCISE_CATEGORY_IDS as [string, ...string[]]).optional(),
        limit: z.number().int().min(1).max(100).optional().describe('Default 20, maximum 100'),
      },
    },
    async ({ query, muscle, equipment, category, limit }) => {
      const rows = searchExercises(await catalogue(), {
        query: query ?? '',
        muscle: (muscle as Exercise['primaryMuscles'][number]) ?? null,
        equipment: (equipment as Exercise['equipment'][number]) ?? null,
        category: (category as Exercise['category']) ?? null,
        limit: limit ?? 20,
      }).map(compact);
      return ok({ count: rows.length, exercises: rows });
    },
  );

  server.registerTool(
    'get_exercise',
    {
      ...READ_ONLY,
      title: 'Get exercise',
      description: 'One catalogue or custom exercise by id, with instructions and aliases.',
      inputSchema: {
        id: z.string().describe('Exercise id, for example wger:91 or a custom UUID'),
      },
    },
    async ({ id }) => {
      const exercise = getExerciseById(await catalogue(), id);
      if (!exercise) return fail(`Exercise ${id} was not found.`);
      return ok({ exercise });
    },
  );

  server.registerTool(
    'list_sessions',
    {
      ...READ_ONLY,
      title: 'List sessions',
      description:
        'Session summaries inside an optional date range, filtered by status or focus. Newest first.',
      inputSchema: {
        from: dateSchema.optional().describe('Earliest date (YYYY-MM-DD)'),
        to: dateSchema.optional().describe('Latest date (YYYY-MM-DD)'),
        status: statusSchema.optional(),
        focus: z.string().max(80).optional().describe('Focus label such as Push or Legs'),
        limit: z.number().int().min(1).max(200).optional().describe('Default 20, maximum 200'),
      },
    },
    async ({ from, to, status, focus, limit }) => {
      const snapshot = await space();
      const needle = focus?.trim().toLocaleLowerCase();
      const sessions = entitiesByKind<Session>(snapshot, 'session')
        .filter((session) => {
          if (from && session.date < from) return false;
          if (to && session.date > to) return false;
          if (status && session.status !== status) return false;
          if (needle && session.focus.toLocaleLowerCase() !== needle) return false;
          return true;
        })
        .sort((a, b) => b.date.localeCompare(a.date) || b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, limit ?? 20)
        .map(summaryOf);
      return ok({ count: sessions.length, sessions });
    },
  );

  server.registerTool(
    'get_session',
    {
      ...READ_ONLY,
      title: 'Get session',
      description: 'One session by calendar date, with every exercise, target and logged set.',
      inputSchema: {
        date: dateSchema.describe('Session date (YYYY-MM-DD)'),
      },
    },
    async ({ date }) => {
      const session = findSessionByDate(await space(), date);
      if (!session) return fail(`No session exists on ${date}.`);
      return ok({ session });
    },
  );

  server.registerTool(
    'get_exercise_history',
    {
      ...READ_ONLY,
      title: 'Get exercise history',
      description:
        'Per-session top set, volume and estimated 1RM for one exercise, oldest first.',
      inputSchema: {
        exerciseId: z.string(),
        limit: z.number().int().min(1).max(100).optional().describe('Default 20, maximum 100'),
      },
    },
    async ({ exerciseId, limit }) => {
      const snapshot = await space();
      const sessions = entitiesByKind<Session>(snapshot, 'session');
      const exercise = getExerciseById(await catalogue(), exerciseId);
      if (!exercise && !sessions.some((session) => session.exercises.some((row) => row.exerciseId === exerciseId))) {
        return fail(`Exercise ${exerciseId} was not found.`);
      }
      const points = exerciseHistory(sessions, exerciseId);
      return ok({ exerciseId, points: points.slice(-(limit ?? 20)) });
    },
  );

  server.registerTool(
    'get_prs',
    {
      ...READ_ONLY,
      title: 'Get personal records',
      description:
        'Heaviest logged weight per exercise and rep count. Bodyweight sets (0 kg) are excluded.',
      inputSchema: {
        exerciseId: z.string().optional().describe('Limit to one exercise'),
      },
    },
    async ({ exerciseId }) => {
      const sessions = entitiesByKind<Session>(await space(), 'session');
      const prs = exerciseId ? prsForExercise(sessions, exerciseId) : computePrs(sessions);
      return ok({ count: prs.length, prs });
    },
  );

  server.registerTool(
    'get_muscle_volume',
    {
      ...READ_ONLY,
      title: 'Get muscle volume',
      description:
        'Weekly load volume per muscle group. Primary muscles get full credit, secondary muscles half.',
      inputSchema: {
        weeks: z.number().int().min(1).max(52).optional().describe('Default 8, maximum 52'),
      },
    },
    async ({ weeks }) => {
      const snapshot = await space();
      const sessions = entitiesByKind<Session>(snapshot, 'session');
      return ok({ weeks: muscleWeeks(sessions, weeks ?? 8, todayOf(snapshot)) });
    },
  );

  server.registerTool(
    'get_adherence',
    {
      ...READ_ONLY,
      title: 'Get adherence',
      description:
        'Completed and skipped scheduled workout days per week, plus the rate. Rest days and ad-hoc sessions are excluded.',
      inputSchema: {
        weeks: z.number().int().min(1).max(52).optional().describe('Default 8, maximum 52'),
      },
    },
    async ({ weeks }) => {
      const snapshot = await space();
      const sessions = entitiesByKind<Session>(snapshot, 'session');
      return ok(adherence(sessions, weeks ?? 8, todayOf(snapshot)));
    },
  );
}
