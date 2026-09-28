/**
 * Engine tests.
 *
 * The sequencing guarantee is what these mostly exist for. Every individual rule can be
 * arithmetically perfect and the advice still be harmful if it arrives in the wrong
 * order — "start a SIP" above "clear this 42% card" is worse than no advice at all,
 * because the user acts on the top item.
 */

import { describe, expect, it } from 'vitest';

import { fromRupees, type Paise } from '../domain/money';
import type {
  Account,
  AdvisorRule,
  Category,
  FinancialSnapshot,
  Loan,
  SnapshotMetrics,
  UserProfile,
} from '../domain/types';
import { computeEmi } from '../emi';
import { ALL_RULES, generateAdvice, resetInsightIds } from './index';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CATEGORIES: Category[] = [
  { id: 'cat.housing.rent', name: 'Rent', group: 'housing', essential: true, builtin: true },
  { id: 'cat.food.groceries', name: 'Groceries', group: 'food', essential: true, builtin: true },
  { id: 'cat.food.restaurants', name: 'Dining', group: 'food', essential: false, builtin: true },
  { id: 'cat.insurance.health', name: 'Health cover', group: 'insurance', essential: true, builtin: true },
  { id: 'cat.fees.late_penalty', name: 'Late fees', group: 'fees', essential: false, builtin: true },
];

function profile(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    currency: 'INR',
    locale: 'en-IN',
    dateOfBirth: '1992-04-10',
    monthlyNetIncome: fromRupees(150_000),
    dependents: 1,
    taxRegime: 'old',
    riskProfile: 'moderate',
    expectedPortfolioReturn: 0.11,
    assumedInflation: 0.06,
    retirementAge: 60,
    employmentType: 'salaried',
    ...overrides,
  };
}

function metrics(overrides: Partial<SnapshotMetrics> = {}): SnapshotMetrics {
  return {
    netWorth: fromRupees(2_000_000),
    totalAssets: fromRupees(2_500_000),
    totalLiabilities: fromRupees(500_000),
    liquidAssets: fromRupees(600_000),
    monthlyIncome: fromRupees(150_000),
    monthlyExpenses: fromRupees(90_000),
    monthlyEssentialExpenses: fromRupees(60_000),
    savingsRate: 0.4,
    totalMonthlyEmi: fromRupees(20_000),
    emiToIncomeRatio: 20_000 / 150_000,
    emergencyFundMonths: 10,
    creditUtilisation: 0.1,
    spendByCategory: {},
    spendByMonth: {},
    incomeByMonth: {},
    ...overrides,
  };
}

/** A snapshot in good shape: buffer funded, no expensive debt, saving 40%. */
function healthySnapshot(overrides: Partial<FinancialSnapshot> = {}): FinancialSnapshot {
  return {
    asOf: '2026-09-28T00:00:00.000Z',
    profile: profile(),
    accounts: [
      {
        id: 'acc.savings',
        name: 'Savings',
        kind: 'savings',
        currency: 'INR',
        balance: fromRupees(600_000),
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2026-09-01T00:00:00.000Z',
      },
      {
        id: 'acc.mf',
        name: 'Mutual funds',
        kind: 'mutual_fund',
        currency: 'INR',
        balance: fromRupees(1_900_000),
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2026-09-01T00:00:00.000Z',
      },
    ],
    transactions: [
      {
        id: 'txn.premium',
        accountId: 'acc.savings',
        amount: fromRupees(24_000),
        direction: 'debit',
        currency: 'INR',
        date: '2026-04-10',
        observedAt: '2026-04-10T10:00:00.000Z',
        rawDescription: 'HDFC ERGO HEALTH PREMIUM',
        categoryId: 'cat.insurance.health',
        categoryAuto: true,
        kind: 'expense',
        method: 'netbanking',
        channel: 'manual',
        createdAt: '2026-04-10T10:00:00.000Z',
        updatedAt: '2026-04-10T10:00:00.000Z',
      },
    ],
    loans: [],
    budgets: [],
    goals: [],
    recurring: [],
    categories: CATEGORIES,
    metrics: metrics(),
    ...overrides,
  };
}

function creditCardRevolvingLoan(outstanding: Paise): Loan {
  return {
    id: 'loan.card',
    name: 'HDFC card revolving',
    kind: 'credit_card_revolving',
    principal: outstanding,
    outstanding,
    annualRate: 0.42,
    rateType: 'fixed',
    tenureMonths: 24,
    paidInstalments: 0,
    emiAmount: computeEmi(outstanding, 0.42, 24),
    emiDay: 18,
    startDate: '2026-01-18',
    createdAt: '2026-01-18T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
  };
}

