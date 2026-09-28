import { describe, expect, it } from 'vitest';

import { fromRupees, toRupees, type Paise } from '../domain/money';
import type { Loan } from '../domain/types';
import {
  addMonths,
  buildSchedule,
  computeEmi,
  effectiveRate,
  interestShareOfNextEmi,
  remainingSchedule,
  tenureForEmi,
} from './amortization';
import { compareStrategies, evaluateRefinance, prepayVsInvest, simulatePrepayment } from './payoff';

/**
 * Build a Loan fixture. When the rate, principal or tenure is overridden the EMI is
 * recomputed from the merged values unless the caller supplies one explicitly — a
 * fixture carrying an EMI from a different rate is not a loan any lender would issue,
 * and the engine correctly refuses to amortize it.
 */
function loan(overrides: Partial<Loan> = {}): Loan {
  const base: Loan = {
    id: 'loan-1',
    name: 'Test loan',
    kind: 'home',
    principal: fromRupees(5_000_000),
    outstanding: fromRupees(5_000_000),
    annualRate: 0.086,
    rateType: 'floating',
    tenureMonths: 240,
    paidInstalments: 0,
    emiAmount: computeEmi(fromRupees(5_000_000), 0.086, 240),
    emiDay: 5,
    startDate: '2026-10-05',
    createdAt: '2026-09-28T00:00:00.000Z',
    updatedAt: '2026-09-28T00:00:00.000Z',
  };
  const merged = { ...base, ...overrides };
  if (overrides.emiAmount === undefined) {
    merged.emiAmount = computeEmi(merged.principal, merged.annualRate, merged.tenureMonths);
  }
  return merged;
}

describe('computeEmi', () => {
  it('matches the standard amortization formula for a ₹50L / 8.6% / 240m loan', () => {
    // Independently: r=0.0071667, n=240 -> EMI ≈ ₹43,708
    const emi = computeEmi(fromRupees(5_000_000), 0.086, 240);
    expect(toRupees(emi)).toBeCloseTo(43708, 0);
  });

  it('is rounded to the whole rupee, as lenders quote it', () => {
    const emi = computeEmi(fromRupees(1_234_567), 0.1123, 77);
    expect(emi % 100).toBe(0);
  });

  it('divides straight-line at a 0% rate (the "no cost EMI" case)', () => {
    const emi = computeEmi(fromRupees(24_000), 0, 12);
    expect(toRupees(emi)).toBe(2000);
  });

  it('returns zero for a cleared balance', () => {
    expect(computeEmi(0 as Paise, 0.1, 12)).toBe(0);
  });

  it('rejects a non-positive tenure', () => {
    expect(() => computeEmi(fromRupees(1000), 0.1, 0)).toThrow(RangeError);
  });
});

