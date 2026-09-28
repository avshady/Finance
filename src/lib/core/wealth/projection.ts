/**
 * Wealth projection, financial-independence maths, and goal feasibility.
 *
 * Two conventions, stated up front because they change every number here:
 *
 * 1. Contributions compound at the START of each period. A SIP debits on the 1st and is
 *    invested that month, so it earns that month's return. End-of-period compounding
 *    understates a 25-year SIP by roughly one month's growth.
 *
 * 2. Long-horizon figures are reported in REAL terms wherever the caller asks for it.
 *    "You will have ₹8 crore at 60" is close to meaningless at 6% inflation — it is
 *    about ₹1.9 crore of today's money. Nominal projections are what make retirement
 *    plans quietly fail, so `realReturn()` exists and the advisor uses it.
 */

import {
  ZERO,
  add,
  paise,
  scale,
  subtract,
  type Paise,
} from '../domain/money';
import type { Goal } from '../domain/types';

/**
 * Inflation-adjusted return, computed properly via the Fisher relation rather than by
 * subtracting. At 11% nominal and 6% inflation the real return is 4.72%, not 5% — and
 * over 30 years that gap is not cosmetic.
 */
export function realReturn(nominal: number, inflation: number): number {
  return (1 + nominal) / (1 + inflation) - 1;
}

/** Growth of a single lump sum over `months` at an annual rate. */
export function futureValueLumpSum(present: Paise, annualRate: number, months: number): Paise {
  if (months <= 0) return present;
  return scale(present, Math.pow(1 + annualRate / 12, months));
}

/**
 * Future value of a level monthly contribution, invested at the start of each month.
 * FV = C · [((1+r)^n − 1) / r] · (1+r)
 */
export function futureValueSip(monthly: Paise, annualRate: number, months: number): Paise {
  if (months <= 0 || monthly === 0) return ZERO;
  const r = annualRate / 12;
  if (r === 0) return scale(monthly, months);
  const growth = Math.pow(1 + r, months);
  return scale(monthly, ((growth - 1) / r) * (1 + r));
}

/** A starting corpus plus an ongoing monthly contribution. */
export function project(
  present: Paise,
  monthly: Paise,
  annualRate: number,
  months: number,
): Paise {
  return add(futureValueLumpSum(present, annualRate, months), futureValueSip(monthly, annualRate, months));
}

/**
 * Monthly contribution needed to reach a target, given a starting corpus.
 * Returns ZERO when the existing corpus already gets there on its own.
 */
export function requiredSip(
  target: Paise,
  present: Paise,
  annualRate: number,
  months: number,
): Paise {
  if (months <= 0) return subtract(target, present) > 0 ? subtract(target, present) : ZERO;

  const shortfall = subtract(target, futureValueLumpSum(present, annualRate, months));
  if (shortfall <= 0) return ZERO;

  const r = annualRate / 12;
  if (r === 0) return paise(Math.ceil(shortfall / months));

  const growth = Math.pow(1 + r, months);
  return paise(Math.ceil(shortfall / (((growth - 1) / r) * (1 + r))));
}

/** A step-up SIP, where the contribution rises by a fixed percentage each year. */
export function futureValueStepUpSip(
  monthly: Paise,
  annualRate: number,
  months: number,
  annualStepUp: number,
): Paise {
  let balance = ZERO;
  let contribution = monthly;
  const r = annualRate / 12;

  for (let m = 1; m <= months; m += 1) {
    balance = scale(add(balance, contribution), 1 + r);
    if (m % 12 === 0) contribution = scale(contribution, 1 + annualStepUp);
  }
  return balance;
}

// ---------------------------------------------------------------------------
// Financial independence
// ---------------------------------------------------------------------------

/**
 * The corpus at which portfolio withdrawals cover annual expenses.
 *
 * `withdrawalRate` defaults to 3.5% rather than the familiar 4%. The 4% rule comes from
 * US data over a 30-year retirement; for a longer horizon, and for an investor facing
 * Indian inflation, 3.5% (a ~29x multiple) is the more defensible number. Being wrong in
 * this direction means retiring a little later, not running out of money at 78.
 */
export function fiNumber(annualExpenses: Paise, withdrawalRate = 0.035): Paise {
  if (withdrawalRate <= 0) throw new RangeError(`fiNumber: bad withdrawal rate: ${withdrawalRate}`);
  return scale(annualExpenses, 1 / withdrawalRate);
}

