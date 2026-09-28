import { describe, expect, it } from 'vitest';
import { paise, ZERO, type Paise } from '../../domain/money';
import type {
  Category,
  FinancialSnapshot,
  RecurringItem,
  Transaction,
  UserProfile,
} from '../../domain/types';
import { resetInsightIds } from '../engine';
import {
  LEAK_RULES,
  budgetOverrunRule,
  categorySpikeRule,
  dormantSubscriptionsRule,
  feesAndPenaltiesRule,
  lifestyleInflationRule,
} from './leaks';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function rupeesToPaise(r: number): Paise {
  return paise(Math.round(r * 100));
}

const BASE_PROFILE: UserProfile = {
  currency: 'INR',
  locale: 'en-IN',
  monthlyNetIncome: rupeesToPaise(100_000),
  dependents: 0,
  taxRegime: 'old',
  riskProfile: 'moderate',
  expectedPortfolioReturn: 0.11,
  assumedInflation: 0.06,
  employmentType: 'salaried',
};

function makeSnapshot(overrides: Partial<FinancialSnapshot> = {}): FinancialSnapshot {
  return {
    asOf: '2026-09-28T00:00:00.000Z',
    profile: BASE_PROFILE,
    accounts: [],
    transactions: [],
    loans: [],
    budgets: [],
    goals: [],
    recurring: [],
    categories: [],
    metrics: {
      netWorth: ZERO,
      totalAssets: ZERO,
      totalLiabilities: ZERO,
      liquidAssets: ZERO,
      monthlyIncome: rupeesToPaise(100_000),
      monthlyExpenses: rupeesToPaise(70_000),
      monthlyEssentialExpenses: rupeesToPaise(50_000),
      savingsRate: 0.3,
      totalMonthlyEmi: ZERO,
      emiToIncomeRatio: null,
      emergencyFundMonths: null,
      creditUtilisation: null,
      spendByCategory: {},
      spendByMonth: {},
      incomeByMonth: {},
    },
    ...overrides,
  };
}

let txnCounter = 0;
function makeTxn(overrides: Partial<Transaction> & Pick<Transaction, 'amount' | 'date' | 'categoryId'>): Transaction {
  txnCounter += 1;
  return {
    id: `txn-${txnCounter}`,
    accountId: 'acc-1',
    direction: 'debit',
    currency: 'INR',
    channel: 'manual',
    observedAt: `${overrides.date}T00:00:00.000Z`,
    rawDescription: 'TEST',
    categoryAuto: false,
    kind: 'expense',
    method: 'upi',
    createdAt: `${overrides.date}T00:00:00.000Z`,
    updatedAt: `${overrides.date}T00:00:00.000Z`,
    ...overrides,
  };
}

function makeCategory(overrides: Partial<Category> & Pick<Category, 'id' | 'group'>): Category {
  return {
    name: overrides.id,
    essential: false,
    builtin: true,
    ...overrides,
  };
}

function makeRecurring(overrides: Partial<RecurringItem> & Pick<RecurringItem, 'id' | 'merchant' | 'amount'>): RecurringItem {
  return {
    interval: 'monthly',
    categoryId: 'entertainment',
    firstSeen: '2025-01-05',
    lastSeen: '2025-02-05',
    confidence: 0.9,
    detected: true,
    ...overrides,
  };
}

