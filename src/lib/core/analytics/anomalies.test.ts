import { describe, expect, it } from 'vitest';
import { detectCategoryAnomalies } from './anomalies';
import { CATEGORIES, makeTxn, rupees } from './testFixtures';

describe('detectCategoryAnomalies (median + MAD)', () => {
  it('catches a genuine 3x spike in the current month', () => {
    // 6 prior months of ~2000/month dining spend, then September spikes to ~6000 (3x).
    const priorMonths = ['2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08'];
    const txns = priorMonths.map((mk) =>
      makeTxn({ date: `${mk}-10`, amount: rupees(2000), categoryId: 'dining', kind: 'expense' }),
    );
    txns.push(makeTxn({ date: '2026-09-10', amount: rupees(6000), categoryId: 'dining', kind: 'expense' }));

    const anomalies = detectCategoryAnomalies(txns, CATEGORIES, '2026-09-15');
    const dining = anomalies.find((a) => a.categoryId === 'dining');
    expect(dining).toBeDefined();
    expect(dining?.direction).toBe('spike');
    expect(dining?.deviationScore).toBeGreaterThan(3);
  });

  it('a category with only 2 months of history yields nothing', () => {
    const txns = [
      makeTxn({ date: '2026-08-10', amount: rupees(1000), categoryId: 'entertainment', kind: 'expense' }),
      makeTxn({ date: '2026-07-10', amount: rupees(1000), categoryId: 'entertainment', kind: 'expense' }),
      makeTxn({ date: '2026-09-10', amount: rupees(9000), categoryId: 'entertainment', kind: 'expense' }),
    ];
    const anomalies = detectCategoryAnomalies(txns, CATEGORIES, '2026-09-15');
    expect(anomalies.find((a) => a.categoryId === 'entertainment')).toBeUndefined();
  });

  it('one historical outlier does not suppress detection of a genuine current-month spike', () => {
    // 8 months of baseline ~2000, with one wild historical outlier month at 9000 rupees.
    const baseline: Record<string, number> = {
      '2026-01': 2000,
      '2026-02': 2100,
      '2026-03': 1900,
      '2026-04': 2050,
      '2026-05': 1950,
      '2026-06': 9000, // historical outlier
      '2026-07': 2000,
      '2026-08': 2100,
    };
    const txns = Object.entries(baseline).map(([mk, rupeeAmount]) =>
      makeTxn({ date: `${mk}-10`, amount: rupees(rupeeAmount), categoryId: 'dining', kind: 'expense' }),
    );
    // September genuinely spikes to ~3x the baseline median (2025 -> ~6075).
    txns.push(makeTxn({ date: '2026-09-10', amount: rupees(6075), categoryId: 'dining', kind: 'expense' }));

    const anomalies = detectCategoryAnomalies(txns, CATEGORIES, '2026-09-15');
    const dining = anomalies.find((a) => a.categoryId === 'dining');
    expect(dining).toBeDefined();
    expect(dining?.direction).toBe('spike');
    expect(dining?.deviationScore).toBeGreaterThan(3);
  });
});