export interface FiProjection {
  /** Corpus required, in today's money. */
  target: Paise;
  currentCorpus: Paise;
  monthlyContribution: Paise;
  /** Months until the target is reached. Null when the plan never gets there. */
  monthsToFi: number | null;
  /** Calendar year of FI, when reachable. */
  fiYear: number | null;
  /** Real (inflation-adjusted) return used. */
  realRate: number;
  /** Progress toward the target, 0..1. */
  progress: number;
}

/**
 * Time to financial independence, computed in REAL terms.
 *
 * Because the target is expressed in today's money, the corpus must grow in today's
 * money too — so this discounts the nominal return by inflation. Projecting a nominal
 * corpus against a target in current rupees is the single most common error in
 * retirement calculators, and it overstates readiness by a decade.
 */
export function projectFi(args: {
  annualExpenses: Paise;
  currentCorpus: Paise;
  monthlyContribution: Paise;
  nominalReturn: number;
  inflation: number;
  withdrawalRate?: number;
  /** Current year, for reporting the FI year. */
  currentYear: number;
  /** Real annual growth in the contribution, e.g. 0.03 for above-inflation raises. */
  contributionGrowth?: number;
  maxMonths?: number;
}): FiProjection {
  const {
    annualExpenses,
    currentCorpus,
    monthlyContribution,
    nominalReturn,
    inflation,
    currentYear,
  } = args;
  const maxMonths = args.maxMonths ?? 720; // 60 years
  const target = fiNumber(annualExpenses, args.withdrawalRate);
  const realRate = realReturn(nominalReturn, inflation);
  const r = realRate / 12;

  let balance = currentCorpus;
  let contribution = monthlyContribution;
  let months: number | null = null;

  if (balance >= target) {
    months = 0;
  } else if (monthlyContribution > 0 || realRate > 0) {
    for (let m = 1; m <= maxMonths; m += 1) {
      balance = scale(add(balance, contribution), 1 + r);
      if (args.contributionGrowth && m % 12 === 0) {
        contribution = scale(contribution, 1 + args.contributionGrowth);
      }
      if (balance >= target) {
        months = m;
        break;
      }
    }
  }

  return {
    target,
    currentCorpus,
    monthlyContribution,
    monthsToFi: months,
    fiYear: months === null ? null : currentYear + Math.ceil(months / 12),
    realRate,
    progress: target > 0 ? Math.min(currentCorpus / target, 1) : 0,
  };
}

// ---------------------------------------------------------------------------
// Net-worth trajectory
// ---------------------------------------------------------------------------

export interface TrajectoryPoint {
  month: number;
  year: number;
  /** Invested corpus at this point. */
  corpus: Paise;
  /** Outstanding debt at this point. */
  debt: Paise;
  netWorth: Paise;
}

/**
 * Net-worth path under a given savings and debt-repayment plan.
 * Debt is amortised down alongside the corpus growing, so the curve reflects both.
 */
export function projectTrajectory(args: {
  startingCorpus: Paise;
  monthlySavings: Paise;
  annualReturn: number;
  /** Outstanding debt and the blended monthly payment against it. */
  startingDebt: Paise;
  debtMonthlyPayment: Paise;
  debtAnnualRate: number;
  months: number;
  currentYear: number;
  /** Report the path in today's money. */
  inflation?: number;
}): TrajectoryPoint[] {
  const inflation = args.inflation ?? 0;
  const r = realReturn(args.annualReturn, inflation) / 12;
  const debtRate = args.debtAnnualRate / 12;

  const points: TrajectoryPoint[] = [];
  let corpus = args.startingCorpus;
  let debt = args.startingDebt;

  for (let m = 1; m <= args.months; m += 1) {
    corpus = scale(add(corpus, args.monthlySavings), 1 + r);

    if (debt > 0) {
      const interest = scale(debt, debtRate);
      const principalPart = paise(
        Math.min(Math.max(args.debtMonthlyPayment - interest, 0), debt),
      );
      debt = subtract(debt, principalPart);
    }

    if (m % 12 === 0 || m === args.months) {
      points.push({
        month: m,
        year: args.currentYear + Math.floor(m / 12),
        corpus,
        debt,
        netWorth: subtract(corpus, debt),
      });
    }
  }
  return points;
}

// ---------------------------------------------------------------------------
// Goal feasibility
// ---------------------------------------------------------------------------

