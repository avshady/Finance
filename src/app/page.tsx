'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { useSnapshot } from '@/lib/hooks/useSnapshot';
import { Card, CardHeader } from '@/components/Card';
import { StatTile } from '@/components/StatTile';
import { CurrencyText } from '@/components/CurrencyText';
import { Sparkline } from '@/components/Sparkline';
import { ProgressBar } from '@/components/ProgressBar';
import { SeverityBadge } from '@/components/SeverityBadge';
import { EmptyState } from '@/components/EmptyState';
import { Disclaimer } from '@/components/Disclaimer';
import { Button } from '@/components/forms';
import { cashflowSeries, spendingVelocity } from '@/lib/core/analytics';
import { projectTrajectory } from '@/lib/core/wealth';
import { nextEmiDate } from '@/lib/core/emi';
import { toRupees, ZERO, sum, type Paise } from '@/lib/core/domain/money';

function daysUntil(iso: string, asOf: string): number {
  const ms = Date.parse(iso) - Date.parse(asOf);
  return Math.round(ms / 86_400_000);
}

export default function DashboardPage() {
  const { snapshot, advice, loading, isEmpty } = useSnapshot();

  const trajectory = useMemo(() => {
    if (!snapshot) return [];
    const activeLoans = snapshot.loans.filter((l) => !l.closed);
    const totalDebt = sum(activeLoans.map((l) => l.outstanding));
    const weightedRate =
      totalDebt === 0
        ? 0
        : activeLoans.reduce((acc, l) => acc + (l.outstanding / totalDebt) * l.annualRate, 0);
    const savings =
      snapshot.metrics.savingsRate === null
        ? ZERO
        : ((snapshot.metrics.monthlyIncome - snapshot.metrics.monthlyExpenses) as Paise);
    return projectTrajectory({
      startingCorpus: snapshot.metrics.totalAssets,
      monthlySavings: savings > 0 ? savings : ZERO,
      annualReturn: snapshot.profile.expectedPortfolioReturn,
      startingDebt: totalDebt,
      debtMonthlyPayment: snapshot.metrics.totalMonthlyEmi,
      debtAnnualRate: weightedRate,
      months: 24,
      currentYear: new Date(snapshot.asOf).getUTCFullYear(),
      inflation: snapshot.profile.assumedInflation,
    });
  }, [snapshot]);

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center text-sm text-muted">Loading your data...</div>
    );
  }

  if (isEmpty || !snapshot) {
    return (
      <div className="mx-auto max-w-lg space-y-4">
        <EmptyState
          icon="👋"
          title="Welcome to WealthWise"
          description="There's nothing here yet. Add a transaction, import a bank statement, or load demo data to see your dashboard come alive."
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Link href="/transactions">
                <Button variant="primary">Add a transaction</Button>
              </Link>
              <Link href="/connectors">
                <Button variant="secondary">Import a CSV</Button>
              </Link>
            </div>
          }
        />
        <Disclaimer className="text-center" />
      </div>
    );
  }

  const cashflow = cashflowSeries(snapshot.transactions, 12, snapshot.asOf);
  const velocity = spendingVelocity(snapshot.transactions, snapshot.budgets, snapshot.asOf);
  const upcomingEmis = snapshot.loans
    .filter((l) => !l.closed)
    .map((l) => ({ loan: l, date: nextEmiDate(l) }))
    .sort((a, b) => Date.parse(a.date) - Date.parse(b.date))
    .slice(0, 4);

  const maxCashflow = Math.max(1, ...cashflow.flatMap((c) => [c.income, c.expense].map(toRupees)));
  const categoriesById = new Map(snapshot.categories.map((c) => [c.id, c]));

  return (
    <div className="space-y-5 pb-4">
      <header>
        <h1 className="text-lg font-semibold text-foreground">Dashboard</h1>
        <p className="text-xs text-muted">As of {new Date(snapshot.asOf).toLocaleDateString('en-IN')}</p>
      </header>

      <Card>
        <div className="flex items-start justify-between gap-4">
          <div>
            <span className="text-xs text-muted">Net worth</span>
            <div className="mt-1 text-2xl font-semibold tabular-nums text-foreground">
              <CurrencyText amount={snapshot.metrics.netWorth} variant="compact" />
            </div>
            <div className="mt-1 flex gap-3 text-xs text-muted">
              <span>
                Assets <CurrencyText amount={snapshot.metrics.totalAssets} variant="compact" />
              </span>
              <span>
                Liabilities <CurrencyText amount={snapshot.metrics.totalLiabilities} variant="compact" />
              </span>
            </div>
          </div>
          {trajectory.length > 1 ? (
            <div className="flex flex-col items-end gap-1">
              <Sparkline values={trajectory.map((p) => toRupees(p.netWorth))} width={110} height={36} />
              <span className="text-[10px] text-muted">2yr projected trend</span>
            </div>
          ) : null}
        </div>
      </Card>

      <div className="grid grid-cols-3 gap-3">
        <StatTile label="Income (median/mo)" value={<CurrencyText amount={snapshot.metrics.monthlyIncome} variant="compact" />} />
        <StatTile
          label="Expenses (median/mo)"
          value={<CurrencyText amount={snapshot.metrics.monthlyExpenses} variant="compact" />}
        />
        <StatTile
          label="Savings rate"
          value={snapshot.metrics.savingsRate === null ? '—' : `${Math.round(snapshot.metrics.savingsRate * 100)}%`}
          tone={
            snapshot.metrics.savingsRate === null
              ? 'neutral'
              : snapshot.metrics.savingsRate >= 0.2
                ? 'positive'
                : snapshot.metrics.savingsRate >= 0
                  ? 'warning'
                  : 'negative'
          }
        />
      </div>

      {cashflow.length > 0 ? (
        <Card>
          <CardHeader title="Cashflow, last 12 months" />
          <div className="flex h-32 items-end gap-1.5 overflow-x-auto">
            {cashflow.map((c) => (
              <div key={c.month} className="flex flex-1 min-w-[18px] flex-col items-center justify-end gap-0.5" title={c.month}>
                <div className="flex h-24 w-full items-end justify-center gap-0.5">
                  <div
                    className="w-2 rounded-t bg-positive"
                    style={{ height: `${Math.max(2, (toRupees(c.income) / maxCashflow) * 100)}%` }}
                  />
                  <div
                    className="w-2 rounded-t bg-negative"
                    style={{ height: `${Math.max(2, (toRupees(c.expense) / maxCashflow) * 100)}%` }}
                  />
                </div>
                <span className="text-[9px] text-muted">{c.month.slice(5)}</span>
              </div>
            ))}
          </div>
          <div className="mt-2 flex gap-3 text-[10px] text-muted">
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-positive" /> Income
            </span>
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-negative" /> Expense
            </span>
          </div>
        </Card>
      ) : null}

      {advice && advice.insights.length > 0 ? (
        <Card>
          <CardHeader
            title="Top insights"
            subtitle={
              <>
                {advice.insights.length} total &middot; worth{' '}
                <CurrencyText amount={advice.totalOpportunity} variant="compact" />
              </>
            }
            action={
              <Link href="/insights" className="text-xs text-accent hover:underline">
                See all
              </Link>
            }
          />
          <div className="space-y-2">
            {advice.insights.slice(0, 3).map((insight) => (
              <Link
                key={insight.id}
                href="/insights"
                className="block rounded-lg border border-border p-3 hover:bg-surface-raised"
              >
                <div className="mb-1 flex items-center justify-between gap-2">
                  <SeverityBadge severity={insight.severity} />
                  {insight.impact.amountPaise > 0 ? (
                    <CurrencyText amount={insight.impact.amountPaise} variant="compact" className="text-xs text-muted" />
                  ) : null}
                </div>
                <p className="text-sm font-medium text-foreground">{insight.headline}</p>
              </Link>
            ))}
          </div>
        </Card>
      ) : null}

      {upcomingEmis.length > 0 ? (
        <Card>
          <CardHeader title="Upcoming EMIs" action={<Link href="/debt" className="text-xs text-accent hover:underline">Manage</Link>} />
          <div className="space-y-2">
            {upcomingEmis.map(({ loan, date }) => {
              const d = daysUntil(date, snapshot.asOf);
              return (
                <div key={loan.id} className="flex items-center justify-between text-sm">
                  <span className="text-foreground">{loan.name}</span>
                  <div className="flex items-center gap-2">
                    <CurrencyText amount={loan.emiAmount} variant="short" className="text-muted" />
                    <span className={`text-xs ${d <= 3 ? 'text-warning' : 'text-muted'}`}>
                      in {d} {d === 1 ? 'day' : 'days'}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      ) : null}

      {velocity.length > 0 ? (
        <Card>
          <CardHeader title="Budget pace this month" />
          <div className="space-y-3">
            {velocity.map((v) => {
              const cat = categoriesById.get(v.categoryId);
              return (
                <ProgressBar
                  key={v.categoryId}
                  value={v.paceRatio}
                  tone={v.willExceed ? 'negative' : v.paceRatio > 0.85 ? 'warning' : 'positive'}
                  label={`${cat?.name ?? v.categoryId} — projected ${new Intl.NumberFormat('en-IN', {
                    style: 'currency',
                    currency: 'INR',
                    maximumFractionDigits: 0,
                  }).format(toRupees(v.projectedMonthEnd))} of limit`}
                />
              );
            })}
          </div>
        </Card>
      ) : null}

      <Disclaimer />
    </div>
  );
}
