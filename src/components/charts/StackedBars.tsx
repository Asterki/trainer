import { useState } from 'react';

export interface StackedBarDatum {
  label: string;
  completed: number;
  skipped: number;
}

interface StackedBarsProps {
  data: StackedBarDatum[];
  ariaLabel: string;
}

export function StackedBars({ data, ariaLabel }: StackedBarsProps) {
  const [active, setActive] = useState<number | null>(null);
  const max = Math.max(1, ...data.map((datum) => datum.completed + datum.skipped));

  if (data.every((datum) => datum.completed + datum.skipped === 0)) {
    return <p className="chart-empty">No scheduled outcomes in this range.</p>;
  }

  const width = 680;
  const height = 250;
  const left = 40;
  const right = 10;
  const top = 24;
  const bottom = 38;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const groupWidth = plotWidth / data.length;
  const barWidth = Math.min(42, groupWidth * 0.58);
  const labelEvery = data.length > 10 ? 2 : 1;
  const activeDatum = active === null ? null : data[active];

  return (
    <figure className="chart">
      {activeDatum ? (
        <p className="chart-tooltip" role="status">
          <strong>{activeDatum.label}</strong> · {activeDatum.completed} completed ·{' '}
          {activeDatum.skipped} skipped
        </p>
      ) : null}
      <svg
        className="chart__svg"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={ariaLabel}
      >
        {[0, 0.5, 1].map((fraction) => {
          const y = top + plotHeight - plotHeight * fraction;
          return (
            <g key={fraction}>
              <line className="chart__grid" x1={left} x2={width - right} y1={y} y2={y} />
              <text className="chart__axis" x={left - 8} y={y + 4} textAnchor="end">
                {Math.round(max * fraction)}
              </text>
            </g>
          );
        })}
        {data.map((datum, index) => {
          const total = datum.completed + datum.skipped;
          const x = left + groupWidth * index + (groupWidth - barWidth) / 2;
          const completedHeight = (datum.completed / max) * plotHeight;
          const skippedHeight = (datum.skipped / max) * plotHeight;
          const completedY = top + plotHeight - completedHeight;
          const skippedY = completedY - skippedHeight;
          return (
            <g
              key={`${datum.label}-${index}`}
              className="chart__item"
              tabIndex={0}
              role="listitem"
              aria-label={`${datum.label}: ${datum.completed} completed, ${datum.skipped} skipped`}
              onMouseEnter={() => setActive(index)}
              onMouseLeave={() => setActive(null)}
              onFocus={() => setActive(index)}
              onBlur={() => setActive(null)}
            >
              <title>{`${datum.label}: ${datum.completed} completed, ${datum.skipped} skipped`}</title>
              <rect
                className="chart__bar"
                x={x}
                y={completedY}
                width={barWidth}
                height={completedHeight}
                rx={datum.skipped > 0 ? 0 : 4}
                fill="var(--success)"
              />
              <rect
                className="chart__bar"
                x={x}
                y={skippedY}
                width={barWidth}
                height={skippedHeight}
                rx={4}
                fill="var(--danger)"
              />
              {data.length <= 10 && total > 0 ? (
                <text
                  className="chart__value"
                  x={x + barWidth / 2}
                  y={skippedY - 6}
                  textAnchor="middle"
                >
                  {total}
                </text>
              ) : null}
              {index % labelEvery === 0 ? (
                <text
                  className="chart__label"
                  x={x + barWidth / 2}
                  y={height - 12}
                  textAnchor="middle"
                >
                  {datum.label}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
      <p className="chart__legend">
        <span>
          <span className="chart__swatch chart__swatch--success" /> Completed
        </span>
        <span>
          <span className="chart__swatch chart__swatch--danger" /> Skipped
        </span>
      </p>
      <details className="chart-table">
        <summary>View data table</summary>
        <table>
          <caption>{ariaLabel}</caption>
          <thead>
            <tr>
              <th scope="col">Week</th>
              <th scope="col">Completed</th>
              <th scope="col">Skipped</th>
            </tr>
          </thead>
          <tbody>
            {data.map((datum, index) => (
              <tr key={`${datum.label}-table-${index}`}>
                <th scope="row">{datum.label}</th>
                <td>{datum.completed}</td>
                <td>{datum.skipped}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