describe('buildSchedule', () => {
  it('closes at exactly zero — no float residue after 240 instalments', () => {
    const schedule = buildSchedule({
      principal: fromRupees(5_000_000),
      annualRate: 0.086,
      tenureMonths: 240,
      startDate: '2026-10-05',
    });
    const last = schedule.rows[schedule.rows.length - 1];
    expect(last.balance).toBe(0);
  });

  it('reconciles: sum of principal parts equals the original principal', () => {
    const principal = fromRupees(5_000_000);
    const schedule = buildSchedule({
      principal,
      annualRate: 0.086,
      tenureMonths: 240,
      startDate: '2026-10-05',
    });
    const principalPaid = schedule.rows.reduce((a, r) => a + r.principal, 0);
    expect(principalPaid).toBe(principal);
  });

  it('reconciles: totalPaid equals principal plus totalInterest', () => {
    const principal = fromRupees(800_000);
    const schedule = buildSchedule({
      principal,
      annualRate: 0.1075,
      tenureMonths: 60,
      startDate: '2026-10-05',
    });
    expect(schedule.totalPaid).toBe(principal + schedule.totalInterest);
  });

  it('front-loads interest: the first instalment is mostly interest on a long loan', () => {
    const schedule = buildSchedule({
      principal: fromRupees(5_000_000),
      annualRate: 0.086,
      tenureMonths: 240,
      startDate: '2026-10-05',
    });
    const first = schedule.rows[0];
    expect(first.interest / first.payment).toBeGreaterThan(0.8);
    const last = schedule.rows[schedule.rows.length - 1];
    expect(last.interest / last.payment).toBeLessThan(0.05);
  });

  it('shortens the schedule when extra principal is paid every month', () => {
    const args = {
      principal: fromRupees(5_000_000),
      annualRate: 0.086,
      tenureMonths: 240,
      startDate: '2026-10-05',
    } as const;
    const baseline = buildSchedule(args);
    const accelerated = buildSchedule({ ...args, extraMonthly: fromRupees(10_000) });

    expect(accelerated.months).toBeLessThan(baseline.months);
    expect(accelerated.totalInterest).toBeLessThan(baseline.totalInterest);
  });

  it('applies a lump sum in the month it is made', () => {
    const args = {
      principal: fromRupees(1_000_000),
      annualRate: 0.09,
      tenureMonths: 60,
      startDate: '2026-10-05',
    } as const;
    const baseline = buildSchedule(args);
    const withLump = buildSchedule({
      ...args,
      lumpSums: [{ month: 6, amount: fromRupees(200_000) }],
    });
    expect(withLump.months).toBeLessThan(baseline.months);
    // The lump sum must be visible as an outsized principal reduction in month 6.
    expect(withLump.rows[5].principal).toBeGreaterThan(baseline.rows[5].principal);
  });

  it('refuses a schedule whose instalment cannot cover the interest', () => {
    expect(() =>
      buildSchedule({
        principal: fromRupees(1_000_000),
        annualRate: 0.24,
        emiAmount: fromRupees(1_000), // interest alone is ₹20,000/month
        tenureMonths: 60,
        startDate: '2026-10-05',
      }),
    ).toThrow(RangeError);
  });
});

describe('tenureForEmi', () => {
  it('inverts computeEmi', () => {
    const emi = computeEmi(fromRupees(2_000_000), 0.09, 180);
    expect(tenureForEmi(fromRupees(2_000_000), 0.09, emi)).toBe(180);
  });

  it('returns null when the payment never amortizes the balance', () => {
    expect(tenureForEmi(fromRupees(1_000_000), 0.24, fromRupees(5_000))).toBeNull();
  });
});

describe('addMonths', () => {
  it('clamps to the end of a short month instead of rolling over', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29'); // leap year
  });

  it('crosses year boundaries', () => {
    expect(addMonths('2026-11-15', 3)).toBe('2027-02-15');
  });
});

describe('effectiveRate', () => {
  it('reduces a home loan rate by §24(b) interest relief', () => {
    // ₹50L at 8.6% accrues ₹4.3L interest; the §24(b) cap is ₹2L, relieved at 30%
    // -> ₹60k saved -> net ₹3.7L on ₹50L = 7.4%.
    const l = loan({ taxBenefit: { section: '24b', annualCap: fromRupees(200_000) } });
    expect(effectiveRate(l, 0.3)).toBeCloseTo(0.074, 3);
  });

  it('gives uncapped relief for an education loan under §80E', () => {
    const l = loan({
      kind: 'education',
      annualRate: 0.1,
      taxBenefit: { section: '80E' },
    });
    // Fully deductible: 10% * (1 - 0.30) = 7%.
    expect(effectiveRate(l, 0.3)).toBeCloseTo(0.07, 4);
  });

  it('leaves the rate untouched under the new regime, where relief is unavailable', () => {
    const l = loan({ taxBenefit: { section: '24b', annualCap: fromRupees(200_000) } });
    expect(effectiveRate(l, 0)).toBe(l.annualRate);
  });

  it('leaves a personal loan untouched — it has no interest deduction', () => {
    const l = loan({ kind: 'personal', annualRate: 0.15, taxBenefit: { section: 'none' } });
    expect(effectiveRate(l, 0.3)).toBe(0.15);
  });
});

describe('interestShareOfNextEmi', () => {
  it('is high early in a long loan — the fact that motivates early prepayment', () => {
    expect(interestShareOfNextEmi(loan())!).toBeGreaterThan(0.8);
  });

  it('is low once the balance is nearly cleared', () => {
    const almostDone = loan({ outstanding: fromRupees(100_000), paidInstalments: 230 });
    expect(interestShareOfNextEmi(almostDone)!).toBeLessThan(0.05);
  });
});

