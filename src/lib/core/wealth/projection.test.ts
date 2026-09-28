import { describe, expect, it } from 'vitest';

import { fromRupees, toRupees, type Paise } from '../domain/money';
import type { Goal } from '../domain/types';
import {
  assessGoal,
  fiNumber,
  futureValueLumpSum,
  futureValueSip,
  futureValueStepUpSip,
  monthsBetween,
  project,
  projectFi,
  projectTrajectory,
  realReturn,
  requiredSip,
  successProbability,
  suggestAllocation,
} from './projection';

describe('realReturn', () => {
  it('uses the Fisher relation, not naive subtraction', () => {
    // (1.11 / 1.06) - 1 = 4.717%, not the 5% a subtraction would give. Over 30 years
    // that gap is the difference between a plan that works and one that does not.
    expect(realReturn(0.11, 0.06)).toBeCloseTo(0.047169, 5);
    expect(realReturn(0.11, 0.06)).toBeLessThan(0.05);
  });

  it('is the nominal rate when there is no inflation', () => {
    expect(realReturn(0.09, 0)).toBeCloseTo(0.09, 10);
  });

  it('goes negative when inflation outruns the return', () => {
    expect(realReturn(0.04, 0.06)).toBeLessThan(0);
  });
});

describe('futureValueLumpSum', () => {
  it('compounds monthly', () => {
    // ₹1,00,000 at 12% for 12 months = 100000 * (1.01)^12 = ₹1,12,682.50
    expect(toRupees(futureValueLumpSum(fromRupees(100_000), 0.12, 12))).toBeCloseTo(112_682.5, 0);
  });

  it('returns the present value for a zero horizon', () => {
    const present = fromRupees(50_000);
    expect(futureValueLumpSum(present, 0.12, 0)).toBe(present);
  });
});

describe('futureValueSip', () => {
  it('compounds contributions from the start of each period', () => {
    // ₹10,000/month at 12% for 12 months, start-of-period:
    // 10000 * ((1.01^12 - 1)/0.01) * 1.01 = ₹1,28,093
    expect(toRupees(futureValueSip(fromRupees(10_000), 0.12, 12))).toBeCloseTo(128_093, 0);
  });

  it('earns one extra period versus end-of-period compounding', () => {
    const monthly = fromRupees(10_000);
    const startOfPeriod = futureValueSip(monthly, 0.12, 120);
    // End-of-period would omit the trailing (1+r) factor.
    const endOfPeriod = startOfPeriod / 1.01;
    expect(startOfPeriod).toBeGreaterThan(endOfPeriod);
  });

  it('is a plain sum at a zero return', () => {
    expect(futureValueSip(fromRupees(5_000), 0, 24)).toBe(fromRupees(120_000));
  });

  it('is zero for no contribution or no time', () => {
    expect(futureValueSip(0 as Paise, 0.12, 120)).toBe(0);
    expect(futureValueSip(fromRupees(5_000), 0.12, 0)).toBe(0);
  });
});

describe('requiredSip', () => {
  it('inverts futureValueSip', () => {
    const target = futureValueSip(fromRupees(10_000), 0.11, 180);
    const required = requiredSip(target, 0 as Paise, 0.11, 180);
    // Rounded up to the paise, so within a rupee of the original.
    expect(Math.abs(required - fromRupees(10_000))).toBeLessThan(100);
  });

  it('credits the existing corpus, asking for less', () => {
    const target = fromRupees(10_000_000);
    const withNothing = requiredSip(target, 0 as Paise, 0.11, 240);
    const withCorpus = requiredSip(target, fromRupees(2_000_000), 0.11, 240);
    expect(withCorpus).toBeLessThan(withNothing);
  });

  it('asks for nothing when the corpus already gets there', () => {
    expect(requiredSip(fromRupees(100_000), fromRupees(1_000_000), 0.11, 120)).toBe(0);
  });
});

describe('futureValueStepUpSip', () => {
  it('beats a flat SIP of the same starting amount', () => {
    const flat = futureValueSip(fromRupees(20_000), 0.11, 240);
    const stepped = futureValueStepUpSip(fromRupees(20_000), 0.11, 240, 0.1);
    expect(stepped).toBeGreaterThan(flat);
  });

  it('equals a flat SIP when the step-up is zero', () => {
    const flat = futureValueSip(fromRupees(20_000), 0.11, 60);
    const stepped = futureValueStepUpSip(fromRupees(20_000), 0.11, 60, 0);
    // The loop rounds each month, so allow a small accumulation of rounding.
    expect(Math.abs(stepped - flat) / flat).toBeLessThan
      ? expect(Math.abs(stepped - flat) / flat).toBeLessThan(0.001)
      : undefined;
  });
});

