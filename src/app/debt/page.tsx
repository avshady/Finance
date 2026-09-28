'use client';

import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { getDb } from '@/lib/core/db';
import {
  compareStrategies,
  evaluateRefinance,
  interestShareOfNextEmi,
  nextEmiDate,
  remainingSchedule,
  simulateExtraMonthly,
  simulatePrepayment,
} from '@/lib/core/emi';
import { fromRupees, paise, ZERO } from '@/lib/core/domain/money';
import type { Loan } from '@/lib/core/domain/types';
import type { ReactNode } from 'react';
import { Card, CardHeader } from '@/components/Card';
import { CurrencyText } from '@/components/CurrencyText';
import { ProgressBar } from '@/components/ProgressBar';
import { EmptyState } from '@/components/EmptyState';
import { Button, Field, SelectInput, TextInput } from '@/components/forms';
import { Disclaimer } from '@/components/Disclaimer';

function pct(value: number, digits = 1): string {
  return `${(value * 100).toFixed(digits)}%`;
}

export default function DebtPage() {
  const db = getDb();
  const loans = useLiveQuery(() => db.loans.toArray(), []);
  const active = useMemo(() => (loans ?? []).filter((l) => !l.closed), [loans]);
  const [selectedLoanId, setSelectedLoanId] = useState<string | null>(null);

  const loading = loans === undefined;
  // Today, for anchoring the "next EMI" date so it is never reported in the past.
  const today = new Date().toISOString().slice(0, 10);
  const selectedLoan = active.find((l) => l.id === selectedLoanId) ?? active[0] ?? null;

  if (loading) {
    return <div className="flex min-h-[50vh] items-center justify-center text-sm text-muted">Loading...</div>;
  }

  if (active.length === 0) {
    return (
      <div className="space-y-4">
        <h1 className="text-lg font-semibold text-foreground">Debt</h1>
        <EmptyState
          icon="🏦"
          title="No loans tracked yet"
          description="Add a loan in Settings or via CSV import to see your payoff plan, prepayment simulator and amortization schedule."
        />
      </div>
    );
  }

  return (
    <div className="space-y-5 pb-4">
      <h1 className="text-lg font-semibold text-foreground">Debt</h1>

      <div className="space-y-3">
        {active.map((loan) => (
          <LoanCard
            key={loan.id}
            loan={loan}
            selected={loan.id === selectedLoan?.id}
            onSelect={() => setSelectedLoanId(loan.id)}
            asOfDate={today}
          />
        ))}
      </div>

      {selectedLoan ? (
        <>
          <PrepaymentSimulator loan={selectedLoan} />
          <AmortizationTable loan={selectedLoan} />
          <RefinanceChecker loan={selectedLoan} />
        </>
      ) : null}

      {active.length > 1 ? <StrategyComparisonCard loans={active} /> : null}

      <Disclaimer />
    </div>
  );
}