export interface GoalFeasibility {
  goalId: string;
  goalName: string;
  target: Paise;
  projected: Paise;
  /** Positive when the plan falls short. */
  shortfall: Paise;
  onTrack: boolean;
  monthsRemaining: number;
  /** Contribution that would actually reach the target. */
  requiredMonthly: Paise;
  currentMonthly: Paise;
  /** Extra needed per month. ZERO when already on track. */
  additionalMonthly: Paise;
  /** Probability of success under return variance, 0..1. */
  successProbability: number;
}

export function assessGoal(goal: Goal, asOf: Date, volatility = 0.15): GoalFeasibility {
  const monthsRemaining = Math.max(monthsBetween(asOf, new Date(goal.targetDate)), 0);

  const projected = project(
    goal.currentAmount,
    goal.monthlyContribution,
    goal.expectedReturn,
    monthsRemaining,
  );
  const shortfall = subtract(goal.targetAmount, projected);
  const required = requiredSip(
    goal.targetAmount,
    goal.currentAmount,
    goal.expectedReturn,
    monthsRemaining,
  );

  return {
    goalId: goal.id,
    goalName: goal.name,
    target: goal.targetAmount,
    projected,
    shortfall: shortfall > 0 ? shortfall : ZERO,
    onTrack: shortfall <= 0,
    monthsRemaining,
    requiredMonthly: required,
    currentMonthly: goal.monthlyContribution,
    additionalMonthly:
      required > goal.monthlyContribution ? subtract(required, goal.monthlyContribution) : ZERO,
    successProbability: successProbability({
      target: goal.targetAmount,
      projected,
      months: monthsRemaining,
      volatility,
    }),
  };
}

/**
 * Probability the goal is met, given return variance.
 *
 * Terminal wealth from a series of contributions is approximated as lognormal, and the
 * probability is the lognormal tail above the target. This is deliberately a closed-form
 * approximation rather than a 10,000-path Monte Carlo: it runs instantly on a phone, it
 * is deterministic (the same inputs give the same answer, which matters when a user
 * refreshes and expects the number not to wobble), and at this precision the honest
 * output is "about 70%", not "71.4%".
 *
 * A goal with no time left is a certainty either way, so variance is ignored there.
 */
export function successProbability(args: {
  target: Paise;
  projected: Paise;
  months: number;
  volatility: number;
}): number {
  const { target, projected, months, volatility } = args;
  if (months <= 0 || projected <= 0) return projected >= target ? 1 : 0;
  if (volatility <= 0) return projected >= target ? 1 : 0;

  const years = months / 12;
  // Contributions are spread over the horizon, so the corpus is exposed to market
  // variance for roughly half of it on average.
  const sigma = volatility * Math.sqrt(Math.max(years / 2, 1 / 12));
  const z = Math.log(projected / target) / sigma;
  return clamp01(normalCdf(z));
}

/** Abramowitz-Stegun 7.1.26 approximation; accurate to ~1e-7, ample here. */
function normalCdf(z: number): number {
  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const erf =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t +
      0.254829592) *
      t *
      Math.exp(-x * x);
  return 0.5 * (1 + sign * erf);
}

function clamp01(n: number): number {
  return Math.min(Math.max(n, 0), 1);
}

export function monthsBetween(from: Date, to: Date): number {
  return (
    (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + (to.getUTCMonth() - from.getUTCMonth())
  );
}

// ---------------------------------------------------------------------------
// Asset allocation
// ---------------------------------------------------------------------------

export interface Allocation {
  equity: number;
  debt: number;
  gold: number;
}

/**
 * Suggested allocation from age and risk appetite.
 *
 * Built off a "110 − age" equity anchor rather than the older "100 − age", which was
 * calibrated for shorter retirements and lower life expectancy. Risk appetite then
 * shifts it ±10 points, and it is clamped to 30–85% equity: a 25-year-old at 95% equity
 * tends to sell at the first 30% drawdown, which costs far more than the extra expected
 * return was worth.
 */
export function suggestAllocation(age: number, risk: 'conservative' | 'moderate' | 'aggressive'): Allocation {
  const anchor = 110 - age;
  const tilt = risk === 'aggressive' ? 10 : risk === 'conservative' ? -10 : 0;
  const equity = Math.round(Math.min(Math.max(anchor + tilt, 30), 85));
  const gold = 10;
  return { equity, gold, debt: 100 - equity - gold };
}
