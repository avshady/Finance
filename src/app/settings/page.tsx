'use client';

import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';

import { clearAllData, loadDemoData } from '@/lib/demo';
import { getDb, getProfile, saveProfile } from '@/lib/core/db';
import { fromRupees, toRupees } from '@/lib/core/domain/money';
import type { RiskProfile, TaxRegime, UserProfile } from '@/lib/core/domain/types';
import { Card, CardHeader } from '@/components/Card';
import { Button, Field, SelectInput, TextInput } from '@/components/forms';
import { Disclaimer } from '@/components/Disclaimer';

type EmploymentTypeOption = NonNullable<UserProfile['employmentType']>;

const EMPLOYMENT_TYPES: EmploymentTypeOption[] = ['salaried', 'self_employed', 'business', 'freelance'];
const TAX_REGIMES: TaxRegime[] = ['old', 'new'];
const RISK_PROFILES: RiskProfile[] = ['conservative', 'moderate', 'aggressive'];

const DEFAULT_PROFILE: UserProfile = {
  currency: 'INR',
  locale: 'en-IN',
  monthlyNetIncome: fromRupees(0),
  dependents: 0,
  taxRegime: 'new',
  riskProfile: 'moderate',
  expectedPortfolioReturn: 0.11,
  assumedInflation: 0.06,
};

export default function SettingsPage() {
  // `?? null` matters: useLiveQuery reports "not resolved yet" as undefined, and
  // getProfile() also returns undefined when no profile has been saved. Without this,
  // a first-time user - exactly who needs this screen - never gets past "Loading...".
  const stored = useLiveQuery(() => getProfile().then((p) => p ?? null), []);
  const [form, setForm] = useState<UserProfile | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (stored !== undefined && form === null) {
      setForm(stored ?? DEFAULT_PROFILE);
    }
  }, [stored, form]);

  if (form === null) {
    return <div className="flex min-h-[50vh] items-center justify-center text-sm text-muted">Loading...</div>;
  }

  function update<K extends keyof UserProfile>(key: K, value: UserProfile[K]) {
    setForm((f) => (f ? { ...f, [key]: value } : f));
    setSaved(false);
  }

  async function handleSave() {
    if (!form) return;
    await saveProfile(form);
    setSaved(true);
  }

  return (
    <div className="space-y-4 pb-4">
      <h1 className="text-lg font-semibold text-foreground">Settings</h1>

      <Card>
        <CardHeader title="Profile" subtitle="Drives the advisor engine — every field here changes what it recommends." />

        <Field label="Monthly net income (₹)" hint="Take-home pay, after tax. Sets your emergency-fund target, EMI-to-income guardrail and savings-rate ladder.">
          <TextInput
            type="number"
            value={toRupees(form.monthlyNetIncome).toString()}
            onChange={(e) => update('monthlyNetIncome', fromRupees(Number(e.target.value) || 0))}
          />
        </Field>

        <Field label="Date of birth" hint="Used for age-based asset allocation and the years-to-retirement calculation.">
          <TextInput type="date" value={form.dateOfBirth ?? ''} onChange={(e) => update('dateOfBirth', e.target.value || undefined)} />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Dependents" hint="Each dependent raises your emergency-fund floor.">
            <TextInput
              type="number"
              min="0"
              value={form.dependents.toString()}
              onChange={(e) => update('dependents', Math.max(0, Number(e.target.value) || 0))}
            />
          </Field>
          <Field label="Employment type" hint="Unstable income (self-employed/freelance) also raises the emergency-fund floor.">
            <SelectInput
              value={form.employmentType ?? ''}
              onChange={(e) => update('employmentType', (e.target.value || undefined) as UserProfile['employmentType'])}
            >
              <option value="">Not set</option>
              {EMPLOYMENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t.replace('_', ' ')}
                </option>
              ))}
            </SelectInput>
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Tax regime" hint="Old regime unlocks 80C/80D/interest deductions in the advisor's maths; new regime mostly doesn't.">
            <SelectInput value={form.taxRegime} onChange={(e) => update('taxRegime', e.target.value as TaxRegime)}>
              {TAX_REGIMES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </SelectInput>
          </Field>
          <Field label="Risk profile" hint="Sets the suggested equity/debt/gold split.">
            <SelectInput value={form.riskProfile} onChange={(e) => update('riskProfile', e.target.value as RiskProfile)}>
              {RISK_PROFILES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </SelectInput>
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Expected return (%/yr)" hint="Long-run nominal portfolio return assumption, used in every projection.">
            <TextInput
              type="number"
              step="0.5"
              value={(form.expectedPortfolioReturn * 100).toString()}
              onChange={(e) => update('expectedPortfolioReturn', (Number(e.target.value) || 0) / 100)}
            />
          </Field>
          <Field label="Inflation (%/yr)" hint="Used to convert nominal projections into today's money.">
            <TextInput
              type="number"
              step="0.5"
              value={(form.assumedInflation * 100).toString()}
              onChange={(e) => update('assumedInflation', (Number(e.target.value) || 0) / 100)}
            />
          </Field>
        </div>

        <Field label="Target retirement age" hint="Anchors the FI-year projection on the Goals screen.">
          <TextInput
            type="number"
            min="0"
            value={form.retirementAge?.toString() ?? ''}
            onChange={(e) => update('retirementAge', e.target.value ? Number(e.target.value) : undefined)}
          />
        </Field>

        <CardHeader title="Tax declarations this year" subtitle="Unused headroom here is exactly what the tax-efficiency insight quantifies." />
        <div className="grid grid-cols-3 gap-3">
          <Field label="80C (₹)">
            <TextInput
              type="number"
              value={form.taxDeclarations?.section80C !== undefined ? toRupees(form.taxDeclarations.section80C).toString() : ''}
              onChange={(e) =>
                update('taxDeclarations', {
                  ...form.taxDeclarations,
                  section80C: e.target.value ? fromRupees(Number(e.target.value)) : undefined,
                })
              }
            />
          </Field>
          <Field label="80D (₹)">
            <TextInput
              type="number"
              value={form.taxDeclarations?.section80D !== undefined ? toRupees(form.taxDeclarations.section80D).toString() : ''}
              onChange={(e) =>
                update('taxDeclarations', {
                  ...form.taxDeclarations,
                  section80D: e.target.value ? fromRupees(Number(e.target.value)) : undefined,
                })
              }
            />
          </Field>
          <Field label="NPS 80CCD(1B) (₹)">
            <TextInput
              type="number"
              value={form.taxDeclarations?.nps80CCD1B !== undefined ? toRupees(form.taxDeclarations.nps80CCD1B).toString() : ''}
              onChange={(e) =>
                update('taxDeclarations', {
                  ...form.taxDeclarations,
                  nps80CCD1B: e.target.value ? fromRupees(Number(e.target.value)) : undefined,
                })
              }
            />
          </Field>
        </div>

        <div className="mt-3 flex items-center gap-3">
          <Button onClick={handleSave}>Save profile</Button>
          {saved ? <span className="text-xs text-positive">Saved.</span> : null}
        </div>
      </Card>

      <DataCard />

      <Disclaimer />
    </div>
  );
}

