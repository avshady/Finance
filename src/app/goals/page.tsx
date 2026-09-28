'use client';

import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { getDb, saveGoal, deleteGoal } from '@/lib/core/db';
import { useSnapshot } from '@/lib/hooks/useSnapshot';
import { assessGoal, projectFi } from '@/lib/core/wealth';
import { fromRupees, subtract, ZERO } from '@/lib/core/domain/money';
import type { Goal, GoalKind } from '@/lib/core/domain/types';
import { Card, CardHeader } from '@/components/Card';
import { CurrencyText } from '@/components/CurrencyText';
import { ProgressBar, ProgressRing } from '@/components/ProgressBar';
import { EmptyState } from '@/components/EmptyState';
import { Sheet } from '@/components/Sheet';
import { Button, Field, SelectInput, TextInput } from '@/components/forms';
import { Disclaimer } from '@/components/Disclaimer';

const GOAL_KINDS: GoalKind[] = [
  'emergency_fund', 'retirement', 'house', 'vehicle', 'education', 'wedding', 'travel', 'debt_free', 'custom',
];

function newId(): string {
  return `goal_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export default function GoalsPage() {
  const db = getDb();
  const goals = useLiveQuery(() => db.goals.toArray(), []);
  const { snapshot, loading: snapshotLoading } = useSnapshot();
  const [editing, setEditing] = useState<Goal | null>(null);
  const [creating, setCreating] = useState(false);

  const loading = goals === undefined || snapshotLoading;

  const fi = useMemo(() => {
    if (!snapshot) return null;
    const annualExpenses = fromRupees(Math.max((snapshot.metrics.monthlyExpenses / 100) * 12, 0));
    const surplus = subtract(snapshot.metrics.monthlyIncome, snapshot.metrics.monthlyExpenses);
    const monthlyContribution = surplus > 0 ? surplus : ZERO;
    return projectFi({
      annualExpenses,
      currentCorpus: snapshot.metrics.totalAssets,
      monthlyContribution,
      nominalReturn: snapshot.profile.expectedPortfolioReturn,
      inflation: snapshot.profile.assumedInflation,
      currentYear: new Date(snapshot.asOf).getUTCFullYear(),
    });
  }, [snapshot]);

  if (loading) {
    return <div className="flex min-h-[50vh] items-center justify-center text-sm text-muted">Loading...</div>;
  }

  return (
    <div className="space-y-4 pb-4">
      <header className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-foreground">Goals</h1>
        <Button onClick={() => setCreating(true)}>+ New goal</Button>
      </header>

      {fi && snapshot ? (
        <Card>
          <CardHeader
            title="Financial independence"
            subtitle={`Real return assumed: ${(fi.realRate * 100).toFixed(1)}% (nominal ${(snapshot.profile.expectedPortfolioReturn * 100).toFixed(1)}% − inflation ${(snapshot.profile.assumedInflation * 100).toFixed(1)}%)`}
          />
          <div className="flex items-center gap-4">
            <ProgressRing value={fi.progress} tone="accent" />
            <div className="flex-1 space-y-1 text-sm">
              <p>
                Target corpus: <CurrencyText amount={fi.target} variant="compact" className="font-semibold text-foreground" />
              </p>
              <p className="text-muted">
                Current: <CurrencyText amount={fi.currentCorpus} variant="compact" />
              </p>
              <p className="text-muted">
                {fi.fiYear ? `Projected FI year: ${fi.fiYear}` : 'Not on track to reach FI at current contributions'}
              </p>
            </div>
          </div>
        </Card>
      ) : null}

      {!goals || goals.length === 0 ? (
        <EmptyState
          icon="🎯"
          title="No goals yet"
          description="Create a goal — emergency fund, a house, retirement — and see whether your current contribution actually gets you there."
          action={<Button onClick={() => setCreating(true)}>Create your first goal</Button>}
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {goals.map((g) => (
            <GoalCard key={g.id} goal={g} onEdit={() => setEditing(g)} />
          ))}
        </div>
      )}

      <Disclaimer />

      <GoalFormSheet
        key={editing?.id ?? (creating ? 'new' : 'closed')}
        open={creating || editing !== null}
        goal={editing}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
      />
    </div>
  );
}

function GoalCard({ goal, onEdit }: { goal: Goal; onEdit: () => void }) {
  const feasibility = useMemo(() => assessGoal(goal, new Date()), [goal]);
  return (
    <Card>
      <div className="mb-2 flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-foreground">{goal.name}</p>
          <p className="text-xs capitalize text-muted">{goal.kind.replace(/_/g, ' ')}</p>
        </div>
        <button onClick={onEdit} className="text-xs text-accent hover:underline">
          Edit
        </button>
      </div>
      <div className="flex items-center gap-3">
        <ProgressRing value={feasibility.target > 0 ? goal.currentAmount / feasibility.target : 0} tone={feasibility.onTrack ? 'positive' : 'warning'} size={56} strokeWidth={6} />
        <div className="flex-1 text-xs text-muted">
          <p>
            <CurrencyText amount={goal.currentAmount} variant="compact" /> of <CurrencyText amount={goal.targetAmount} variant="compact" />
          </p>
          <p>{feasibility.monthsRemaining} months to go</p>
        </div>
      </div>
      <div className="mt-2 space-y-1 text-xs">
        <div className="flex justify-between">
          <span className="text-muted">Contributing</span>
          <CurrencyText amount={goal.monthlyContribution} variant="short" />
        </div>
        <div className="flex justify-between">
          <span className="text-muted">Required</span>
          <CurrencyText amount={feasibility.requiredMonthly} variant="short" className={feasibility.onTrack ? '' : 'text-warning'} />
        </div>
      </div>
      <ProgressBar value={feasibility.successProbability} tone={feasibility.successProbability >= 0.7 ? 'positive' : feasibility.successProbability >= 0.4 ? 'warning' : 'negative'} label={`Success probability`} className="mt-2" />
    </Card>
  );
}

function GoalFormSheet({ open, goal, onClose }: { open: boolean; goal: Goal | null; onClose: () => void }) {
  const isEdit = goal !== null;
  const [name, setName] = useState(goal?.name ?? '');
  const [kind, setKind] = useState<GoalKind>(goal?.kind ?? 'custom');
  const [targetAmount, setTargetAmount] = useState(goal ? (goal.targetAmount / 100).toString() : '');
  const [targetDate, setTargetDate] = useState(goal?.targetDate ?? '');
  const [currentAmount, setCurrentAmount] = useState(goal ? (goal.currentAmount / 100).toString() : '0');
  const [monthlyContribution, setMonthlyContribution] = useState(goal ? (goal.monthlyContribution / 100).toString() : '0');
  const [expectedReturn, setExpectedReturn] = useState(goal ? (goal.expectedReturn * 100).toString() : '11');

  async function handleSave() {
    const target = Number(targetAmount);
    if (!name.trim() || !Number.isFinite(target) || target <= 0 || !targetDate) return;
    const g: Goal = {
      id: goal?.id ?? newId(),
      name: name.trim(),
      kind,
      targetAmount: fromRupees(target),
      targetDate,
      currentAmount: fromRupees(Number(currentAmount) || 0),
      monthlyContribution: fromRupees(Number(monthlyContribution) || 0),
      expectedReturn: (Number(expectedReturn) || 0) / 100,
      priority: goal?.priority ?? 1,
      linkedAccountIds: goal?.linkedAccountIds,
      createdAt: goal?.createdAt ?? new Date().toISOString(),
    };
    await saveGoal(g);
    onClose();
  }

  async function handleDelete() {
    if (!goal) return;
    await deleteGoal(goal.id);
    onClose();
  }

  return (
    <Sheet open={open} onClose={onClose} title={isEdit ? 'Edit goal' : 'New goal'}>
      <div>
        <Field label="Name">
          <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Emergency fund" />
        </Field>
        <Field label="Type">
          <SelectInput value={kind} onChange={(e) => setKind(e.target.value as GoalKind)}>
            {GOAL_KINDS.map((k) => (
              <option key={k} value={k}>
                {k.replace(/_/g, ' ')}
              </option>
            ))}
          </SelectInput>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Target amount (₹)">
            <TextInput type="number" value={targetAmount} onChange={(e) => setTargetAmount(e.target.value)} />
          </Field>
          <Field label="Target date">
            <TextInput type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Current amount (₹)">
            <TextInput type="number" value={currentAmount} onChange={(e) => setCurrentAmount(e.target.value)} />
          </Field>
          <Field label="Monthly contribution (₹)">
            <TextInput type="number" value={monthlyContribution} onChange={(e) => setMonthlyContribution(e.target.value)} />
          </Field>
        </div>
        <Field label="Expected annual return (%)" hint="Used to project whether your contribution reaches the target in time.">
          <TextInput type="number" step="0.5" value={expectedReturn} onChange={(e) => setExpectedReturn(e.target.value)} />
        </Field>
        <div className="mt-3 flex justify-between gap-2">
          {isEdit ? (
            <Button variant="danger" onClick={handleDelete}>
              Delete
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={handleSave}>Save</Button>
          </div>
        </div>
      </div>
    </Sheet>
  );
}
