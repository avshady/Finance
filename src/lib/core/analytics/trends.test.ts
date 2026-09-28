import { describe, expect, it } from 'vitest';
import { lifestyleInflation, topMovers } from './trends';
import { makeTxn, rupees } from './testFixtures';

/** Build 12 months (2025-09 .. 2026-08) of income/expense at given rupee levels. */
function buildIncomeExpenseSeries(
  incomeRupeesByMonth: number[],
  expenseRupeesByMonth: number[],
): ReturnType<typeof makeTxn>[] {
  const months = [
    '2025-09', '2025-10', '2025-11', '2025-12', '2026-01', '2026-02',
    '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08',
  ];
  const txns: ReturnType<typeof makeTxn>[] = [];
  months.forEach((mk, i) => {
    txns.push(
      makeTxn({
        date: `${mk}-05`,
        amount: rupees(incomeRupeesByMonth[i] as number),
        direction: 'credit',
        kind: 'income',
        categoryId: 'salary',
      }),
    );
    txns.push(
      makeTxn({
        date: `${mk}-10`,
        amount: rupees(expenseRupeesByMonth[i] as number),
        direction: 'debit',
        kind: 'expense',
        categoryId: 'shopping',
      }),
    );
  });
  return txns;
}

describe('lifestyleInflation', () => {
  it('true case: income rises ~30% while the savings rate stays flat (the raise got absorbed)', () => {
    // Early 6 months: income 50000, expense 40000 -> savings rate 20%.
    // Late 6 months: income 65000 (+30%), expense 52000 -> savings rate still 20%.
    const income = [50000, 50000, 50000, 50000, 50000, 50000, 65000, 65000, 65000, 65000, 65000, 65000];
    const expense = [40000, 40000, 40000, 40000, 40000, 40000, 52000, 52000, 52000, 52000, 52000, 52000];
    const txns = buildIncomeExpenseSeries(income, expense);

    const result = lifestyleInflation(txns, '2026-09-15');
    expect(result.incomeGrowthPct).toBeCloseTo(30, 0);
    expect(result.savingsRateDelta).toBeCloseTo(0, 2);
    expect(result.inflating).toBe(true);
  });

  it('false case: income rises ~30% and the savings rate rises with it', () => {
    // Early: income 50000, expense 40000 -> savings 20%.
    // Late: income 65000 (+30%), expense 39000 -> savings rate ~40%.
    const income = [50000, 50000, 50000, 50000, 50000, 50000, 65000, 65000, 65000, 65000, 65000, 65000];
    const expense = [40000, 40000, 40000, 40000, 40000, 40000, 39000, 39000, 39000, 39000, 39000, 39000];
    const txns = buildIncomeExpenseSeries(income, expense);

    const result = lifestyleInflation(txns, '2026-09-15');
    expect(result.incomeGrowthPct).toBeCloseTo(30, 0);
    expect(result.savingsRateDelta).toBeGreaterThan(0.1);
    expect(result.inflating).toBe(false);
  });

  it('requires a real window (6+ months); a short history never asserts inflation', () => {
    const txns = [
      makeTxn({ date: '2026-07-05', amount: rupees(50000), direction: 'credit', kind: 'income', categoryId: 'salary' }),
      makeTxn({ date: '2026-08-05', amount: rupees(70000), direction: 'credit', kind: 'income', categoryId: 'salary' }),
    ];
    const result = lifestyleInflation(txns, '2026-09-15');
    expect(result.inflating).toBe(false);
  });
});

describe('topMovers', () => {
  it('ranks categories by the largest month-over-month absolute change', () => {
    const txns = [
      makeTxn({ date: '2026-07-05', amount: rupees(2000), categoryId: 'dining', kind: 'expense' }),
      makeTxn({ date: '2026-08-05', amount: rupees(9000), categoryId: 'dining', kind: 'expense' }), // +7000
      makeTxn({ date: '2026-07-05', amount: rupees(3000), categoryId: 'shopping', kind: 'expense' }),
      makeTxn({ date: '2026-08-05', amount: rupees(3200), categoryId: 'shopping', kind: 'expense' }), // +200
    ];
    const movers = topMovers(txns, '2026-09-01', 2);
    expect(movers[0]?.categoryId).toBe('dining');
    expect(movers[0]?.change).toBe(rupees(7000));
  });
});