function DataCard() {
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [demoNote, setDemoNote] = useState<string | null>(null);

  async function handleExport() {
    setBusy(true);
    try {
      const db = getDb();
      const [accounts, transactions, categories, loans, budgets, goals, recurring, rawEvents, insights, profile, overrides] =
        await Promise.all([
          db.accounts.toArray(),
          db.transactions.toArray(),
          db.categories.toArray(),
          db.loans.toArray(),
          db.budgets.toArray(),
          db.goals.toArray(),
          db.recurring.toArray(),
          db.rawEvents.toArray(),
          db.insights.toArray(),
          db.profile.toArray(),
          db.userCategoryOverrides.toArray(),
        ]);
      const payload = {
        exportedAt: new Date().toISOString(),
        accounts,
        transactions,
        categories,
        loans,
        budgets,
        goals,
        recurring,
        rawEvents,
        insights,
        profile,
        userCategoryOverrides: overrides,
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `wealthwise-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteAll() {
    setBusy(true);
    try {
      const db = getDb();
      await db.transaction(
        'rw',
        [db.accounts, db.transactions, db.categories, db.loans, db.budgets, db.goals, db.recurring, db.rawEvents, db.insights, db.profile, db.userCategoryOverrides],
        async () => {
          await Promise.all([
            db.accounts.clear(),
            db.transactions.clear(),
            db.categories.clear(),
            db.loans.clear(),
            db.budgets.clear(),
            db.goals.clear(),
            db.recurring.clear(),
            db.rawEvents.clear(),
            db.insights.clear(),
            db.profile.clear(),
            db.userCategoryOverrides.clear(),
          ]);
        },
      );
      setConfirmDelete(false);
    } finally {
      setBusy(false);
    }
  }

  /**
   * Loads the 14-month demo dataset. Wiping first keeps the demo from being merged into
   * whatever the user already has, which would produce a ledger that is neither theirs
   * nor the demo and quietly wrong advice on top of it.
   */
  async function handleLoadDemo() {
    setBusy(true);
    setDemoNote(null);
    try {
      await clearAllData();
      await loadDemoData();
      setDemoNote('Demo data loaded — open the Dashboard or Insights to see it.');
    } catch (error) {
      setDemoNote(
        `Could not load the demo data: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader
        title="Your data"
        subtitle="Everything lives only in this browser. You can take it or destroy it at any time."
      />
      {demoNote ? <p className="mb-3 text-xs text-muted">{demoNote}</p> : null}
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={handleExport} disabled={busy}>
          Export all data as JSON
        </Button>
        <Button variant="secondary" onClick={handleLoadDemo} disabled={busy}>
          {busy ? 'Working…' : 'Load demo data'}
        </Button>
        {!confirmDelete ? (
          <Button variant="danger" onClick={() => setConfirmDelete(true)} disabled={busy}>
            Delete all data
          </Button>
        ) : (
          <div className="flex items-center gap-2">
            <span className="text-xs text-negative">This permanently deletes everything. Are you sure?</span>
            <Button variant="danger" onClick={handleDeleteAll} disabled={busy}>
              Yes, delete everything
            </Button>
            <Button variant="secondary" onClick={() => setConfirmDelete(false)} disabled={busy}>
              Cancel
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}
