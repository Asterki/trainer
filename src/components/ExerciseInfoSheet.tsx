/** Exercise details in a drawer, opened from a session card. */

import { BottomSheet } from './BottomSheet';
import { ExerciseMediaGallery } from './ExerciseMedia';
import { MuscleDiagram } from './MuscleDiagram';
import type { Exercise, MuscleGroupId } from '../domain/types';

interface ExerciseInfoSheetProps {
  exercise: Exercise | null;
  primary: MuscleGroupId[];
  secondary: MuscleGroupId[];
  onClose: () => void;
}

export function ExerciseInfoSheet({ exercise, primary, secondary, onClose }: ExerciseInfoSheetProps) {
  return (
    <BottomSheet
      open={exercise !== null}
      title={exercise?.name ?? 'Exercise'}
      onClose={onClose}
      className="sheet--exercise"
    >
      {exercise ? (
        <>
          <ExerciseMediaGallery exercise={exercise} large />
          <MuscleDiagram primary={primary} secondary={secondary} />
          <section className="exercise-card__about">
            <h4>How to do it</h4>
            {exercise.instructions ? (
              <p className="exercise-card__instructions">{exercise.instructions}</p>
            ) : (
              <p className="card__hint">No description for this exercise yet.</p>
            )}
          </section>
        </>
      ) : null}
    </BottomSheet>
  );
}
