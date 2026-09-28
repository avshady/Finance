import type { ReactNode } from 'react';

interface ProgressBarProps {
  /** 0..1 */
  value: number;
  tone?: 'accent' | 'positive' | 'warning' | 'negative';
  label?: string;
  className?: string;
}

const TONE_BG: Record<NonNullable<ProgressBarProps['tone']>, string> = {
  accent: 'bg-accent',
  positive: 'bg-positive',
  warning: 'bg-warning',
  negative: 'bg-negative',
};

export function ProgressBar({ value, tone = 'accent', label, className = '' }: ProgressBarProps) {
  const pct = Math.min(Math.max(value, 0), 1) * 100;
  return (
    <div className={className}>
      {label ? (
        <div className="mb-1 flex items-center justify-between text-xs text-muted">
          <span>{label}</span>
          <span className="tabular-nums">{Math.round(pct)}%</span>
        </div>
      ) : null}
      <div
        className="h-2 w-full overflow-hidden rounded-full bg-surface-raised"
        role="progressbar"
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className={`h-full rounded-full ${TONE_BG[tone]} transition-[width] motion-reduce:transition-none`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

/** A ring variant for goal/FI progress, using SVG so it stays legible in dark mode. */
export function ProgressRing({
  value,
  size = 72,
  strokeWidth = 8,
  tone = 'accent',
  children,
}: {
  value: number;
  size?: number;
  strokeWidth?: number;
  tone?: NonNullable<ProgressBarProps['tone']>;
  children?: ReactNode;
}) {
  const clamped = Math.min(Math.max(value, 0), 1);
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - clamped);
  const colorVar: Record<string, string> = {
    accent: 'rgb(var(--color-accent))',
    positive: 'rgb(var(--color-positive))',
    warning: 'rgb(var(--color-warning))',
    negative: 'rgb(var(--color-negative))',
  };
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="rgb(var(--color-surface-raised))"
          strokeWidth={strokeWidth}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={colorVar[tone]}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="transition-[stroke-dashoffset] motion-reduce:transition-none"
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center text-xs font-semibold text-foreground">
        {children ?? `${Math.round(clamped * 100)}%`}
      </div>
    </div>
  );
}
