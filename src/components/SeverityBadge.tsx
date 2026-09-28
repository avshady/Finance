import type { InsightSeverity, Confidence } from '@/lib/core/domain/types';

const SEVERITY_STYLE: Record<InsightSeverity, { bg: string; text: string; label: string; icon: string }> = {
  critical: { bg: 'bg-negative/15', text: 'text-negative', label: 'Critical', icon: '⚠' },
  high: { bg: 'bg-warning/15', text: 'text-warning', label: 'High', icon: '▲' },
  medium: { bg: 'bg-accent/15', text: 'text-accent', label: 'Medium', icon: '●' },
  low: { bg: 'bg-muted/15', text: 'text-muted', label: 'Low', icon: '○' },
  positive: { bg: 'bg-positive/15', text: 'text-positive', label: 'On track', icon: '✓' },
};

/** Severity is never conveyed by colour alone: label + icon always accompany it. */
export function SeverityBadge({ severity }: { severity: InsightSeverity }) {
  const s = SEVERITY_STYLE[severity];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${s.bg} ${s.text}`}
    >
      <span aria-hidden="true">{s.icon}</span>
      {s.label}
    </span>
  );
}

const CONFIDENCE_LABEL: Record<Confidence, string> = {
  high: 'High confidence',
  medium: 'Medium confidence',
  low: 'Low confidence',
};

export function ConfidenceBadge({ confidence }: { confidence: Confidence }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-xs text-muted">
      {CONFIDENCE_LABEL[confidence]}
    </span>
  );
}