// ---------------------------------------------------------------------------

describe('generateAdvice — sequencing', () => {
  it('puts revolving card debt above every growth recommendation', () => {
    resetInsightIds();
    const snapshot = healthySnapshot({ loans: [creditCardRevolvingLoan(fromRupees(180_000))] });
    const { insights } = generateAdvice(snapshot, ALL_RULES);

    const first = insights[0];
    expect(first?.rule).toBe('credit-card-revolving');
    expect(first?.severity).toBe('critical');
  });

  it('suppresses "invest more" advice while a card balance revolves', () => {
    resetInsightIds();
    const snapshot = healthySnapshot({ loans: [creditCardRevolvingLoan(fromRupees(180_000))] });
    const { insights, suppressed } = generateAdvice(snapshot, ALL_RULES);

    const surfacedRules = insights.map((i) => i.rule);
    expect(surfacedRules).not.toContain('step-up-sip');
    expect(surfacedRules).not.toContain('asset-allocation');

    // Suppressed advice is retained rather than discarded, so the UI can explain why.
    expect(suppressed.some((s) => s.insight.rule === 'step-up-sip')).toBe(true);
    expect(suppressed.every((s) => s.suppressedBy === 'credit-card-revolving')).toBe(true);
  });

  it('suppresses growth advice when the emergency fund is under three months', () => {
    resetInsightIds();
    const snapshot = healthySnapshot({
      metrics: metrics({ liquidAssets: fromRupees(50_000), emergencyFundMonths: 0.8 }),
    });
    const { insights, suppressed } = generateAdvice(snapshot, ALL_RULES);

    expect(insights[0]?.rule).toBe('emergency-fund');
    expect(insights[0]?.severity).toBe('critical');
    expect(suppressed.some((s) => s.insight.rule === 'step-up-sip')).toBe(true);
  });

  it('allows growth advice once the foundation is in place', () => {
    resetInsightIds();
    const { insights, suppressed } = generateAdvice(healthySnapshot(), ALL_RULES);
    expect(suppressed).toHaveLength(0);
    expect(insights.map((i) => i.rule)).toContain('step-up-sip');
  });

  it('never lets a later-stage rule suppress an earlier-stage one', () => {
    resetInsightIds();
    // A rogue stage-5 rule claiming to suppress the stage-1 emergency-fund warning.
    const rogue: AdvisorRule = {
      id: 'rogue',
      stage: 5,
      title: 'Rogue',
      evaluate: (s) => [
        {
          id: 'rogue#1',
          rule: 'rogue',
          severity: 'low',
          headline: 'Rogue',
          reasoning: 'Attempts to suppress a stage-1 rule.',
          impact: { amountPaise: fromRupees(1), horizonMonths: 1 },
          confidence: 'low',
          evidence: [],
          suppresses: ['emergency-fund'],
          generatedAt: s.asOf,
        },
      ],
    };

    const snapshot = healthySnapshot({
      metrics: metrics({ liquidAssets: fromRupees(10_000), emergencyFundMonths: 0.2 }),
    });
    const { insights } = generateAdvice(snapshot, [...ALL_RULES, rogue]);
    expect(insights.map((i) => i.rule)).toContain('emergency-fund');
  });
});

describe('generateAdvice — ranking', () => {
  it('ranks by severity first, then by rupee impact', () => {
    resetInsightIds();
    const { insights } = generateAdvice(healthySnapshot(), ALL_RULES);
    const weight = { critical: 4, high: 3, medium: 2, low: 1, positive: 0 } as const;

    for (let i = 1; i < insights.length; i += 1) {
      const prev = insights[i - 1]!;
      const curr = insights[i]!;
      expect(weight[prev.severity]).toBeGreaterThanOrEqual(weight[curr.severity]);
      if (prev.severity === curr.severity) {
        expect(prev.impact.amountPaise).toBeGreaterThanOrEqual(curr.impact.amountPaise);
      }
    }
  });

  it('respects the limit without losing the highest-priority item', () => {
    resetInsightIds();
    const snapshot = healthySnapshot({ loans: [creditCardRevolvingLoan(fromRupees(180_000))] });
    const { insights } = generateAdvice(snapshot, ALL_RULES, { limit: 2 });
    expect(insights).toHaveLength(2);
    expect(insights[0]?.rule).toBe('credit-card-revolving');
  });

  it('excludes positive insights from the total opportunity figure', () => {
    resetInsightIds();
    const { insights, totalOpportunity } = generateAdvice(healthySnapshot(), ALL_RULES);
    const positives = insights.filter((i) => i.severity === 'positive');
    expect(positives.length).toBeGreaterThan(0);
    const expected = insights
      .filter((i) => i.severity !== 'positive')
      .reduce((a, i) => a + i.impact.amountPaise, 0);
    expect(totalOpportunity).toBe(expected);
  });
});