describe('dormantSubscriptionsRule', () => {
  it('fires on a dormant subscription with impact = annualised cost', () => {
    resetInsightIds();
    const item = makeRecurring({
      id: 'r-netflix',
      merchant: 'NETFLIX',
      amount: rupeesToPaise(499),
      interval: 'monthly',
      dormant: true,
    });
    const snapshot = makeSnapshot({ recurring: [item] });

    const insights = dormantSubscriptionsRule.evaluate(snapshot);
    expect(insights).toHaveLength(1);
    // 499 * 100 = 49900 paise/month, x12 = 598800.
    expect(insights[0]!.impact.amountPaise).toBe(598_800);
    expect(Number.isFinite(insights[0]!.impact.amountPaise)).toBe(true);
  });

  it('fires on duplicate video subscriptions, keeping the cheapest and flagging the rest', () => {
    resetInsightIds();
    const cheap = makeRecurring({
      id: 'r-hotstar',
      merchant: 'HOTSTAR',
      amount: rupeesToPaise(299),
      interval: 'monthly',
    });
    const expensive = makeRecurring({
      id: 'r-netflix',
      merchant: 'NETFLIX',
      amount: rupeesToPaise(649),
      interval: 'monthly',
    });
    const snapshot = makeSnapshot({ recurring: [cheap, expensive] });

    const insights = dormantSubscriptionsRule.evaluate(snapshot);
    expect(insights).toHaveLength(1);
    // 649 * 100 = 64900/month, x12 = 778800: only the pricier duplicate is flagged.
    expect(insights[0]!.impact.amountPaise).toBe(778_800);
  });

  it('returns [] on a clean snapshot with no dormant or duplicate subscriptions', () => {
    const snapshot = makeSnapshot({
      recurring: [
        makeRecurring({ id: 'r-netflix', merchant: 'NETFLIX', amount: rupeesToPaise(649) }),
        makeRecurring({ id: 'r-gym', merchant: 'CULT FIT', amount: rupeesToPaise(1500) }),
      ],
    });
    expect(dormantSubscriptionsRule.evaluate(snapshot)).toEqual([]);
  });
});

describe('feesAndPenaltiesRule', () => {
  it('fires on fee-group spend, annualised across the observed window', () => {
    resetInsightIds();
    const feeCategory = makeCategory({ id: 'late-fee', group: 'fees', name: 'Late payment fee' });
    const atmCategory = makeCategory({ id: 'atm-fee', group: 'fees', name: 'ATM withdrawal fee' });

    const t1 = makeTxn({ amount: rupeesToPaise(500), date: '2026-07-10', categoryId: 'late-fee', kind: 'fee' });
    const t2 = makeTxn({ amount: rupeesToPaise(300), date: '2026-08-10', categoryId: 'atm-fee', kind: 'fee' });

    const snapshot = makeSnapshot({
      categories: [feeCategory, atmCategory],
      transactions: [t1, t2],
      metrics: {
        ...makeSnapshot().metrics,
        spendByMonth: { '2026-07': rupeesToPaise(500), '2026-08': rupeesToPaise(300) },
      },
    });

    const insights = feesAndPenaltiesRule.evaluate(snapshot);
    expect(insights).toHaveLength(1);
    // Total 800 rupees = 80000 paise over 2 observed months -> annualised x6 = 480000.
    expect(insights[0]!.impact.amountPaise).toBe(480_000);
    expect(Number.isFinite(insights[0]!.impact.amountPaise)).toBe(true);
  });

  it('returns [] when there are no fee-group categories or no fee spend', () => {
    const snapshot = makeSnapshot({
      categories: [makeCategory({ id: 'groceries', group: 'food', name: 'Groceries' })],
      transactions: [makeTxn({ amount: rupeesToPaise(500), date: '2026-08-10', categoryId: 'groceries' })],
    });
    expect(feesAndPenaltiesRule.evaluate(snapshot)).toEqual([]);
  });
});

