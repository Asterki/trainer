/** Labelled catalogue constants shared by the app, the editor and the store. */

import type { EquipmentId, ExerciseCategory, MuscleGroupId } from '../types.js';

export const MUSCLE_GROUPS: Array<{ id: MuscleGroupId; label: string }> = [
  { id: 'anterior-deltoid', label: 'Anterior deltoid' },
  { id: 'posterior-deltoid', label: 'Posterior deltoid' },
  { id: 'biceps-brachii', label: 'Biceps brachii' },
  { id: 'brachialis', label: 'Brachialis' },
  { id: 'triceps-brachii', label: 'Triceps brachii' },
  { id: 'pectoralis-major', label: 'Pectoralis major' },
  { id: 'latissimus-dorsi', label: 'Latissimus dorsi' },
  { id: 'rhomboid', label: 'Rhomboid' },
  { id: 'trapezius', label: 'Trapezius' },
  { id: 'serratus-anterior', label: 'Serratus anterior' },
  { id: 'erector-spinae', label: 'Erector spinae' },
  { id: 'rectus-abdominis', label: 'Rectus abdominis' },
  { id: 'obliquus-externus-abdominis', label: 'Obliquus externus abdominis' },
  { id: 'gluteus-maximus', label: 'Gluteus maximus' },
  { id: 'quadriceps-femoris', label: 'Quadriceps femoris' },
  { id: 'hamstrings', label: 'Hamstrings' },
  { id: 'gastrocnemius', label: 'Gastrocnemius' },
  { id: 'soleus', label: 'Soleus' },
];

export const EQUIPMENT: Array<{ id: EquipmentId; label: string }> = [
  { id: 'barbell', label: 'Barbell' },
  { id: 'dumbbell', label: 'Dumbbell' },
  { id: 'machine', label: 'Machine' },
  { id: 'cable', label: 'Cable' },
  { id: 'bodyweight', label: 'Bodyweight' },
  { id: 'kettlebell', label: 'Kettlebell' },
  { id: 'band', label: 'Band' },
  { id: 'other', label: 'Other' },
];

export const EXERCISE_CATEGORIES: Array<{ id: ExerciseCategory; label: string }> = [
  { id: 'chest', label: 'Chest' },
  { id: 'back', label: 'Back' },
  { id: 'shoulders', label: 'Shoulders' },
  { id: 'arms', label: 'Arms' },
  { id: 'legs', label: 'Legs' },
  { id: 'calves', label: 'Calves' },
  { id: 'abs', label: 'Abs' },
  { id: 'full-body', label: 'Full body' },
];

export const MUSCLE_GROUP_IDS = MUSCLE_GROUPS.map((item) => item.id);
export const EQUIPMENT_IDS = EQUIPMENT.map((item) => item.id);
export const EXERCISE_CATEGORY_IDS = EXERCISE_CATEGORIES.map((item) => item.id);

export const MUSCLE_GROUP_BY_ID = Object.fromEntries(
  MUSCLE_GROUPS.map((item) => [item.id, item]),
) as Record<MuscleGroupId, { id: MuscleGroupId; label: string }>;

export const EQUIPMENT_BY_ID = Object.fromEntries(
  EQUIPMENT.map((item) => [item.id, item]),
) as Record<EquipmentId, { id: EquipmentId; label: string }>;

export const EXERCISE_CATEGORY_BY_ID = Object.fromEntries(
  EXERCISE_CATEGORIES.map((item) => [item.id, item]),
) as Record<ExerciseCategory, { id: ExerciseCategory; label: string }>;

export const MUSCLE_GROUP_LABELS = Object.fromEntries(
  MUSCLE_GROUPS.map((item) => [item.id, item.label]),
) as Record<MuscleGroupId, string>;

export const EQUIPMENT_LABELS = Object.fromEntries(
  EQUIPMENT.map((item) => [item.id, item.label]),
) as Record<EquipmentId, string>;

export const EXERCISE_CATEGORY_LABELS = Object.fromEntries(
  EXERCISE_CATEGORIES.map((item) => [item.id, item.label]),
) as Record<ExerciseCategory, string>;