describe('generateAdvice — robustness', () => {
  it('records a throwing rule instead of blanking the whole feed', () => {
    resetInsightIds();
    const broken: AdvisorRule = {
      id: 'broken',
      stage: 3,
      title: 'Broken',
      evaluate: () => {
        throw new Error('divide by zero');
      },
    };
    const { insights, errors } = generateAdvice(healthySnapshot(), [...ALL_RULES, broken]);
    expect(errors).toEqual([{ rule: 'broken', message: 'divide by zero' }]);
    expect(insights.length).toBeGreaterThan(0);
  });

  it('produces no advice at all from an empty profile rather than guessing', () => {
    resetInsightIds();
    const empty: FinancialSnapshot = {
      asOf: '2026-09-28T00:00:00.000Z',
      profile: profile({ dateOfBirth: undefined, monthlyNetIncome: 0 as Paise }),
      accounts: [],
      transactions: [],
      loans: [],
      budgets: [],
      goals: [],
      recurring: [],
      categories: CATEGORIES,
      metrics: metrics({
        netWorth: 0 as Paise,
        totalAssets: 0 as Paise,
        totalLiabilities: 0 as Paise,
        liquidAssets: 0 as Paise,
        monthlyIncome: 0 as Paise,
        monthlyExpenses: 0 as Paise,
        monthlyEssentialExpenses: 0 as Paise,
        savingsRate: null,
        totalMonthlyEmi: 0 as Paise,
        emiToIncomeRatio: null,
        emergencyFundMonths: null,
        creditUtilisation: null,
      }),
    };

    const { insights, errors } = generateAdvice(empty, ALL_RULES);
    expect(errors).toEqual([]);
    // Rules that cannot compute a baseline must stay silent. The only things worth saying
    // to an empty profile are requests for the missing inputs.
    for (const insight of insights) {
      expect(['asset-allocation', 'health-insurance']).toContain(insight.rule);
    }
  });

  it('never emits a non-finite or negative impact figure', () => {
    resetInsightIds();
    const snapshots = [
      healthySnapshot(),
      healthySnapshot({ loans: [creditCardRevolvingLoan(fromRupees(180_000))] }),
      healthySnapshot({ metrics: metrics({ liquidAssets: 0 as Paise, savingsRate: -0.2 }) }),
      healthySnapshot({
        metrics: metrics({
          monthlyIncome: fromRupees(30_000),
          totalMonthlyEmi: fromRupees(21_000),
          emiToIncomeRatio: 0.7,
          creditUtilisation: 0.95,
        }),
      }),
    ];

    for (const snapshot of snapshots) {
      const { insights } = generateAdvice(snapshot, ALL_RULES);
      for (const insight of insights) {
        expect(Number.isFinite(insight.impact.amountPaise)).toBe(true);
        expect(insight.impact.amountPaise).toBeGreaterThanOrEqual(0);
        expect(Number.isInteger(insight.impact.amountPaise)).toBe(true);
      }
    }
  });

  it('always shows its arithmetic — every insight has non-trivial reasoning', () => {
    resetInsightIds();
    const snapshot = healthySnapshot({ loans: [creditCardRevolvingLoan(fromRupees(180_000))] });
    const { insights } = generateAdvice(snapshot, ALL_RULES);
    expect(insights.length).toBeGreaterThan(0);
    for (const insight of insights) {
      expect(insight.reasoning.length).toBeGreaterThan(60);
      expect(insight.headline.length).toBeGreaterThan(10);
      // A recommendation with no evidence behind it is an assertion, not advice.
      expect(insight.evidence.length).toBeGreaterThan(0);
    }
  });

  it('restricts to the requested rules when `only` is given', () => {
    resetInsightIds();
    const { insights } = generateAdvice(healthySnapshot(), ALL_RULES, { only: ['savings-rate'] });
    expect(insights.every((i) => i.rule === 'savings-rate')).toBe(true);
  });
});

