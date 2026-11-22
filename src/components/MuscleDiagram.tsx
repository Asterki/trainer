/** Front and back male body diagram, using the MIT body-highlighter package directly. */

import Body, { type BodyProps, type Slug } from '@mjcdev/react-body-highlighter';
import { MUSCLE_GROUP_LABELS } from '../domain/catalogue/groups';
import type { MuscleGroupId } from '../domain/types';

const COLORS = ['#cf222e', '#bf8700'];

const FRONT_MAP: Partial<Record<MuscleGroupId, Slug>> = {
  'anterior-deltoid': 'deltoids',
  'biceps-brachii': 'biceps',
  brachialis: 'biceps',
  'pectoralis-major': 'chest',
  'serratus-anterior': 'obliques',
  'rectus-abdominis': 'abs',
  'obliquus-externus-abdominis': 'obliques',
  'quadriceps-femoris': 'quadriceps',
  trapezius: 'trapezius',
};

const BACK_MAP: Partial<Record<MuscleGroupId, Slug>> = {
  'posterior-deltoid': 'deltoids',
  'triceps-brachii': 'triceps',
  'latissimus-dorsi': 'upper-back',
  rhomboid: 'upper-back',
  trapezius: 'trapezius',
  'erector-spinae': 'lower-back',
  'gluteus-maximus': 'gluteal',
  hamstrings: 'hamstring',
  gastrocnemius: 'calves',
  soleus: 'calves',
};

function bodyData(
  map: Partial<Record<MuscleGroupId, Slug>>,
  primary: MuscleGroupId[],
  secondary: MuscleGroupId[],
): BodyProps['data'] {
  const primarySlugs = new Set(primary.map((muscle) => map[muscle]).filter(Boolean) as Slug[]);
  const secondarySlugs = new Set(
    secondary
      .map((muscle) => map[muscle])
      .filter((slug): slug is Slug => Boolean(slug) && !primarySlugs.has(slug as Slug)),
  );

  return [
    ...[...primarySlugs].map((slug) => ({
      slug,
      leftSideIntensity: 1,
      rightSideIntensity: 1,
    })),
    ...[...secondarySlugs].map((slug) => ({
      slug,
      leftSideIntensity: 2,
      rightSideIntensity: 2,
    })),
  ];
}

export function MuscleDiagram({
  primary,
  secondary,
  compact = false,
}: {
  primary: MuscleGroupId[];
  secondary: MuscleGroupId[];
  compact?: boolean;
}) {
  if (primary.length === 0 && secondary.length === 0) return null;

  const primaryLabel = primary.map((muscle) => MUSCLE_GROUP_LABELS[muscle]).join(', ');
  const secondaryLabel = secondary.map((muscle) => MUSCLE_GROUP_LABELS[muscle]).join(', ');
  const label = `Front and back muscle diagram. Primary: ${primaryLabel || 'none'}. Secondary: ${
    secondaryLabel || 'none'
  }.`;

  return (
    <figure
      className={`muscle-diagram${compact ? ' muscle-diagram--compact' : ''}`}
      aria-label={label}
    >
      <div className="muscle-diagram__views" aria-hidden="true">
        <div className="muscle-diagram__view">
          <Body
            data={bodyData(FRONT_MAP, primary, secondary)}
            colors={COLORS}
            side="front"
            gender="male"
            scale={1}
            border="none"
          />
          <span>Front</span>
        </div>
        <div className="muscle-diagram__view">
          <Body
            data={bodyData(BACK_MAP, primary, secondary)}
            colors={COLORS}
            side="back"
            gender="male"
            scale={1}
            border="none"
          />
          <span>Back</span>
        </div>
      </div>
      {!compact && (
        <figcaption className="muscle-diagram__legend">
          {primary.length > 0 && (
            <span>
              <i
                className="muscle-diagram__swatch muscle-diagram__swatch--primary"
                aria-hidden="true"
              />
              Primary: {primaryLabel}
            </span>
          )}
          {secondary.length > 0 && (
            <span>
              <i
                className="muscle-diagram__swatch muscle-diagram__swatch--secondary"
                aria-hidden="true"
              />
              Secondary: {secondaryLabel}
            </span>
          )}
        </figcaption>
      )}
    </figure>
  );
}