function LoanCard({
  loan,
  selected,
  onSelect,
  asOfDate,
}: {
  loan: Loan;
  selected: boolean;
  onSelect: () => void;
  /** Today, as an ISO date. Keeps the "next EMI" from being reported in the past. */
  asOfDate: string;
}) {
  const progress = loan.tenureMonths > 0 ? loan.paidInstalments / loan.tenureMonths : 0;
  const monthsLeft = Math.max(loan.tenureMonths - loan.paidInstalments, 0);
  const interestShare = interestShareOfNextEmi(loan);
  const date = nextEmiDate(loan, asOfDate);

  return (
    <button onClick={onSelect} className="block w-full text-left">
      <Card className={selected ? 'border-accent' : ''}>
        <div className="mb-2 flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-foreground">{loan.name}</p>
            <p className="text-xs text-muted">
              {loan.lender ?? loan.kind} &middot; {pct(loan.annualRate)} {loan.rateType}
            </p>
          </div>
          <div className="text-right">
            <CurrencyText amount={loan.outstanding} variant="compact" className="text-sm font-semibold text-foreground" />
            <p className="text-xs text-muted">outstanding</p>
          </div>
        </div>

        <ProgressBar value={progress} tone="accent" />
        <div className="mt-1 flex justify-between text-xs text-muted">
          <span>{loan.paidInstalments} of {loan.tenureMonths} instalments</span>
          <span>{monthsLeft} months left</span>
        </div>

        <div className="mt-3 flex items-center justify-between rounded-lg bg-surface-raised px-3 py-2">
          <span className="text-xs text-muted">Next EMI, {new Date(date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</span>
          <CurrencyText amount={loan.emiAmount} variant="short" className="text-sm font-medium text-foreground" />
        </div>
        {interestShare !== null ? (
          <p className="mt-2 text-xs text-warning">
            <CurrencyText amount={paise(Math.round(loan.emiAmount * interestShare))} variant="short" /> of your next{' '}
            <CurrencyText amount={loan.emiAmount} variant="short" /> EMI is interest ({pct(interestShare, 0)}).
          </p>
        ) : null}
      </Card>
    </button>
  );
}

function PrepaymentSimulator({ loan }: { loan: Loan }) {
  const [mode, setMode] = useState<'lumpsum' | 'monthly'>('lumpsum');
  const maxLump = Math.max(Math.round(loan.outstanding / 100), 1000);
  const [lumpsum, setLumpsum] = useState(Math.min(100000, maxLump));
  const [extraMonthly, setExtraMonthly] = useState(5000);

  const result = useMemo(() => {
    try {
      return mode === 'lumpsum'
        ? simulatePrepayment(loan, fromRupees(lumpsum))
        : simulateExtraMonthly(loan, fromRupees(extraMonthly));
    } catch {
      return null;
    }
  }, [loan, mode, lumpsum, extraMonthly]);

  return (
    <Card>
      <CardHeader title="Prepayment simulator" subtitle="See the real effect of putting extra money against this loan, before you do it." />
      <div className="mb-3 flex gap-2">
        <Button variant={mode === 'lumpsum' ? 'primary' : 'secondary'} onClick={() => setMode('lumpsum')}>
          Lump sum
        </Button>
        <Button variant={mode === 'monthly' ? 'primary' : 'secondary'} onClick={() => setMode('monthly')}>
          Extra monthly
        </Button>
      </div>

      {mode === 'lumpsum' ? (
        <Field label={`One-time prepayment: ₹${lumpsum.toLocaleString('en-IN')}`}>
          <input
            type="range"
            min={0}
            max={maxLump}
            step={Math.max(1000, Math.round(maxLump / 200))}
            value={lumpsum}
            onChange={(e) => setLumpsum(Number(e.target.value))}
            className="w-full accent-[rgb(var(--color-accent))]"
          />
        </Field>
      ) : (
        <Field label={`Extra every month: ₹${extraMonthly.toLocaleString('en-IN')}`}>
          <input
            type="range"
            min={0}
            max={Math.max(50000, Math.round((loan.emiAmount / 100) * 2))}
            step={500}
            value={extraMonthly}
            onChange={(e) => setExtraMonthly(Number(e.target.value))}
            className="w-full accent-[rgb(var(--color-accent))]"
          />
        </Field>
      )}

      {result ? (
        <div className="mt-3 grid grid-cols-2 gap-3">
          <Stat label="Interest saved" value={<CurrencyText amount={result.interestSaved} variant="compact" className="text-positive" />} />
          <Stat label="Months saved" value={`${result.monthsSaved}`} />
          <Stat label="New payoff date" value={new Date(result.newPayoffDate).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })} />
          <Stat
            label="Implied annual return"
            value={Number.isFinite(result.impliedAnnualReturn) ? pct(result.impliedAnnualReturn) : '—'}
          />
        </div>
      ) : (
        <p className="text-xs text-muted">Adjust the amount to see the effect.</p>
      )}
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <p className="text-xs text-muted">{label}</p>
      <p className="text-sm font-semibold text-foreground">{value}</p>
    </div>
  );
}

function AmortizationTable({ loan }: { loan: Loan }) {
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(0);
  const pageSize = 12;
  const schedule = useMemo(() => remainingSchedule(loan), [loan]);
  const rows = schedule.rows.slice(page * pageSize, page * pageSize + pageSize);
  const pageCount = Math.ceil(schedule.rows.length / pageSize);

  return (
    <Card>
      <button className="flex w-full items-center justify-between" onClick={() => setOpen((o) => !o)}>
        <CardHeader title="Amortization schedule" subtitle={`${schedule.months} instalments remaining`} />
        <span className="text-muted">{open ? '−' : '+'}</span>
      </button>
      {open ? (
        <>
          <div className="mb-2 text-xs text-muted">
            Total remaining interest: <CurrencyText amount={schedule.totalInterest} variant="compact" />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="text-muted">
                  <th className="py-1 pr-2 font-medium">#</th>
                  <th className="py-1 pr-2 font-medium">Date</th>
                  <th className="py-1 pr-2 font-medium">Payment</th>
                  <th className="py-1 pr-2 font-medium">Interest</th>
                  <th className="py-1 pr-2 font-medium">Principal</th>
                  <th className="py-1 font-medium">Balance</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.instalment} className="border-t border-border text-foreground">
                    <td className="py-1 pr-2 tabular-nums">{r.instalment}</td>
                    <td className="py-1 pr-2 tabular-nums">{r.date}</td>
                    <td className="py-1 pr-2 tabular-nums"><CurrencyText amount={r.payment} variant="short" /></td>
                    <td className="py-1 pr-2 tabular-nums text-warning"><CurrencyText amount={r.interest} variant="short" /></td>
                    <td className="py-1 pr-2 tabular-nums text-positive"><CurrencyText amount={r.principal} variant="short" /></td>
                    <td className="py-1 tabular-nums"><CurrencyText amount={r.balance} variant="short" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {pageCount > 1 ? (
            <div className="mt-2 flex items-center justify-between text-xs">
              <Button variant="ghost" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0}>
                Prev
              </Button>
              <span className="text-muted">Page {page + 1} of {pageCount}</span>
              <Button variant="ghost" onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))} disabled={page >= pageCount - 1}>
                Next
              </Button>
            </div>
          ) : null}
        </>
      ) : null}
    </Card>
  );
}

