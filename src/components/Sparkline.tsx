interface SparklineProps {
  values: number[];
  width?: number;
  height?: number;
  tone?: 'accent' | 'positive' | 'negative' | 'warning';
  className?: string;
}

const TONE_COLOR: Record<NonNullable<SparklineProps['tone']>, string> = {
  accent: 'rgb(var(--color-accent))',
  positive: 'rgb(var(--color-positive))',
  negative: 'rgb(var(--color-negative))',
  warning: 'rgb(var(--color-warning))',
};

/** Minimal inline trend line — used for the net-worth trajectory on the dashboard. */
export function Sparkline({ values, width = 120, height = 32, tone = 'accent', className = '' }: SparklineProps) {
  if (values.length < 2) {
    return <div className={className} style={{ width, height }} aria-hidden="true" />;
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const step = width / (values.length - 1);
  const points = values
    .map((v, i) => {
      const x = i * step;
      const y = height - ((v - min) / range) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  const last = values[values.length - 1] ?? 0;
  const first = values[0] ?? 0;
  const color = last >= first ? TONE_COLOR.positive : TONE_COLOR.negative;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      role="img"
      aria-label={`Trend from ${first.toFixed(0)} to ${last.toFixed(0)}`}
    >
      <polyline points={points} fill="none" stroke={tone === 'accent' ? color : TONE_COLOR[tone]} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
