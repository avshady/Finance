'use client';

import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { getDb, PROFILE_SINGLETON_ID } from '@/lib/core/db';
import { BUILTIN_CATEGORIES } from '@/lib/core/db/seed';
import { buildSnapshot, detectRecurring } from '@/lib/core/analytics';
import { ALL_RULES, generateAdvice, type AdviceResult } from '@/lib/core/advisor';
import { paise } from '@/lib/core/domain/money';
import type { FinancialSnapshot, UserProfile } from '@/lib/core/domain/types';

const DEFAULT_PROFILE: UserProfile = {
  currency: 'INR',
  locale: 'en-IN',
  monthlyNetIncome: paise(0),
  dependents: 0,
  taxRegime: 'new',
  riskProfile: 'moderate',
  expectedPortfolioReturn: 0.11,
  assumedInflation: 0.06,
};

export interface UseSnapshotResult {
  snapshot: FinancialSnapshot | null;
  advice: AdviceResult | null;
  loading: boolean;
  /** True once loaded and there is genuinely nothing in the ledger yet. */
  isEmpty: boolean;
}

/**
 * The shared data spine for every screen: reads everything from Dexie via
 * useLiveQuery, assembles a FinancialSnapshot, and runs the advisor engine once
 * per meaningful data change (not once per render).
 */
export function useSnapshot(): UseSnapshotResult {
  const db = getDb();

  const accounts = useLiveQuery(() => db.accounts.toArray(), []);
  const transactions = useLiveQuery(() => db.transactions.toArray(), []);
  const loans = useLiveQuery(() => db.loans.toArray(), []);
  const budgets = useLiveQuery(() => db.budgets.toArray(), []);
  const goals = useLiveQuery(() => db.goals.toArray(), []);
  const categoriesRaw = useLiveQuery(() => db.categories.toArray(), []);
  // Resolve a missing profile to null, not undefined. useLiveQuery uses undefined to
  // mean "query has not resolved yet", and Dexie's get() returns undefined for a row
  // that does not exist - so a first-time user with no saved profile is indistinguishable
  // from a query still in flight, and every screen hangs on "Loading..." forever.
  const storedProfile = useLiveQuery(
    () => db.profile.get(PROFILE_SINGLETON_ID).then((p) => p ?? null),
    [],
  );

  const loading =
    accounts === undefined ||
    transactions === undefined ||
    loans === undefined ||
    budgets === undefined ||
    goals === undefined ||
    categoriesRaw === undefined ||
    storedProfile === undefined;

  // Stable, cheap keys so the expensive rebuild (recurring detection, snapshot,
  // advisor) only reruns when the underlying data actually changed shape/content,
  // not on every dexie live-query tick with referentially-new-but-equal arrays.
  const txnKey = transactions ? `${transactions.length}:${transactions.at(-1)?.updatedAt ?? ''}` : '';
  const acctKey = accounts ? `${accounts.length}:${accounts.at(-1)?.updatedAt ?? ''}` : '';
  const loanKey = loans ? `${loans.length}:${loans.at(-1)?.updatedAt ?? ''}` : '';
  const budgetKey = budgets ? budgets.length : 0;
  const goalKey = goals ? `${goals.length}:${goals.at(-1)?.createdAt ?? ''}` : '';
  const catKey = categoriesRaw ? categoriesRaw.length : 0;
  const profileKey = storedProfile?.updatedAt ?? '';

  const result = useMemo<{ snapshot: FinancialSnapshot | null; advice: AdviceResult | null }>(() => {
    if (loading) return { snapshot: null, advice: null };

    const categories = categoriesRaw && categoriesRaw.length > 0 ? categoriesRaw : BUILTIN_CATEGORIES;
    const profile: UserProfile = storedProfile
      ? (({ id: _id, updatedAt: _u, ...rest }) => rest)(storedProfile)
      : DEFAULT_PROFILE;

    const asOf = new Date().toISOString();
    const txns = transactions ?? [];
    const recurring = detectRecurring(txns, asOf);

    const snapshot = buildSnapshot({
      asOf,
      profile,
      accounts: accounts ?? [],
      transactions: txns,
      loans: loans ?? [],
      budgets: budgets ?? [],
      goals: goals ?? [],
      recurring,
      categories,
    });

    const advice = generateAdvice(snapshot, ALL_RULES);

    return { snapshot, advice };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, txnKey, acctKey, loanKey, budgetKey, goalKey, catKey, profileKey]);

  const isEmpty =
    !loading &&
    (accounts?.length ?? 0) === 0 &&
    (transactions?.length ?? 0) === 0 &&
    (loans?.length ?? 0) === 0 &&
    (goals?.length ?? 0) === 0;

  return { snapshot: result.snapshot, advice: result.advice, loading, isEmpty };
}