describe('simulatePrepayment', () => {
  it('saves interest and months, and reports an implied return near the loan rate', () => {
    const result = simulatePrepayment(loan(), fromRupees(500_000));
    expect(result.interestSaved).toBeGreaterThan(0);
    expect(result.monthsSaved).toBeGreaterThan(0);
    expect(result.newMonths).toBeLessThan(result.baselineMonths);
    // The IRR of a prepayment on a fixed-rate loan with no penalty IS the loan's rate.
    // This identity is the whole reason the figure is computed by discounting rather
    // than by dividing interest saved by the amount put in.
    expect(result.impliedAnnualReturn).toBeCloseTo(0.086, 2);
  });

  it('reports a lower implied return once a prepayment penalty is charged', () => {
    const clean = simulatePrepayment(loan(), fromRupees(500_000));
    const penalised = simulatePrepayment(loan({ prepaymentPenaltyRate: 0.02 }), fromRupees(500_000));
    expect(penalised.impliedAnnualReturn).toBeLessThan(clean.impliedAnnualReturn);
  });

  it('nets the prepayment penalty out of the reported saving', () => {
    const withPenalty = simulatePrepayment(
      loan({ prepaymentPenaltyRate: 0.02 }),
      fromRupees(500_000),
    );
    const without = simulatePrepayment(loan(), fromRupees(500_000));
    expect(withPenalty.penalty).toBe(fromRupees(10_000));
    expect(withPenalty.interestSaved).toBe(without.interestSaved - fromRupees(10_000));
  });

  it('clears the loan when the prepayment covers the whole balance', () => {
    const result = simulatePrepayment(loan({ outstanding: fromRupees(200_000) }), fromRupees(200_000));
    expect(result.newMonths).toBe(0);
    expect(result.newInterest).toBe(0);
  });

  it('saves more the earlier it is made', () => {
    const early = simulatePrepayment(loan({ paidInstalments: 12 }), fromRupees(500_000));
    const late = simulatePrepayment(
      loan({ paidInstalments: 200, outstanding: fromRupees(1_000_000) }),
      fromRupees(500_000),
    );
    expect(early.interestSaved).toBeGreaterThan(late.interestSaved);
  });
});

describe('prepayVsInvest', () => {
  it('says invest for a tax-advantaged home loan below the expected return', () => {
    const result = prepayVsInvest({
      loan: loan({ taxBenefit: { section: '24b', annualCap: fromRupees(200_000) } }),
      amount: fromRupees(500_000),
      expectedReturn: 0.12,
      marginalTaxRate: 0.3,
    });
    expect(result.effectiveLoanRate).toBeLessThan(result.nominalRate);
    expect(result.verdict).toBe('invest');
  });

  it('says prepay for a high-rate personal loan', () => {
    const result = prepayVsInvest({
      loan: loan({ kind: 'personal', annualRate: 0.16, tenureMonths: 60, paidInstalments: 0 }),
      amount: fromRupees(200_000),
      expectedReturn: 0.11,
      marginalTaxRate: 0.3,
    });
    expect(result.verdict).toBe('prepay');
  });

  it('always says prepay revolving credit-card debt — no portfolio beats 40%', () => {
    const card = loan({
      kind: 'credit_card_revolving',
      annualRate: 0.42,
      principal: fromRupees(150_000),
      outstanding: fromRupees(150_000),
      tenureMonths: 24,
      emiAmount: computeEmi(fromRupees(150_000), 0.42, 24),
    });
    const result = prepayVsInvest({
      loan: card,
      amount: fromRupees(150_000),
      expectedReturn: 0.14,
      marginalTaxRate: 0.3,
    });
    expect(result.verdict).toBe('prepay');
  });

  it('always explains its arithmetic', () => {
    const result = prepayVsInvest({
      loan: loan(),
      amount: fromRupees(500_000),
      expectedReturn: 0.11,
      marginalTaxRate: 0.3,
    });
    expect(result.reasoning).toMatch(/%/);
    expect(result.reasoning.length).toBeGreaterThan(40);
  });
});