describe('lifestyleInflationRule', () => {
  const earlyMonths = ['2025-01', '2025-02', '2025-03', '2025-04', '2025-05', '2025-06'];
  const lateMonths = ['2025-07', '2025-08', '2025-09', '2025-10', '2025-11', '2025-12'];

  function buildTxns(earlyIncome: number, lateIncome: number, earlyExpense: number, lateExpense: number): Transaction[] {
    const txns: Transaction[] = [];
    for (const mk of earlyMonths) {
      txns.push(
        makeTxn({ amount: rupeesToPaise(earlyIncome), date: `${mk}-01`, categoryId: 'salary', kind: 'income', direction: 'credit' }),
      );
      txns.push(
        makeTxn({ amount: rupeesToPaise(earlyExpense), date: `${mk}-15`, categoryId: 'shopping', kind: 'expense', direction: 'debit' }),
      );
    }
    for (const mk of lateMonths) {
      txns.push(
        makeTxn({ amount: rupeesToPaise(lateIncome), date: `${mk}-01`, categoryId: 'salary', kind: 'income', direction: 'credit' }),
      );
      txns.push(
        makeTxn({ amount: rupeesToPaise(lateExpense), date: `${mk}-15`, categoryId: 'shopping', kind: 'expense', direction: 'debit' }),
      );
    }
    return txns;
  }

  it('fires when income rose but the savings rate held flat, with a hand-computed impact', () => {
    resetInsightIds();
    // Early: 100000 income / 70000 expense -> 30% savings rate.
    // Late:  120000 income / 84000 expense -> 30% savings rate (20% income growth, flat rate).
    const txns = buildTxns(100_000, 120_000, 70_000, 84_000);
    const snapshot = makeSnapshot({
      asOf: '2026-01-15T00:00:00.000Z',
      transactions: txns,
      metrics: {
        ...makeSnapshot().metrics,
        monthlyIncome: rupeesToPaise(120_000),
        savingsRate: 0.3,
      },
    });

    const insights = lifestyleInflationRule.evaluate(snapshot);
    expect(insights).toHaveLength(1);
    // raiseMonthly = 120000 - (120000/1.2) = 20000 rupees = 2,000,000 paise.
    // shouldHaveSavedAnnual = 2,000,000 * 0.3 * 12 = 7,200,000 paise.
    expect(insights[0]!.impact.amountPaise).toBe(7_200_000);
    expect(insights[0]!.confidence).toBe('medium');
    expect(Number.isFinite(insights[0]!.impact.amountPaise)).toBe(true);
  });

  it('stays silent when the savings rate rose alongside income', () => {
    // Early: 100000 income / 70000 expense -> 30%. Late: 120000 income / 72000 expense -> 40%.
    const txns = buildTxns(100_000, 120_000, 70_000, 72_000);
    const snapshot = makeSnapshot({
      asOf: '2026-01-15T00:00:00.000Z',
      transactions: txns,
      metrics: {
        ...makeSnapshot().metrics,
        monthlyIncome: rupeesToPaise(120_000),
        savingsRate: 0.4,
      },
    });

    expect(lifestyleInflationRule.evaluate(snapshot)).toEqual([]);
  });
});

describe('budgetOverrunRule', () => {
  it('returns [] when no budgets exist', () => {
    const snapshot = makeSnapshot({
      transactions: [makeTxn({ amount: rupeesToPaise(20_000), date: '2026-09-10', categoryId: 'food' })],
    });
    expect(budgetOverrunRule.evaluate(snapshot)).toEqual([]);
  });

  it('fires on a budget projected to overshoot, with a hand-computed overshoot amount', () => {
    resetInsightIds();
    const category = makeCategory({ id: 'food', group: 'food', name: 'Food', essential: true });
    const snapshot = makeSnapshot({
      asOf: '2026-09-15T00:00:00.000Z', // day 15 of a 30-day month -> 15 days elapsed, 15 remaining.
      categories: [category],
      budgets: [{ id: 'b-food', categoryId: 'food', limit: rupeesToPaise(30_000), createdAt: '2026-01-01T00:00:00.000Z' }],
      transactions: [makeTxn({ amount: rupeesToPaise(20_000), date: '2026-09-10', categoryId: 'food' })],
    });

    const insights = budgetOverrunRule.evaluate(snapshot);
    expect(insights).toHaveLength(1);
    // projectedMonthEnd = 20000 * (30/15) = 40000; overshoot = 40000 - 30000 = 10000 rupees = 1,000,000 paise.
    expect(insights[0]!.impact.amountPaise).toBe(1_000_000);
    expect(insights[0]!.severity).toBe('medium'); // paceRatio 40000/30000 = 1.333, in [1.2, 1.5)
    expect(Number.isFinite(insights[0]!.impact.amountPaise)).toBe(true);
  });
});