describe('regressions', () => {
  it('does not double-count a card balance that a tracked revolving loan mirrors', () => {
    resetInsightIds();
    const balance = fromRupees(210_000);
    const loan = { ...creditCardRevolvingLoan(balance), mirrorsAccountId: 'acc.card' };
    const snapshot = healthySnapshot({
      accounts: [
        ...healthySnapshot().accounts,
        {
          id: 'acc.card',
          name: 'HDFC Regalia',
          kind: 'credit_card',
          currency: 'INR',
          balance,
          creditLimit: fromRupees(300_000),
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2026-09-01T00:00:00.000Z',
        },
      ],
      loans: [loan],
    });

    const { insights } = generateAdvice(snapshot, ALL_RULES);
    const card = insights.find((i) => i.rule === 'credit-card-revolving');
    // The debt is 2.10 L once, not the 4.20 L a double-count produced.
    expect(card?.headline).toContain('2.10 L');
    expect(card?.headline).not.toContain('4.20 L');
    expect(card?.impact.amountPaise).toBe(Math.round(balance * 0.42));
  });

  it('still counts an untracked card alongside a separate revolving loan', () => {
    resetInsightIds();
    const snapshot = healthySnapshot({
      accounts: [
        ...healthySnapshot().accounts,
        {
          id: 'acc.other-card',
          name: 'Axis Card',
          kind: 'credit_card',
          currency: 'INR',
          balance: fromRupees(40_000),
          creditLimit: fromRupees(200_000),
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2026-09-01T00:00:00.000Z',
        },
      ],
      // No mirrorsAccountId, so this is genuinely separate debt.
      loans: [creditCardRevolvingLoan(fromRupees(100_000))],
    });
    const { insights } = generateAdvice(snapshot, ALL_RULES);
    const card = insights.find((i) => i.rule === 'credit-card-revolving');
    // 40k of untracked card balance plus a separate 1L revolving loan.
    expect(card?.headline).toContain('1.40 L');
  });

  it('does not call financial independence "on track" when it lands after the target age', () => {
    resetInsightIds();
    // Born 1990, aiming to stop at 55 (2045), but saving very little.
    const snapshot = healthySnapshot({
      profile: profile({ dateOfBirth: '1990-06-15', retirementAge: 55 }),
      metrics: metrics({
        monthlyIncome: fromRupees(185_000),
        monthlyExpenses: fromRupees(178_000),
        monthlyEssentialExpenses: fromRupees(118_000),
        savingsRate: 7_000 / 185_000,
      }),
    });

    const { insights } = generateAdvice(snapshot, ALL_RULES);
    const fi = insights.find((i) => i.rule === 'fi-trajectory');
    expect(fi).toBeDefined();
    expect(fi!.severity).not.toBe('positive');
    expect(fi!.headline).toMatch(/after you planned to stop|does not get there/);
  });

  it('keeps FI positive when the plan genuinely arrives in time', () => {
    resetInsightIds();
    const snapshot = healthySnapshot({
      profile: profile({ dateOfBirth: '1990-06-15', retirementAge: 60 }),
      accounts: [
        {
          id: 'acc.mf',
          name: 'Mutual funds',
          kind: 'mutual_fund',
          currency: 'INR',
          balance: fromRupees(15_000_000),
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2026-09-01T00:00:00.000Z',
        },
      ],
      metrics: metrics({ monthlyEssentialExpenses: fromRupees(50_000) }),
    });
    const { insights } = generateAdvice(snapshot, ALL_RULES);
    const fi = insights.find((i) => i.rule === 'fi-trajectory');
    expect(fi?.severity).toBe('positive');
  });
});

describe('the advice a healthy profile gets', () => {
  it('recognises a funded emergency fund as positive, not as a gap', () => {
    resetInsightIds();
    const { insights } = generateAdvice(healthySnapshot(), ALL_RULES);
    const ef = insights.find((i) => i.rule === 'emergency-fund');
    expect(ef?.severity).toBe('positive');
    expect(ef?.impact.amountPaise).toBe(0);
  });

  it('stays quiet about health cover when a premium is on record', () => {
    resetInsightIds();
    const { insights } = generateAdvice(healthySnapshot(), ALL_RULES);
    expect(insights.map((i) => i.rule)).not.toContain('health-insurance');
  });

  it('flags missing health cover when no premium appears', () => {
    resetInsightIds();
    const { insights } = generateAdvice(healthySnapshot({ transactions: [] }), ALL_RULES);
    const cover = insights.find((i) => i.rule === 'health-insurance');
    expect(cover?.severity).toBe('high');
    // An inference from absent data must not claim high confidence.
    expect(cover?.confidence).toBe('low');
  });
});
