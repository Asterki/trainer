import { useState } from 'react';

export interface TrendPoint {
  label: string;
  value: number;
  detail?: string;
}

interface TrendChartProps {
  points: TrendPoint[];
  ariaLabel: string;
  valueFormat?: (value: number) => string;
  emptyMessage?: string;
}

export function TrendChart({
  points,
  ariaLabel,
  valueFormat = (value) => value.toLocaleString(),
  emptyMessage = 'Not enough data for a trend.',
}: TrendChartProps) {
  const [active, setActive] = useState<number | null>(null);

  if (points.length === 0) {
    return <p className="chart-empty">{emptyMessage}</p>;
  }

  if (points.length === 1) {
    const point = points[0];
    return (
      <figure className="chart chart--single">
        <p className="chart-empty">
          {emptyMessage} One session is recorded: <strong>{point.label}</strong> ·{' '}
          {point.detail ?? valueFormat(point.value)}.
        </p>
        <details className="chart-table">
          <summary>Chart data</summary>
          <table>
            <caption>{ariaLabel}</caption>
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col">Value</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">{point.label}</th>
                <td>{valueFormat(point.value)}</td>
              </tr>
            </tbody>
          </table>
        </details>
      </figure>
    );
  }

  const width = 680;
  const height = 260;
  const left = 48;
  const right = 14;
  const top = 24;
  const bottom = 42;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const max = Math.max(1, ...points.map((point) => point.value));
  const xFor = (index: number) =>
    left + (plotWidth * index) / Math.max(1, points.length - 1);
  const yFor = (value: number) => top + plotHeight - (value / max) * plotHeight;
  const line = points
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${xFor(index)} ${yFor(point.value)}`)
    .join(' ');
  const area = `${line} L ${xFor(points.length - 1)} ${top + plotHeight} L ${left} ${
    top + plotHeight
  } Z`;
  const labelEvery = points.length > 10 ? 2 : 1;
  const activePoint = active === null ? null : points[active];

  return (
    <figure className="chart">
      {activePoint ? (
        <p className="chart-tooltip" role="status">
          <strong>{activePoint.label}</strong>{' '}
          {activePoint.detail ?? valueFormat(activePoint.value)}
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
                {valueFormat(max * fraction)}
              </text>
            </g>
          );
        })}
        <path className="chart__area" d={area} />
        <path className="chart__line" d={line} />
        {points.map((point, index) => {
          const x = xFor(index);
          const y = yFor(point.value);
          return (
            <g
              key={`${point.label}-${index}`}
              className="chart__item"
              tabIndex={0}
              role="listitem"
              aria-label={`${point.label}: ${valueFormat(point.value)}`}
              onMouseEnter={() => setActive(index)}
              onMouseLeave={() => setActive(null)}
              onFocus={() => setActive(index)}
              onBlur={() => setActive(null)}
              onClick={() => setActive(index)}
            >
              <title>{`${point.label}: ${valueFormat(point.value)}`}</title>
              <circle className="chart__point" cx={x} cy={y} r={10} opacity={0} />
              <circle className="chart__point-dot" cx={x} cy={y} r={4} />
              {index % labelEvery === 0 ? (
                <text className="chart__label" x={x} y={height - 14} textAnchor="middle">
                  {point.label}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
      <details className="chart-table">
        <summary>Chart data</summary>
        <table>
          <caption>{ariaLabel}</caption>
          <thead>
            <tr>
              <th scope="col">Date</th>
              <th scope="col">Value</th>
            </tr>
          </thead>
          <tbody>
            {points.map((point, index) => (
              <tr key={`${point.label}-table-${index}`}>
                <th scope="row">{point.label}</th>
                <td>{valueFormat(point.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