describe('categorySpikeRule', () => {
  const priorMonths = ['2026-05', '2026-06', '2026-07', '2026-08'];

  it('fires on a spike with impact = excess above the median baseline', () => {
    resetInsightIds();
    const category = makeCategory({ id: 'shopping', group: 'shopping', name: 'Shopping' });
    const txns: Transaction[] = priorMonths.map((mk) =>
      makeTxn({ amount: rupeesToPaise(1_000), date: `${mk}-10`, categoryId: 'shopping' }),
    );
    txns.push(makeTxn({ amount: rupeesToPaise(5_000), date: '2026-09-10', categoryId: 'shopping' }));

    const snapshot = makeSnapshot({
      asOf: '2026-09-28T00:00:00.000Z',
      categories: [category],
      transactions: txns,
    });

    const insights = categorySpikeRule.evaluate(snapshot);
    expect(insights).toHaveLength(1);
    // baseline (median of four 1000s) = 1000 rupees; current = 5000 rupees; excess = 4000 rupees = 400,000 paise.
    expect(insights[0]!.impact.amountPaise).toBe(400_000);
    expect(insights[0]!.confidence).toBe('medium');
    expect(Number.isFinite(insights[0]!.impact.amountPaise)).toBe(true);
  });

  it('does not fire on a drop', () => {
    const category = makeCategory({ id: 'entertainment', group: 'entertainment', name: 'Entertainment' });
    const txns: Transaction[] = priorMonths.map((mk) =>
      makeTxn({ amount: rupeesToPaise(1_000), date: `${mk}-10`, categoryId: 'entertainment' }),
    );
    // No current-month spend at all: a clear drop, never a spike.
    const snapshot = makeSnapshot({
      asOf: '2026-09-28T00:00:00.000Z',
      categories: [category],
      transactions: txns,
    });

    expect(categorySpikeRule.evaluate(snapshot)).toEqual([]);
  });

  it('returns [] on a clean snapshot with no anomalies', () => {
    const category = makeCategory({ id: 'shopping', group: 'shopping', name: 'Shopping' });
    const txns: Transaction[] = [...priorMonths, '2026-09'].map((mk) =>
      makeTxn({ amount: rupeesToPaise(1_000), date: `${mk}-10`, categoryId: 'shopping' }),
    );
    const snapshot = makeSnapshot({ asOf: '2026-09-28T00:00:00.000Z', categories: [category], transactions: txns });
    expect(categorySpikeRule.evaluate(snapshot)).toEqual([]);
  });
});

describe('LEAK_RULES', () => {
  it('exports all five rules at stage 3', () => {
    expect(LEAK_RULES).toHaveLength(5);
    for (const rule of LEAK_RULES) {
      expect(rule.stage).toBe(3);
    }
  });

  it('never emits NaN or Infinity in impact.amountPaise across a battery of fixtures', () => {
    const fixtures: FinancialSnapshot[] = [
      makeSnapshot(),
      makeSnapshot({
        recurring: [makeRecurring({ id: 'r1', merchant: 'SPOTIFY', amount: rupeesToPaise(119), dormant: true })],
      }),
      makeSnapshot({
        categories: [makeCategory({ id: 'fee', group: 'fees', name: 'Annual card fee' })],
        transactions: [makeTxn({ amount: rupeesToPaise(500), date: '2026-09-01', categoryId: 'fee', kind: 'fee' })],
        metrics: { ...makeSnapshot().metrics, spendByMonth: { '2026-09': rupeesToPaise(500) }, monthlyIncome: ZERO },
      }),
      makeSnapshot({
        budgets: [{ id: 'b1', categoryId: 'food', limit: rupeesToPaise(1), createdAt: '2026-01-01T00:00:00.000Z' }],
        transactions: [makeTxn({ amount: rupeesToPaise(50_000), date: '2026-09-01', categoryId: 'food' })],
        asOf: '2026-09-01T00:00:00.000Z',
      }),
    ];

    for (const snapshot of fixtures) {
      for (const rule of LEAK_RULES) {
        const insights = rule.evaluate(snapshot);
        for (const insight of insights) {
          expect(Number.isFinite(insight.impact.amountPaise)).toBe(true);
          expect(Number.isNaN(insight.impact.amountPaise)).toBe(false);
        }
      }
    }
  });
});
