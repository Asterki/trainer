/**
 * Trainer domain model.
 *
 * These shapes are the on-disk schema. All dates that represent a training day
 * are local calendar strings; audit timestamps are ISO 8601 instants.
 */

export type IsoDate = string; // YYYY-MM-DD, local calendar date
export type IsoDateTime = string; // ISO 8601 with offset, for audit fields

export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7; // ISO: 1 Monday … 7 Sunday

export type MuscleGroupId =
  | 'anterior-deltoid'
  | 'posterior-deltoid'
  | 'biceps-brachii'
  | 'brachialis'
  | 'triceps-brachii'
  | 'pectoralis-major'
  | 'latissimus-dorsi'
  | 'rhomboid'
  | 'trapezius'
  | 'serratus-anterior'
  | 'erector-spinae'
  | 'rectus-abdominis'
  | 'obliquus-externus-abdominis'
  | 'gluteus-maximus'
  | 'quadriceps-femoris'
  | 'hamstrings'
  | 'gastrocnemius'
  | 'soleus';

export type EquipmentId =
  | 'barbell'
  | 'dumbbell'
  | 'machine'
  | 'cable'
  | 'bodyweight'
  | 'kettlebell'
  | 'band'
  | 'other';

export type ExerciseCategory =
  | 'chest'
  | 'back'
  | 'shoulders'
  | 'arms'
  | 'legs'
  | 'calves'
  | 'abs'
  | 'full-body';

export interface Exercise {
  /** `wger:<id>` for seeded rows, UUID for custom rows. Stable forever. */
  id: string;
  name: string;
  aliases: string[];
  category: ExerciseCategory;
  primaryMuscles: MuscleGroupId[];
  secondaryMuscles: MuscleGroupId[];
  equipment: EquipmentId[];
  instructions: string;
  source: 'wger' | 'custom';
  createdAt: IsoDateTime | null; // custom only
}

export interface RoutineSlot {
  weekIndex: number; // 0-based
  weekday: Weekday;
  kind: 'workout' | 'rest';
  focus: string; // "Push", "Upper", "Legs A"; empty on rest
  note: string;
}

export interface Routine {
  id: string; // UUID
  name: string;
  notes: string;
  startDate: IsoDate; // routine applies from this date; week 0 is its Monday-based week
  weekCount: number; // 1..12
  slots: RoutineSlot[]; // exactly weekCount * 7, unique (weekIndex, weekday)
  active: boolean;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface RoutineInput {
  name: string;
  notes?: string;
  startDate?: IsoDate;
  weekCount?: number;
  slots?: RoutineSlot[];
}

export interface RoutinePatch {
  name?: string;
  notes?: string;
  startDate?: IsoDate;
  weekCount?: number;
  slots?: RoutineSlot[];
}

export type SessionStatus = 'planned' | 'completed' | 'skipped';
export type SessionSource = 'ai' | 'manual' | 'auto';

export interface SetLog {
  id: string; // UUID, for row identity
  weight: number; // kg, >= 0, rounded to 2 decimals
  reps: number; // integer, 1..999
}

export interface SessionExercise {
  id: string; // UUID, row identity
  exerciseId: string; // catalogue id
  name: string; // snapshot
  primaryMuscles: MuscleGroupId[]; // snapshot
  secondaryMuscles: MuscleGroupId[]; // snapshot
  order: number;
  targetSets: number; // 1..12
  targetRepMin: number; // 1..50
  targetRepMax: number; // >= min, <= 50
  note: string;
  sets: SetLog[]; // performed sets only
}

export interface Session {
  id: string; // UUID
  date: IsoDate;
  routineId: string | null;
  routineName: string; // snapshot
  weekIndex: number | null;
  weekday: Weekday;
  focus: string; // snapshot, "Ad-hoc" for manual sessions
  status: SessionStatus;
  source: SessionSource;
  exercises: SessionExercise[];
  notes: string;
  rating: number | null; // 1 drained … 5 fresh
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  completedAt: IsoDateTime | null;
  skippedAt: IsoDateTime | null;
}

export type ThemeSetting = 'nordic-light' | 'nordic-dark';

export interface Settings {
  theme: ThemeSetting;
  soundEnabled: boolean;
  hapticsEnabled: boolean;
  timezone: string; // IANA, used for display and "today"
  weightUnit: 'kg' | 'lb';
  heightCm: number | null;
  bodyWeightKg: number | null;
}

export interface CustomExerciseInput {
  name: string;
  category: ExerciseCategory;
  primaryMuscles: MuscleGroupId[];
  secondaryMuscles?: MuscleGroupId[];
  equipment?: EquipmentId[];
  instructions?: string;
  aliases?: string[];
}

export type CustomExercisePatch = Partial<CustomExerciseInput>;

/** Shape of a full JSON backup produced by "Export". */
export interface BackupFile {
  app: 'trainer';
  version: 1;
  exportedAt: IsoDateTime;
  routines: Routine[];
  sessions: Session[];
  customExercises: Exercise[]; // source === 'custom'
  settings: Settings;
}