describe('evaluateRefinance', () => {
  it('recommends a meaningful rate cut and reports a break-even', () => {
    const result = evaluateRefinance(loan(), 0.076, { processingFee: fromRupees(15_000) });
    expect(result.netSaving).toBeGreaterThan(0);
    expect(result.newEmi).toBeLessThan(loan().emiAmount);
    expect(result.breakEvenMonths).not.toBeNull();
    expect(result.worthIt).toBe(true);
  });

  it('rejects a cut too small to cover its fees', () => {
    const result = evaluateRefinance(loan({ outstanding: fromRupees(300_000), paidInstalments: 200 }), 0.085, {
      processingFee: fromRupees(50_000),
    });
    expect(result.worthIt).toBe(false);
  });

  it('counts the exit penalty as part of the upfront cost', () => {
    const result = evaluateRefinance(loan({ prepaymentPenaltyRate: 0.02 }), 0.076, {
      processingFee: fromRupees(15_000),
    });
    // 2% of ₹50L = ₹1L, plus the ₹15k fee.
    expect(result.upfrontCost).toBe(fromRupees(115_000));
  });
});

describe('compareStrategies', () => {
  const card = loan({
    id: 'card',
    name: 'Credit card',
    kind: 'credit_card_revolving',
    annualRate: 0.4,
    principal: fromRupees(120_000),
    outstanding: fromRupees(120_000),
    tenureMonths: 36,
    emiAmount: fromRupees(6_000),
  });
  const small = loan({
    id: 'durable',
    name: 'Phone EMI',
    kind: 'consumer_durable',
    annualRate: 0.14,
    principal: fromRupees(40_000),
    outstanding: fromRupees(40_000),
    tenureMonths: 12,
    emiAmount: fromRupees(3_600),
  });
  const personal = loan({
    id: 'personal',
    name: 'Personal loan',
    kind: 'personal',
    annualRate: 0.15,
    principal: fromRupees(600_000),
    outstanding: fromRupees(600_000),
    tenureMonths: 48,
    emiAmount: fromRupees(16_700),
  });

  it('avalanche never costs more interest than snowball', () => {
    const c = compareStrategies([card, small, personal], fromRupees(15_000));
    expect(c.avalanche.totalInterest).toBeLessThanOrEqual(c.snowball.totalInterest);
    expect(c.snowballExtraCost).toBeGreaterThanOrEqual(0);
  });

  it('avalanche targets the highest rate first', () => {
    const c = compareStrategies([card, small, personal], fromRupees(15_000));
    expect(c.avalanche.steps[0].loanId).toBe('card');
  });

  it('snowball targets the smallest balance first', () => {
    const c = compareStrategies([card, small, personal], fromRupees(15_000));
    expect(c.snowball.steps[0].loanId).toBe('durable');
  });

  it('clears every loan under both strategies', () => {
    const c = compareStrategies([card, small, personal], fromRupees(15_000));
    expect(c.avalanche.steps).toHaveLength(3);
    expect(c.snowball.steps).toHaveLength(3);
  });

  it('recycles a closed loan\'s EMI into the next target', () => {
    // With the snowball effect, three loans clear faster than the slowest alone would
    // suggest; assert the cascade by checking closures are strictly ordered in time.
    const c = compareStrategies([card, small, personal], fromRupees(15_000));
    const months = c.avalanche.steps.map((s) => s.clearedInMonth);
    expect([...months].sort((a, b) => a - b)).toEqual(months);
  });

  it('states the cost of choosing snowball in rupees', () => {
    const c = compareStrategies([card, small, personal], fromRupees(15_000));
    expect(c.reasoning).toMatch(/₹|same/);
  });

  it('handles a single loan without dividing by zero', () => {
    const c = compareStrategies([personal], fromRupees(5_000));
    expect(c.avalanche.steps).toHaveLength(1);
    expect(c.snowballExtraCost).toBe(0);
  });

  it('handles an empty portfolio', () => {
    const c = compareStrategies([], fromRupees(5_000));
    expect(c.avalanche.steps).toHaveLength(0);
    expect(c.avalanche.debtFreeInMonths).toBe(0);
  });
});

describe('remainingSchedule', () => {
  it('starts from the outstanding balance, not the original principal', () => {
    const partiallyPaid = loan({ paidInstalments: 60, outstanding: fromRupees(4_200_000) });
    const schedule = remainingSchedule(partiallyPaid);
    expect(schedule.rows[0].balance).toBeLessThan(fromRupees(4_200_000));
    expect(schedule.months).toBeLessThanOrEqual(180);
  });
});
