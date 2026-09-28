'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useSnapshot } from '@/lib/hooks/useSnapshot';
import { Card, CardHeader } from '@/components/Card';
import { CurrencyText } from '@/components/CurrencyText';
import { SeverityBadge, ConfidenceBadge } from '@/components/SeverityBadge';
import { EmptyState } from '@/components/EmptyState';
import { Button } from '@/components/forms';
import { Disclaimer } from '@/components/Disclaimer';
import type { Insight } from '@/lib/core/domain/types';

export default function InsightsPage() {
  const { advice, loading, isEmpty } = useSnapshot();
  const [suppressedOpen, setSuppressedOpen] = useState(false);

  if (loading) {
    return <div className="flex min-h-[50vh] items-center justify-center text-sm text-muted">Loading...</div>;
  }

  if (isEmpty || !advice) {
    return (
      <div className="space-y-4">
        <h1 className="text-lg font-semibold text-foreground">Insights</h1>
        <EmptyState
          icon="💡"
          title="Nothing to advise on yet"
          description="Add some transactions, accounts and a profile, and the advisor will rank what's worth your attention by rupee impact."
        />
      </div>
    );
  }

  return (
    <div className="space-y-4 pb-4">
      <header>
        <h1 className="text-lg font-semibold text-foreground">Insights</h1>
        <Card className="mt-2">
          <p className="text-xs text-muted">Total quantified opportunity</p>
          <CurrencyText amount={advice.totalOpportunity} variant="compact" className="text-2xl font-semibold text-foreground" />
          <p className="mt-1 text-xs text-muted">
            {advice.insights.length} active insight{advice.insights.length === 1 ? '' : 's'}, ranked by severity then rupee impact
            &mdash; not by when they were noticed.
          </p>
        </Card>
      </header>

      {advice.insights.length === 0 ? (
        <EmptyState icon="✅" title="No open insights" description="Nothing urgent right now. Check back as your data changes." />
      ) : (
        <div className="space-y-3">
          {advice.insights.map((insight) => (
            <InsightCard key={insight.id} insight={insight} />
          ))}
        </div>
      )}

      {advice.suppressed.length > 0 ? (
        <Card>
          <button className="flex w-full items-center justify-between" onClick={() => setSuppressedOpen((o) => !o)}>
            <CardHeader
              title={`Held back for now (${advice.suppressed.length})`}
              subtitle="These become relevant once the foundation items above are handled — the engine keeps them here rather than hide them entirely."
            />
            <span className="text-muted">{suppressedOpen ? '−' : '+'}</span>
          </button>
          {suppressedOpen ? (
            <div className="space-y-3">
              {advice.suppressed.map(({ insight, suppressedBy }) => (
                <div key={insight.id} className="opacity-70">
                  <InsightCard insight={insight} note={`Held back by: ${suppressedBy}`} />
                </div>
              ))}
            </div>
          ) : null}
        </Card>
      ) : null}

      {advice.errors.length > 0 ? (
        <p className="text-xs text-muted">
          {advice.errors.length} advisor rule{advice.errors.length === 1 ? '' : 's'} could not run this time; the rest of your
          insights are still shown.
        </p>
      ) : null}

      <Disclaimer />
    </div>
  );
}

function InsightCard({ insight, note }: { insight: Insight; note?: string }) {
  return (
    <Card>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <SeverityBadge severity={insight.severity} />
        <ConfidenceBadge confidence={insight.confidence} />
      </div>
      <h3 className="text-sm font-semibold text-foreground">{insight.headline}</h3>
      <p className="mt-1.5 text-sm leading-relaxed text-muted">{insight.reasoning}</p>

      <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
        {insight.impact.amountPaise > 0 ? (
          <span className="text-foreground">
            Worth <CurrencyText amount={insight.impact.amountPaise} variant="compact" /> over {insight.impact.horizonMonths} months
          </span>
        ) : null}
      </div>

      {insight.evidence.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {insight.evidence.map((e) => (
            <span key={`${e.kind}:${e.id}`} className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted">
              {e.label}
            </span>
          ))}
        </div>
      ) : null}

      {note ? <p className="mt-2 text-[11px] italic text-muted">{note}</p> : null}

      {insight.action ? (
        <div className="mt-3">
          <ActionLink action={insight.action} />
        </div>
      ) : null}
    </Card>
  );
}

const ACTION_ROUTE: Record<string, string> = {
  open_debt_planner: '/debt',
  simulate_prepayment: '/debt',
  set_budget: '/transactions',
  create_goal: '/goals',
  review_subscription: '/transactions',
  increase_sip: '/goals',
  build_emergency_fund: '/goals',
  review_transaction: '/transactions',
  update_profile: '/settings',
  review_insurance: '/settings',
  optimise_tax: '/settings',
};

function ActionLink({ action }: { action: NonNullable<Insight['action']> }) {
  const href = ACTION_ROUTE[action.kind] ?? '/';
  return (
    <Link href={href}>
      <Button variant="secondary">{action.label}</Button>
    </Link>
  );
}
