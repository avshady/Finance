import { describe, expect, it } from 'vitest';
import { annualisedCost, detectRecurring, totalRecurringMonthly } from './recurring';
import { makeTxn, rupees } from './testFixtures';

describe('detectRecurring', () => {
  it('detects a clean 6-month monthly subscription with high confidence', () => {
    const dates = ['2026-01-01', '2026-02-01', '2026-03-01', '2026-04-01', '2026-05-01', '2026-06-01'];
    const txns = dates.map((date) =>
      makeTxn({ date, amount: rupees(499), merchant: 'NETFLIX', categoryId: 'subscriptions' }),
    );

    const items = detectRecurring(txns, '2026-06-10');
    expect(items).toHaveLength(1);
    const item = items[0];
    expect(item?.interval).toBe('monthly');
    expect(item?.confidence).toBeGreaterThan(0.7);
    expect(item?.dormant).toBe(false);
  });

  it('still detects a utility bill that varies by up to ~10%', () => {
    const amounts = [1000, 1050, 950, 1080, 920, 1000]; // rupees, within 10% of mean 1000
    const dates = ['2026-01-03', '2026-02-04', '2026-03-02', '2026-04-05', '2026-05-01', '2026-06-03'];
    const txns = dates.map((date, i) =>
      makeTxn({ date, amount: rupees(amounts[i] as number), merchant: 'STATE ELECTRICITY BOARD', categoryId: 'utilities' }),
    );

    const items = detectRecurring(txns, '2026-06-10');
    expect(items).toHaveLength(1);
    expect(items[0]?.interval).toBe('monthly');
    expect(items[0]?.confidence).toBeGreaterThan(0.7);
  });

  it('2 occurrences stays a low-confidence candidate, never asserted as fact', () => {
    const txns = [
      makeTxn({ date: '2026-01-01', amount: rupees(299), merchant: 'SPOTIFY', categoryId: 'subscriptions' }),
      makeTxn({ date: '2026-01-31', amount: rupees(299), merchant: 'SPOTIFY', categoryId: 'subscriptions' }),
    ];
    const items = detectRecurring(txns, '2026-02-05');
    expect(items).toHaveLength(1);
    expect(items[0]?.confidence).toBeCloseTo(0.5, 5);
    expect(items[0]?.confidence).toBeLessThanOrEqual(0.7);
  });

  it('flags a stopped subscription as dormant', () => {
    const dates = ['2026-01-01', '2026-02-01', '2026-03-01'];
    const txns = dates.map((date) =>
      makeTxn({ date, amount: rupees(199), merchant: 'GYM MEMBERSHIP', categoryId: 'entertainment' }),
    );
    // Nothing charged since March; asOf is late July — well over 2 monthly intervals.
    const items = detectRecurring(txns, '2026-07-20');
    expect(items).toHaveLength(1);
    expect(items[0]?.dormant).toBe(true);
  });

  it('amount and interval helpers compute annualised and monthly totals correctly', () => {
    const dates = ['2026-01-01', '2026-02-01', '2026-03-01'];
    const txns = dates.map((date) =>
      makeTxn({ date, amount: rupees(500), merchant: 'GYM', categoryId: 'entertainment' }),
    );
    const items = detectRecurring(txns, '2026-03-10');
    const item = items[0];
    expect(item).toBeDefined();
    if (!item) return;
    expect(annualisedCost(item)).toBe(rupees(500 * 12));
    expect(totalRecurringMonthly([item])).toBe(rupees(500));
  });
});
