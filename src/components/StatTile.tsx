import type { ReactNode } from 'react';
import { Card } from './Card';

interface StatTileProps {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: 'neutral' | 'positive' | 'negative' | 'warning';
}

const TONE_CLASS: Record<NonNullable<StatTileProps['tone']>, string> = {
  neutral: 'text-foreground',
  positive: 'text-positive',
  negative: 'text-negative',
  warning: 'text-warning',
};

export function StatTile({ label, value, sub, tone = 'neutral' }: StatTileProps) {
  return (
    <Card className="flex flex-col gap-1">
      <span className="text-xs text-muted">{label}</span>
      <span className={`text-xl font-semibold tabular-nums ${TONE_CLASS[tone]}`}>{value}</span>
      {sub ? <span className="text-xs text-muted">{sub}</span> : null}
    </Card>
  );
}