function RefinanceChecker({ loan }: { loan: Loan }) {
  const [newRate, setNewRate] = useState((loan.annualRate * 100 - 0.5).toFixed(2));
  const [fee, setFee] = useState('0');

  const result = useMemo(() => {
    const rate = Number(newRate) / 100;
    if (!Number.isFinite(rate) || rate <= 0) return null;
    const feeAmount = Number(fee);
    try {
      return evaluateRefinance(loan, rate, {
        processingFee: Number.isFinite(feeAmount) ? fromRupees(feeAmount) : ZERO,
      });
    } catch {
      return null;
    }
  }, [loan, newRate, fee]);

  return (
    <Card>
      <CardHeader title="Refinance checker" subtitle="Would switching lenders actually pay off, net of fees?" />
      <div className="grid grid-cols-2 gap-3">
        <Field label="New annual rate (%)">
          <TextInput type="number" step="0.05" value={newRate} onChange={(e) => setNewRate(e.target.value)} />
        </Field>
        <Field label="Processing fee (₹)">
          <TextInput type="number" step="500" value={fee} onChange={(e) => setFee(e.target.value)} />
        </Field>
      </div>
      {result ? (
        <div className="mt-2 space-y-2">
          <div className="grid grid-cols-2 gap-3">
            <Stat label="Net saving" value={<CurrencyText amount={result.netSaving} variant="compact" className={result.netSaving > 0 ? 'text-positive' : 'text-negative'} />} />
            <Stat label="New EMI" value={<CurrencyText amount={result.newEmi} variant="short" />} />
            <Stat label="Break-even" value={result.breakEvenMonths === null ? 'Immediate' : `${result.breakEvenMonths} months`} />
            <Stat label="Verdict" value={result.worthIt ? 'Worth it' : 'Not worth it'} />
          </div>
        </div>
      ) : null}
    </Card>
  );
}

function StrategyComparisonCard({ loans }: { loans: Loan[] }) {
  const [surplus, setSurplus] = useState(10000);
  const comparison = useMemo(() => {
    try {
      return compareStrategies(loans, fromRupees(surplus));
    } catch {
      return null;
    }
  }, [loans, surplus]);

  if (!comparison) return null;

  return (
    <Card>
      <CardHeader title="Payoff strategy: avalanche vs snowball" subtitle="Same monthly surplus, different targeting order." />
      <Field label={`Monthly surplus to throw at debt: ₹${surplus.toLocaleString('en-IN')}`}>
        <input
          type="range"
          min={0}
          max={100000}
          step={500}
          value={surplus}
          onChange={(e) => setSurplus(Number(e.target.value))}
          className="w-full accent-[rgb(var(--color-accent))]"
        />
      </Field>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <div className={`rounded-lg border p-3 ${comparison.recommendation === 'avalanche' ? 'border-accent' : 'border-border'}`}>
          <p className="text-xs font-medium text-muted">Avalanche (optimal)</p>
          <p className="mt-1 text-sm font-semibold text-foreground">{comparison.avalanche.debtFreeInMonths} months to debt-free</p>
          <CurrencyText amount={comparison.avalanche.totalInterest} variant="compact" className="text-xs text-muted" />
        </div>
        <div className={`rounded-lg border p-3 ${comparison.recommendation === 'snowball' ? 'border-accent' : 'border-border'}`}>
          <p className="text-xs font-medium text-muted">Snowball (easier)</p>
          <p className="mt-1 text-sm font-semibold text-foreground">{comparison.snowball.debtFreeInMonths} months to debt-free</p>
          <CurrencyText amount={comparison.snowball.totalInterest} variant="compact" className="text-xs text-muted" />
        </div>
      </div>
      <p className="mt-3 text-xs text-muted">
        Cost of choosing snowball: <CurrencyText amount={comparison.snowballExtraCost} variant="compact" className="text-warning" /> in extra interest
        {comparison.snowballExtraMonths !== 0 ? `, ${Math.abs(comparison.snowballExtraMonths)} months ${comparison.snowballExtraMonths > 0 ? 'later' : 'sooner'}` : ''}.
      </p>
      <p className="mt-2 text-sm text-foreground">{comparison.reasoning}</p>
    </Card>
  );
}
