import type { ReactNode } from 'react';
import { Card } from './Card';

interface EmptyStateProps {
  icon?: string;
  title: string;
  description: string;
  action?: ReactNode;
}

/** A genuine empty state — used instead of a wall of zeros, which reads as broken. */
export function EmptyState({ icon = '✨', title, description, action }: EmptyStateProps) {
  return (
    <Card className="flex flex-col items-center gap-2 py-10 text-center">
      <span className="text-3xl" aria-hidden="true">
        {icon}
      </span>
      <h3 className="text-base font-semibold text-foreground">{title}</h3>
      <p className="max-w-sm text-sm text-muted">{description}</p>
      {action ? <div className="mt-3">{action}</div> : null}
    </Card>
  );
}
