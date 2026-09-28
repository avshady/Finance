import { describe, expect, it } from 'vitest';
import { ZERO } from '../domain/money';
import {
  cashflowSeries,
  essentialMonthlyOutflow,
  incomeByMonth,
  investmentOutflowByMonth,
  spendByCategory,
  spendByMonth,
} from './aggregate';
import { CATEGORIES, makeTxn, rupees } from './testFixtures';

describe('spendByMonth / incomeByMonth: exclusion rules', () => {
  it('a self-transfer pair contributes zero to both income and expense', () => {
    const txns = [
      makeTxn({ date: '2026-06-05', amount: rupees(5000), direction: 'debit', kind: 'transfer', categoryId: 'transfer' }),
      makeTxn({ date: '2026-06-05', amount: rupees(5000), direction: 'credit', kind: 'transfer', categoryId: 'transfer' }),
    ];
    expect(spendByMonth(txns, CATEGORIES)['2026-06'] ?? ZERO).toBe(ZERO);
    expect(incomeByMonth(txns)['2026-06'] ?? ZERO).toBe(ZERO);
  });

  it('excluded transactions are omitted from both income and expense', () => {
    const txns = [
      makeTxn({ date: '2026-06-05', amount: rupees(1000), direction: 'debit', kind: 'expense', excluded: true, categoryId: 'shopping' }),
      makeTxn({ date: '2026-06-05', amount: rupees(2000), direction: 'credit', kind: 'income', excluded: true, categoryId: 'salary' }),
    ];
    expect(spendByMonth(txns, CATEGORIES)['2026-06'] ?? ZERO).toBe(ZERO);
    expect(incomeByMonth(txns)['2026-06'] ?? ZERO).toBe(ZERO);
  });

  it('investment outflow is reported separately and does not inflate spendByMonth', () => {
    const txns = [
      makeTxn({ date: '2026-06-05', amount: rupees(10000), direction: 'debit', kind: 'investment', categoryId: 'investments' }),
      makeTxn({ date: '2026-06-06', amount: rupees(2000), direction: 'debit', kind: 'expense', categoryId: 'shopping' }),
    ];
    expect(spendByMonth(txns, CATEGORIES)['2026-06']).toBe(rupees(2000));
    expect(investmentOutflowByMonth(txns)['2026-06']).toBe(rupees(10000));
  });

  it('refund credits net against the matching expense category rather than counting as income', () => {
    const txns = [
      makeTxn({ date: '2026-06-05', amount: rupees(3000), direction: 'debit', kind: 'expense', categoryId: 'shopping' }),
      makeTxn({ date: '2026-06-10', amount: rupees(1000), direction: 'credit', kind: 'refund', categoryId: 'shopping' }),
    ];
    expect(spendByMonth(txns, CATEGORIES)['2026-06']).toBe(rupees(2000));
    expect(incomeByMonth(txns)['2026-06'] ?? ZERO).toBe(ZERO);
    expect(spendByCategory(txns, CATEGORIES).shopping).toBe(rupees(2000));
  });
});

describe('essentialMonthlyOutflow', () => {
  it('picks up only essential categories', () => {
    const txns = [
      makeTxn({ date: '2026-06-01', amount: rupees(20000), direction: 'debit', kind: 'expense', categoryId: 'rent' }), // essential
      makeTxn({ date: '2026-06-02', amount: rupees(5000), direction: 'debit', kind: 'expense', categoryId: 'groceries' }), // essential
      makeTxn({ date: '2026-06-03', amount: rupees(3000), direction: 'debit', kind: 'expense', categoryId: 'entertainment' }), // not essential
      makeTxn({ date: '2026-07-01', amount: rupees(20000), direction: 'debit', kind: 'expense', categoryId: 'rent' }),
      makeTxn({ date: '2026-07-02', amount: rupees(5000), direction: 'debit', kind: 'expense', categoryId: 'groceries' }),
    ];
    // June essential total = 25000, July essential total = 25000 -> median = 25000
    expect(essentialMonthlyOutflow(txns, CATEGORIES)).toBe(rupees(25000));
  });
});

describe('cashflowSeries', () => {
  it('zero-fills a month with no transactions', () => {
    const txns = [
      makeTxn({ date: '2026-04-05', amount: rupees(50000), direction: 'credit', kind: 'income', categoryId: 'salary' }),
      makeTxn({ date: '2026-04-10', amount: rupees(10000), direction: 'debit', kind: 'expense', categoryId: 'shopping' }),
      // 2026-05 has no activity at all
      makeTxn({ date: '2026-06-05', amount: rupees(50000), direction: 'credit', kind: 'income', categoryId: 'salary' }),
      makeTxn({ date: '2026-06-10', amount: rupees(20000), direction: 'debit', kind: 'expense', categoryId: 'shopping' }),
    ];
    const series = cashflowSeries(txns, 3, '2026-06-15');
    expect(series.map((s) => s.month)).toEqual(['2026-04', '2026-05', '2026-06']);
    const may = series.find((s) => s.month === '2026-05');
    expect(may?.income ?? -1).toBe(ZERO);
    expect(may?.expense ?? -1).toBe(ZERO);
    expect(may?.net ?? -1).toBe(ZERO);

    const apr = series.find((s) => s.month === '2026-04');
    expect(apr?.income).toBe(rupees(50000));
    expect(apr?.expense).toBe(rupees(10000));
    expect(apr?.net).toBe(rupees(40000));
  });
});
