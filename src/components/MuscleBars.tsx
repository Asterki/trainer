import { useState } from 'react';
import { MUSCLE_GROUPS } from '../domain/catalogue/groups';
import type { MuscleGroupId } from '../domain/types';
import { BarChart, type BarDatum } from './charts/BarChart';

interface MuscleBarsProps {
  values: Partial<Record<MuscleGroupId, number>>;
  valueLabel: string;
  format: (value: number) => string;
  defaultLimit?: number;
  emptyText?: string;
}

export function MuscleBars({
  values,
  valueLabel,
  format,
  defaultLimit = 10,
  emptyText = 'No training volume in this range.',
}: MuscleBarsProps) {
  const [showAll, setShowAll] = useState(false);
  const total = MUSCLE_GROUPS.reduce((sum, muscle) => sum + (values[muscle.id] ?? 0), 0);

  if (total <= 0) {
    return <p className="chart-empty">{emptyText}</p>;
  }

  const sorted = [...MUSCLE_GROUPS].sort((a, b) => {
    const difference = (values[b.id] ?? 0) - (values[a.id] ?? 0);
    return difference !== 0 ? difference : a.label.localeCompare(b.label);
  });
  const trained = sorted.filter((muscle) => (values[muscle.id] ?? 0) > 0);
  const visible = showAll ? sorted : trained.slice(0, defaultLimit);
  const data: BarDatum[] = visible.map((muscle) => {
    const value = values[muscle.id] ?? 0;
    return {
      label: muscle.label,
      value,
      detail: `${format(value)} ${valueLabel}`,
      tone: value > 0 ? 'primary' : 'muted',
    };
  });

  return (
    <div className="muscle-bars">
      <BarChart
        data={data}
        ariaLabel={`${valueLabel} by muscle group`}
        valueFormat={format}
      />
      {showAll || trained.length > defaultLimit ? (
        <button
          type="button"
          className="button muscle-bars__toggle"
          onClick={() => setShowAll((current) => !current)}
        >
          {showAll ? 'Show trained only' : `Show all ${sorted.length}`}
        </button>
      ) : null}
    </div>
  );
}