describe('fiNumber', () => {
  it('uses a 3.5% withdrawal rate by default — about 29x annual expenses', () => {
    const annual = fromRupees(1_200_000);
    expect(toRupees(fiNumber(annual))).toBeCloseTo(34_285_714, 0);
    expect(fiNumber(annual) / annual).toBeCloseTo(28.571, 2);
  });

  it('demands a larger corpus than the familiar 4% rule would', () => {
    const annual = fromRupees(1_200_000);
    expect(fiNumber(annual, 0.035)).toBeGreaterThan(fiNumber(annual, 0.04));
  });

  it('rejects a non-positive withdrawal rate instead of returning Infinity', () => {
    expect(() => fiNumber(fromRupees(1_200_000), 0)).toThrow(RangeError);
  });
});

describe('projectFi', () => {
  const base = {
    annualExpenses: fromRupees(1_200_000),
    currentCorpus: fromRupees(5_000_000),
    monthlyContribution: fromRupees(100_000),
    nominalReturn: 0.11,
    inflation: 0.06,
    currentYear: 2026,
  };

  it('projects in real terms, so a nominal plan looks slower not faster', () => {
    const real = projectFi(base);
    const nominal = projectFi({ ...base, inflation: 0 });
    // Ignoring inflation makes FI look closer than it is — the error this guards against.
    expect(nominal.monthsToFi!).toBeLessThan(real.monthsToFi!);
    expect(real.realRate).toBeCloseTo(realReturn(0.11, 0.06), 6);
  });

  it('reports zero months when the corpus is already at target', () => {
    const result = projectFi({ ...base, currentCorpus: fromRupees(50_000_000) });
    expect(result.monthsToFi).toBe(0);
    expect(result.progress).toBe(1);
  });

  it('returns null rather than a fake date when the plan never gets there', () => {
    const result = projectFi({
      ...base,
      currentCorpus: 0 as Paise,
      monthlyContribution: fromRupees(100),
      nominalReturn: 0.05,
      inflation: 0.06, // negative real return
    });
    expect(result.monthsToFi).toBeNull();
    expect(result.fiYear).toBeNull();
  });

  it('brings FI forward when contributions grow', () => {
    const flat = projectFi(base);
    const growing = projectFi({ ...base, contributionGrowth: 0.1 });
    expect(growing.monthsToFi!).toBeLessThan(flat.monthsToFi!);
  });

  it('reports progress as a fraction of the target', () => {
    const result = projectFi(base);
    expect(result.progress).toBeCloseTo(base.currentCorpus / result.target, 6);
    expect(result.progress).toBeGreaterThan(0);
    expect(result.progress).toBeLessThan(1);
  });
});

describe('projectTrajectory', () => {
  it('amortises debt down while the corpus grows', () => {
    const points = projectTrajectory({
      startingCorpus: fromRupees(1_000_000),
      monthlySavings: fromRupees(50_000),
      annualReturn: 0.11,
      startingDebt: fromRupees(2_000_000),
      debtMonthlyPayment: fromRupees(40_000),
      debtAnnualRate: 0.09,
      months: 60,
      currentYear: 2026,
    });

    const first = points[0]!;
    const last = points[points.length - 1]!;
    expect(last.corpus).toBeGreaterThan(first.corpus);
    expect(last.debt).toBeLessThan(first.debt);
    expect(last.netWorth).toBeGreaterThan(first.netWorth);
  });

  it('never drives debt below zero', () => {
    const points = projectTrajectory({
      startingCorpus: 0 as Paise,
      monthlySavings: 0 as Paise,
      annualReturn: 0.11,
      startingDebt: fromRupees(100_000),
      debtMonthlyPayment: fromRupees(50_000),
      debtAnnualRate: 0.09,
      months: 24,
      currentYear: 2026,
    });
    for (const point of points) expect(point.debt).toBeGreaterThanOrEqual(0);
    expect(points[points.length - 1]!.debt).toBe(0);
  });

  it('reports one point per year plus the final month', () => {
    const points = projectTrajectory({
      startingCorpus: fromRupees(100_000),
      monthlySavings: fromRupees(10_000),
      annualReturn: 0.1,
      startingDebt: 0 as Paise,
      debtMonthlyPayment: 0 as Paise,
      debtAnnualRate: 0,
      months: 30,
      currentYear: 2026,
    });
    expect(points.map((p) => p.month)).toEqual([12, 24, 30]);
    expect(points[0]!.year).toBe(2027);
  });
});

