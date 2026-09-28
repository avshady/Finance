import { describe, expect, it } from 'vitest';
import { buildMetrics, buildSnapshot } from './metrics';
import { CATEGORIES, makeAccount, makeLoan, makeTxn, rupees } from './testFixtures';
import type { UserProfile } from '../domain/types';

const PROFILE: UserProfile = {
  currency: 'INR',
  locale: 'en-IN',
  monthlyNetIncome: rupees(50000),
  dependents: 0,
  taxRegime: 'new',
  riskProfile: 'moderate',
  expectedPortfolioReturn: 0.11,
  assumedInflation: 0.06,
};

describe('buildMetrics: medians and partial-month exclusion', () => {
  it('a bonus month does not distort monthlyIncome, and a partial current month is excluded', () => {
    const txns = [
      makeTxn({ date: '2026-01-05', amount: rupees(50000), direction: 'credit', kind: 'income', categoryId: 'salary' }),
      makeTxn({ date: '2026-02-05', amount: rupees(50000), direction: 'credit', kind: 'income', categoryId: 'salary' }),
      makeTxn({ date: '2026-03-05', amount: rupees(50000), direction: 'credit', kind: 'income', categoryId: 'salary' }),
      makeTxn({ date: '2026-04-05', amount: rupees(50000), direction: 'credit', kind: 'income', categoryId: 'salary' }),
      makeTxn({ date: '2026-05-05', amount: rupees(50000), direction: 'credit', kind: 'income', categoryId: 'salary' }),
      // June: a one-off bonus quadruples that month's income.
      makeTxn({ date: '2026-06-05', amount: rupees(200000), direction: 'credit', kind: 'income', categoryId: 'salary' }),
      // July: the current (partial, asOf=2026-07-15) month — must be excluded from the window.
      makeTxn({ date: '2026-07-02', amount: rupees(999999), direction: 'credit', kind: 'income', categoryId: 'salary' }),
    ];

    const metrics = buildMetrics({
      asOf: '2026-07-15',
      accounts: [],
      transactions: txns,
      categories: CATEGORIES,
      loans: [],
      windowMonths: 6,
    });

    expect(metrics.monthlyIncome).toBe(rupees(50000));
  });

  it('median monthly expenses ignore a one-off large purchase month', () => {
    const txns = [
      makeTxn({ date: '2026-01-10', amount: rupees(20000), direction: 'debit', kind: 'expense', categoryId: 'groceries' }),
      makeTxn({ date: '2026-02-10', amount: rupees(20000), direction: 'debit', kind: 'expense', categoryId: 'groceries' }),
      makeTxn({ date: '2026-03-10', amount: rupees(20000), direction: 'debit', kind: 'expense', categoryId: 'groceries' }),
      makeTxn({ date: '2026-04-10', amount: rupees(20000), direction: 'debit', kind: 'expense', categoryId: 'groceries' }),
      // May: a one-off ₹2L purchase.
      makeTxn({ date: '2026-05-10', amount: rupees(200000), direction: 'debit', kind: 'expense', categoryId: 'shopping' }),
      makeTxn({ date: '2026-06-10', amount: rupees(20000), direction: 'debit', kind: 'expense', categoryId: 'groceries' }),
    ];

    const metrics = buildMetrics({
      asOf: '2026-07-15',
      accounts: [],
      transactions: txns,
      categories: CATEGORIES,
      loans: [],
      windowMonths: 6,
    });

    expect(metrics.monthlyExpenses).toBe(rupees(20000));
  });
});

describe('buildMetrics: null ratios on zero/unknown denominators', () => {
  it('returns null (never NaN/Infinity) for every ratio when data is absent', () => {
    const metrics = buildMetrics({
      asOf: '2026-07-15',
      accounts: [],
      transactions: [],
      categories: CATEGORIES,
      loans: [],
      windowMonths: 6,
    });

    expect(metrics.savingsRate).toBeNull();
    expect(metrics.emiToIncomeRatio).toBeNull();
    expect(metrics.emergencyFundMonths).toBeNull();
    expect(metrics.creditUtilisation).toBeNull();

    for (const value of [metrics.savingsRate, metrics.emiToIncomeRatio, metrics.emergencyFundMonths, metrics.creditUtilisation]) {
      expect(value === null || (Number.isFinite(value) && !Number.isNaN(value))).toBe(true);
    }
  });

  it('creditUtilisation is null when no card declares a credit limit', () => {
    const accounts = [makeAccount({ kind: 'credit_card', balance: rupees(15000) })];
    const metrics = buildMetrics({
      asOf: '2026-07-15',
      accounts,
      transactions: [],
      categories: CATEGORIES,
      loans: [],
    });
    expect(metrics.creditUtilisation).toBeNull();
  });

  it('computes creditUtilisation as balance/limit when a limit is known', () => {
    const accounts = [makeAccount({ kind: 'credit_card', balance: rupees(30000), creditLimit: rupees(100000) })];
    const metrics = buildMetrics({
      asOf: '2026-07-15',
      accounts,
      transactions: [],
      categories: CATEGORIES,
      loans: [],
    });
    expect(metrics.creditUtilisation).toBeCloseTo(0.3, 10);
  });

  it('emiToIncomeRatio and savingsRate are non-null with real income and EMIs', () => {
    const txns = Array.from({ length: 6 }, (_, i) =>
      makeTxn({
        date: `2026-0${i + 1}-05`,
        amount: rupees(60000),
        direction: 'credit',
        kind: 'income',
        categoryId: 'salary',
      }),
    );
    const loans = [makeLoan({ emiAmount: rupees(15000), outstanding: rupees(500000) })];
    const metrics = buildMetrics({
      asOf: '2026-08-01',
      accounts: [],
      transactions: txns,
      categories: CATEGORIES,
      loans,
      windowMonths: 6,
    });
    expect(metrics.emiToIncomeRatio).toBeCloseTo(15000 / 60000, 10);
    expect(metrics.savingsRate).toBeCloseTo(1, 10); // no expense txns -> 100% "saved"
  });
});

describe('buildSnapshot', () => {
  it('assembles a complete FinancialSnapshot with computed metrics', () => {
    const snapshot = buildSnapshot({
      asOf: '2026-07-15T00:00:00.000Z',
      profile: PROFILE,
      accounts: [makeAccount({ kind: 'savings', balance: rupees(100000) })],
      transactions: [],
      loans: [],
      budgets: [],
      goals: [],
      recurring: [],
      categories: CATEGORIES,
    });

    expect(snapshot.asOf).toBe('2026-07-15T00:00:00.000Z');
    expect(snapshot.metrics.liquidAssets).toBe(rupees(100000));
    expect(snapshot.metrics.netWorth).toBe(rupees(100000));
  });
});