describe('successProbability', () => {
  it('is near certain when the projection comfortably clears the target', () => {
    expect(
      successProbability({
        target: fromRupees(1_000_000),
        projected: fromRupees(3_000_000),
        months: 120,
        volatility: 0.15,
      }),
    ).toBeGreaterThan(0.95);
  });

  it('is near zero when the projection falls far short', () => {
    expect(
      successProbability({
        target: fromRupees(3_000_000),
        projected: fromRupees(1_000_000),
        months: 120,
        volatility: 0.15,
      }),
    ).toBeLessThan(0.05);
  });

  it('is about even money when the projection lands exactly on target', () => {
    expect(
      successProbability({
        target: fromRupees(2_000_000),
        projected: fromRupees(2_000_000),
        months: 120,
        volatility: 0.15,
      }),
    ).toBeCloseTo(0.5, 2);
  });

  it('falls as volatility rises for a projection that only just clears', () => {
    const args = { target: fromRupees(2_000_000), projected: fromRupees(2_200_000), months: 120 };
    expect(successProbability({ ...args, volatility: 0.3 })).toBeLessThan(
      successProbability({ ...args, volatility: 0.1 }),
    );
  });

  it('is a certainty either way once there is no time left', () => {
    expect(
      successProbability({ target: fromRupees(100), projected: fromRupees(200), months: 0, volatility: 0.15 }),
    ).toBe(1);
    expect(
      successProbability({ target: fromRupees(200), projected: fromRupees(100), months: 0, volatility: 0.15 }),
    ).toBe(0);
  });

  it('always returns a finite probability in [0, 1]', () => {
    for (const projected of [0, 1, 1_000_000, 100_000_000]) {
      const p = successProbability({
        target: fromRupees(1_000_000),
        projected: projected as Paise,
        months: 60,
        volatility: 0.15,
      });
      expect(Number.isFinite(p)).toBe(true);
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(1);
    }
  });
});

describe('assessGoal', () => {
  function goal(overrides: Partial<Goal> = {}): Goal {
    return {
      id: 'goal.house',
      name: 'House down payment',
      kind: 'house',
      targetAmount: fromRupees(5_000_000),
      targetDate: '2036-09-01',
      currentAmount: fromRupees(500_000),
      monthlyContribution: fromRupees(25_000),
      expectedReturn: 0.11,
      priority: 1,
      createdAt: '2026-09-01T00:00:00.000Z',
      ...overrides,
    };
  }

  const asOf = new Date('2026-09-28T00:00:00.000Z');

  it('reports the shortfall and the contribution that would close it', () => {
    const result = assessGoal(goal({ monthlyContribution: fromRupees(5_000) }), asOf);
    expect(result.onTrack).toBe(false);
    expect(result.shortfall).toBeGreaterThan(0);
    expect(result.requiredMonthly).toBeGreaterThan(result.currentMonthly);
    expect(result.additionalMonthly).toBe(result.requiredMonthly - result.currentMonthly);
  });

  it('recognises an on-track goal and asks for nothing extra', () => {
    const result = assessGoal(goal({ monthlyContribution: fromRupees(60_000) }), asOf);
    expect(result.onTrack).toBe(true);
    expect(result.shortfall).toBe(0);
    expect(result.additionalMonthly).toBe(0);
  });

  it('handles a target date in the past without producing negative months', () => {
    const result = assessGoal(goal({ targetDate: '2020-01-01' }), asOf);
    expect(result.monthsRemaining).toBe(0);
    expect(Number.isFinite(result.successProbability)).toBe(true);
  });

  it('projects the corpus forward, not just the contributions', () => {
    const richer = assessGoal(goal({ currentAmount: fromRupees(3_000_000) }), asOf);
    const poorer = assessGoal(goal({ currentAmount: fromRupees(100_000) }), asOf);
    expect(richer.projected).toBeGreaterThan(poorer.projected);
  });
});

describe('suggestAllocation', () => {
  it('reduces equity with age', () => {
    expect(suggestAllocation(30, 'moderate').equity).toBeGreaterThan(
      suggestAllocation(55, 'moderate').equity,
    );
  });

  it('shifts with risk appetite', () => {
    expect(suggestAllocation(35, 'aggressive').equity).toBeGreaterThan(
      suggestAllocation(35, 'conservative').equity,
    );
  });

  it('caps equity at 85% — a portfolio abandoned in a drawdown returns nothing', () => {
    expect(suggestAllocation(22, 'aggressive').equity).toBeLessThanOrEqual(85);
  });

  it('keeps a floor of 30% equity even for a cautious retiree', () => {
    expect(suggestAllocation(80, 'conservative').equity).toBeGreaterThanOrEqual(30);
  });

  it('always sums to 100%', () => {
    for (const age of [22, 30, 45, 60, 75, 90]) {
      for (const risk of ['conservative', 'moderate', 'aggressive'] as const) {
        const a = suggestAllocation(age, risk);
        expect(a.equity + a.debt + a.gold).toBe(100);
      }
    }
  });
});

describe('project and monthsBetween', () => {
  it('project sums the lump-sum and SIP components', () => {
    const present = fromRupees(500_000);
    const monthly = fromRupees(20_000);
    expect(project(present, monthly, 0.11, 120)).toBe(
      futureValueLumpSum(present, 0.11, 120) + futureValueSip(monthly, 0.11, 120),
    );
  });

  it('monthsBetween counts whole calendar months and can go negative', () => {
    expect(monthsBetween(new Date('2026-01-15'), new Date('2027-01-15'))).toBe(12);
    expect(monthsBetween(new Date('2026-09-01'), new Date('2026-06-01'))).toBe(-3);
  });
});
