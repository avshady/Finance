/**
 * Prepayment simulation, refinance comparison, and multi-loan payoff optimisation.
 *
 * Everything here answers one of three questions a borrower actually has:
 *   1. If I put ₹X at this loan, what do I get back?
 *   2. Should I prepay this loan or invest the money instead?
 *   3. I have several loans and ₹Y spare — which one gets it?
 */

import {
  ZERO,
  add,
  paise,
  scale,
  subtract,
  sum,
  type Paise,
} from '../domain/money';
import type { IsoDate, Loan } from '../domain/types';
import {
  buildSchedule,
  effectiveRate,
  monthlyRate,
  nextEmiDate,
  remainingSchedule,
  tenureForEmi,
} from './amortization';

// ---------------------------------------------------------------------------
// Single-loan prepayment
// ---------------------------------------------------------------------------

export interface PrepaymentResult {
  loanId: string;
  /** Amount put in. */
  amount: Paise;
  /** Interest paid over the remaining life if nothing changes. */
  baselineInterest: Paise;
  /** Interest paid over the remaining life after the prepayment. */
  newInterest: Paise;
  /** baselineInterest − newInterest − penalty. The honest saving. */
  interestSaved: Paise;
  /** Prepayment penalty charged, if any. */
  penalty: Paise;
  baselineMonths: number;
  newMonths: number;
  monthsSaved: number;
  baselinePayoffDate: IsoDate;
  newPayoffDate: IsoDate;
  /**
   * Annualised return this prepayment earns, as a decimal. This is the figure to
   * compare against an investment alternative — and it is risk-free, which a market
   * return is not.
   */
  impliedAnnualReturn: number;
}

/**
 * Simulate a one-off lump-sum prepayment that reduces tenure (keeping the EMI fixed).
 *
 * Tenure reduction, not EMI reduction, is the default because it saves dramatically
 * more interest — the same lump sum against a 15-year balance either cuts ~2 years off
 * the end or shaves a few hundred rupees off each instalment. Lenders default to the
 * latter. `simulateEmiReduction` below covers the case where cash flow is the binding
 * constraint.
 */
export function simulatePrepayment(loan: Loan, amount: Paise): PrepaymentResult {
  const penaltyRate = loan.prepaymentPenaltyRate ?? 0;
  const penalty = scale(amount, penaltyRate);

  const baseline = remainingSchedule(loan);

  const reducedPrincipal = paise(Math.max(loan.outstanding - amount, 0));
  const start = nextEmiDate(loan);

  let newInterest = ZERO;
  let newMonths = 0;
  let newPayoffDate = start;
  let newPayments: Paise[] = [];

  if (reducedPrincipal > 0) {
    const months = tenureForEmi(reducedPrincipal, loan.annualRate, loan.emiAmount);
    if (months === null) {
      // The EMI cannot service even the reduced balance; treat as no change.
      return {
        loanId: loan.id,
        amount,
        baselineInterest: baseline.totalInterest,
        newInterest: baseline.totalInterest,
        interestSaved: ZERO,
        penalty,
        baselineMonths: baseline.months,
        newMonths: baseline.months,
        monthsSaved: 0,
        baselinePayoffDate: baseline.payoffDate,
        newPayoffDate: baseline.payoffDate,
        impliedAnnualReturn: 0,
      };
    }
    const after = buildSchedule({
      principal: reducedPrincipal,
      annualRate: loan.annualRate,
      emiAmount: loan.emiAmount,
      tenureMonths: months,
      startDate: start,
    });
    newInterest = after.totalInterest;
    newMonths = after.months;
    newPayoffDate = after.payoffDate;
    newPayments = after.rows.map((row) => row.payment);
  }

  const interestSaved = subtract(subtract(baseline.totalInterest, newInterest), penalty);
  const monthsSaved = baseline.months - newMonths;

  return {
    loanId: loan.id,
    amount,
    baselineInterest: baseline.totalInterest,
    newInterest,
    interestSaved,
    penalty,
    baselineMonths: baseline.months,
    newMonths,
    monthsSaved,
    baselinePayoffDate: baseline.payoffDate,
    newPayoffDate,
    impliedAnnualReturn:
      irr(
        -add(amount, penalty),
        avoidedPayments(
          baseline.rows.map((row) => row.payment),
          newPayments,
        ),
      ) ?? 0,
  };
}

/** Prepayment applied as a lower EMI over the original tenure — the cash-flow choice. */
export function simulateEmiReduction(
  loan: Loan,
  amount: Paise,
): { newEmi: Paise; monthlyRelief: Paise; interestSaved: Paise } {
  const baseline = remainingSchedule(loan);
  const remainingMonths = Math.max(loan.tenureMonths - loan.paidInstalments, 1);
  const reduced = paise(Math.max(loan.outstanding - amount, 0));

  if (reduced === 0) {
    return { newEmi: ZERO, monthlyRelief: loan.emiAmount, interestSaved: baseline.totalInterest };
  }

  const after = buildSchedule({
    principal: reduced,
    annualRate: loan.annualRate,
    tenureMonths: remainingMonths,
    startDate: nextEmiDate(loan),
  });
  const newEmi = after.rows[0]?.payment ?? ZERO;

  return {
    newEmi,
    monthlyRelief: subtract(loan.emiAmount, newEmi),
    interestSaved: subtract(baseline.totalInterest, after.totalInterest),
  };
}

/** Recurring extra payment every month, rather than one lump sum. */
export function simulateExtraMonthly(loan: Loan, extra: Paise): PrepaymentResult {
  const baseline = remainingSchedule(loan);
  const after = remainingSchedule(loan, extra);
  const interestSaved = subtract(baseline.totalInterest, after.totalInterest);
  const monthsSaved = baseline.months - after.months;
  const totalExtraPaid = scale(extra, after.months);

  return {
    loanId: loan.id,
    amount: totalExtraPaid,
    baselineInterest: baseline.totalInterest,
    newInterest: after.totalInterest,
    interestSaved,
    penalty: ZERO,
    baselineMonths: baseline.months,
    newMonths: after.months,
    monthsSaved,
    baselinePayoffDate: baseline.payoffDate,
    newPayoffDate: after.payoffDate,
    // Nothing leaves today: the extra is an outflow every month until the loan closes,
    // and the payoff is the instalments avoided once it has. So the stream compares the
    // baseline instalments against the accelerated ones *including* the extra.
    impliedAnnualReturn:
      irr(
        0,
        avoidedPayments(
          baseline.rows.map((row) => row.payment),
          after.rows.map((row) => add(row.payment, extra)),
        ),
      ) ?? 0,
  };
}

/**
 * Internal rate of return of a monthly cash-flow stream.
 *
 * `atTimeZero` is the flow today; `monthly[i]` is the flow at the end of month i+1.
 * Negative is money out, positive is money in.
 *
 * This exists because the intuitive shortcut — interest saved divided by the amount put
 * in, annualised over some chosen horizon — is badly wrong, and wrong in the flattering
 * direction. It reports 40%+ on an 8.6% home loan, because the "saving" is a nominal sum
 * collected over twenty years while the horizon picked is the handful of months the loan
 * shortened by. Discounting is the whole point: a rupee of interest avoided in 2044 is
 * not worth a rupee today.
 *
 * For a fixed-rate loan with no penalty, the IRR of a prepayment comes out at the loan's
 * own interest rate. That is the correct answer, and it is the number that can honestly
 * sit beside an expected market return.
 *
 * Returns null when the stream has no meaningful IRR (no outflow, or it never pays back).
 */
export function irr(atTimeZero: number, monthly: readonly number[]): number | null {
  const npv = (rate: number): number =>
    monthly.reduce((acc, flow, i) => acc + flow / Math.pow(1 + rate, i + 1), atTimeZero);

  // NPV is decreasing in the rate for a conventional stream (outflows first, inflows
  // after), so a sign change over the bracket guarantees bisection converges.
  const lo0 = 0;
  const hi0 = 1; // 100% per month; nothing realistic exceeds this
  if (npv(lo0) <= 0) return null; // never pays for itself, e.g. a heavy exit penalty
  if (npv(hi0) > 0) return Math.pow(1 + hi0, 12) - 1; // pegged at the bracket

  let lo = lo0;
  let hi = hi0;
  for (let i = 0; i < 128; i += 1) {
    const mid = (lo + hi) / 2;
    if (npv(mid) > 0) lo = mid;
    else hi = mid;
  }
  return Math.pow(1 + (lo + hi) / 2, 12) - 1;
}

/** Per-period difference between two payment streams, zero-padded to the longer one. */
function avoidedPayments(
  baseline: readonly Paise[],
  replacement: readonly Paise[],
): number[] {
  const horizon = Math.max(baseline.length, replacement.length);
  const flows: number[] = [];
  for (let t = 0; t < horizon; t += 1) {
    flows.push((baseline[t] ?? 0) - (replacement[t] ?? 0));
  }
  return flows;
}

// ---------------------------------------------------------------------------
// Prepay vs invest
// ---------------------------------------------------------------------------

export interface PrepayVsInvestResult {
  loanId: string;
  amount: Paise;
  /** Headline contractual rate. */
  nominalRate: number;
  /** Rate after interest-side tax relief — the real cost of carrying the loan. */
  effectiveLoanRate: number;
  /** Expected portfolio return, net of the tax drag on gains. */
  netInvestmentReturn: number;
  /** Wealth after the horizon if the money is prepaid (interest avoided). */
  prepayValue: Paise;
  /** Wealth after the horizon if the money is invested instead. */
  investValue: Paise;
  verdict: 'prepay' | 'invest' | 'neutral';
  /** Rupee advantage of the recommended choice over the other. */
  advantage: Paise;
  reasoning: string;
}

export interface PrepayVsInvestInput {
  loan: Loan;
  amount: Paise;
  /** Expected nominal annual portfolio return, decimal. */
  expectedReturn: number;
  /** Marginal income-tax rate as a decimal. Pass 0 under the new regime. */
  marginalTaxRate: number;
  /** Effective tax on investment gains. 0.125 approximates post-2024 LTCG on equity. */
  capitalGainsRate?: number;
}

/**
 * The comparison most tools get backwards.
 *
 * Both sides are taxed correctly: the loan side is credited with interest-side relief
 * (§24(b), §80E), and the investment side is charged capital gains on its profit. A
 * sub-2-percentage-point gap is reported as neutral, because the certainty of a
 * guaranteed debt payoff is worth roughly that much against an expected market return
 * that carries real variance.
 */
export function prepayVsInvest(input: PrepayVsInvestInput): PrepayVsInvestResult {
  const { loan, amount, expectedReturn, marginalTaxRate } = input;
  const cgRate = input.capitalGainsRate ?? 0.125;

  const effectiveLoanRate = effectiveRate(loan, marginalTaxRate);
  const prepayment = simulatePrepayment(loan, amount);

  // Horizon: the remaining life of the loan, so both options are judged over the same period.
  const months = prepayment.baselineMonths;
  const years = months / 12;

  // Prepay side: the interest avoided, net of any penalty. Already computed.
  const prepayValue = add(amount, prepayment.interestSaved);

  // Invest side: compound at the expected return, then tax the gain.
  const gross = scale(amount, Math.pow(1 + expectedReturn, years));
  const gain = subtract(gross, amount);
  const investValue = subtract(gross, scale(gain, cgRate));

  const netInvestmentReturn =
    years > 0 && amount > 0 ? Math.pow(investValue / amount, 1 / years) - 1 : 0;

  const diff = subtract(prepayValue, investValue);
  const gap = Math.abs(netInvestmentReturn - effectiveLoanRate);

  let verdict: PrepayVsInvestResult['verdict'];
  if (gap < 0.02) verdict = 'neutral';
  else verdict = diff > 0 ? 'prepay' : 'invest';

  return {
    loanId: loan.id,
    amount,
    nominalRate: loan.annualRate,
    effectiveLoanRate,
    netInvestmentReturn,
    prepayValue,
    investValue,
    verdict,
    advantage: paise(Math.abs(diff)),
    reasoning: buildPrepayReasoning({
      loan,
      effectiveLoanRate,
      netInvestmentReturn,
      verdict,
      gap,
    }),
  };
}

function buildPrepayReasoning(args: {
  loan: Loan;
  effectiveLoanRate: number;
  netInvestmentReturn: number;
  verdict: PrepayVsInvestResult['verdict'];
  gap: number;
}): string {
  const { loan, effectiveLoanRate, netInvestmentReturn, verdict } = args;
  const pct = (n: number) => `${(n * 100).toFixed(2)}%`;
  const relief =
    effectiveLoanRate < loan.annualRate - 1e-9
      ? ` Its headline rate is ${pct(loan.annualRate)}, but ${
          loan.taxBenefit?.section === '80E' ? '§80E' : '§24(b)'
        } interest relief brings the real cost down to ${pct(effectiveLoanRate)}.`
      : '';

  if (verdict === 'prepay') {
    return `Paying this down is a guaranteed ${pct(effectiveLoanRate)} return, against ${pct(
      netInvestmentReturn,
    )} expected after tax from investing — and the loan payoff carries no variance.${relief}`;
  }
  if (verdict === 'invest') {
    return `Investing is expected to net ${pct(netInvestmentReturn)} after capital-gains tax, above this loan's real cost of ${pct(
      effectiveLoanRate,
    )}.${relief} Prepaying would buy certainty at the price of long-run return.`;
  }
  return `The two are within two percentage points (${pct(effectiveLoanRate)} guaranteed against ${pct(
    netInvestmentReturn,
  )} expected).${relief} At that margin the certain option is defensible; decide on how much the peace of mind is worth to you.`;
}

// ---------------------------------------------------------------------------
// Refinance / balance transfer
// ---------------------------------------------------------------------------

export interface RefinanceResult {
  currentInterest: Paise;
  newInterest: Paise;
  /** Net of processing fees and the exit penalty. */
  netSaving: Paise;
  upfrontCost: Paise;
  newEmi: Paise;
  emiChange: Paise;
  /** Months until the saving covers the upfront cost. */
  breakEvenMonths: number | null;
  worthIt: boolean;
}

export function evaluateRefinance(
  loan: Loan,
  newAnnualRate: number,
  options: { processingFee?: Paise; newTenureMonths?: number } = {},
): RefinanceResult {
  const processingFee = options.processingFee ?? ZERO;
  const exitPenalty = scale(loan.outstanding, loan.prepaymentPenaltyRate ?? 0);
  const upfrontCost = add(processingFee, exitPenalty);

  const baseline = remainingSchedule(loan);
  const tenure = options.newTenureMonths ?? baseline.months;

  const after = buildSchedule({
    principal: loan.outstanding,
    annualRate: newAnnualRate,
    tenureMonths: tenure,
    startDate: nextEmiDate(loan),
  });

  const newEmi = after.rows[0]?.payment ?? ZERO;
  const netSaving = subtract(subtract(baseline.totalInterest, after.totalInterest), upfrontCost);
  const monthlySaving = subtract(loan.emiAmount, newEmi);

  const breakEvenMonths =
    monthlySaving > 0 ? Math.ceil(upfrontCost / monthlySaving) : null;

  return {
    currentInterest: baseline.totalInterest,
    newInterest: after.totalInterest,
    netSaving,
    upfrontCost,
    newEmi,
    emiChange: subtract(newEmi, loan.emiAmount),
    breakEvenMonths,
    // A saving that only materialises past the loan's remaining life is not a saving.
    worthIt:
      netSaving > 0 && (breakEvenMonths === null || breakEvenMonths <= baseline.months),
  };
}

// ---------------------------------------------------------------------------
// Multi-loan payoff strategy
// ---------------------------------------------------------------------------

export type PayoffStrategy = 'avalanche' | 'snowball';

export interface PayoffPlanStep {
  loanId: string;
  loanName: string;
  order: number;
  /** Month index, from now, when this loan closes under the plan. */
  clearedInMonth: number;
  interestPaid: Paise;
}

export interface PayoffPlan {
  strategy: PayoffStrategy;
  steps: PayoffPlanStep[];
  totalInterest: Paise;
  debtFreeInMonths: number;
}

export interface StrategyComparison {
  avalanche: PayoffPlan;
  snowball: PayoffPlan;
  /** Extra interest paid by choosing snowball over avalanche. */
  snowballExtraCost: Paise;
  snowballExtraMonths: number;
  recommendation: PayoffStrategy;
  reasoning: string;
}

/**
 * Simulate the debt snowball/avalanche with a shared surplus.
 *
 * Both strategies pay every minimum, then throw the surplus at one target loan. When
 * that loan closes, its freed EMI joins the surplus — the snowball effect. The only
 * difference is target order: avalanche takes the highest rate first (mathematically
 * optimal), snowball the smallest balance first (a faster first win).
 */
export function buildPayoffPlan(
  loans: Loan[],
  monthlySurplus: Paise,
  strategy: PayoffStrategy,
): PayoffPlan {
  const active = loans.filter((l) => !l.closed && l.outstanding > 0);

  const order = [...active].sort((a, b) =>
    strategy === 'avalanche'
      ? b.annualRate - a.annualRate || a.outstanding - b.outstanding
      : a.outstanding - b.outstanding || b.annualRate - a.annualRate,
  );

  const state = new Map<string, { balance: Paise; interest: Paise; emi: Paise; rate: number }>();
  for (const loan of active) {
    state.set(loan.id, {
      balance: loan.outstanding,
      interest: ZERO,
      emi: loan.emiAmount,
      rate: monthlyRate(loan.annualRate),
    });
  }

  const steps: PayoffPlanStep[] = [];
  let month = 0;
  let freedEmi = ZERO;
  let cleared = 0;

  while (cleared < order.length && month < 600) {
    month += 1;

    // Accrue interest and apply each loan's own minimum.
    for (const loan of order) {
      const s = state.get(loan.id);
      if (!s || s.balance <= 0) continue;
      const interest = scale(s.balance, s.rate);
      s.interest = add(s.interest, interest);
      const principalPart = paise(Math.min(Math.max(s.emi - interest, 0), s.balance));
      s.balance = subtract(s.balance, principalPart);
    }

    // Direct the surplus plus every freed EMI at the current target, cascading into the
    // next target when one closes mid-month.
    let available = add(monthlySurplus, freedEmi);
    for (const loan of order) {
      if (available <= 0) break;
      const s = state.get(loan.id);
      if (!s || s.balance <= 0) continue;
      const applied = paise(Math.min(available, s.balance));
      s.balance = subtract(s.balance, applied);
      available = subtract(available, applied);
    }

    // Record closures and recycle their instalments.
    for (const loan of order) {
      const s = state.get(loan.id);
      if (!s || s.balance > 0) continue;
      if (steps.some((step) => step.loanId === loan.id)) continue;
      cleared += 1;
      freedEmi = add(freedEmi, s.emi);
      steps.push({
        loanId: loan.id,
        loanName: loan.name,
        order: cleared,
        clearedInMonth: month,
        interestPaid: s.interest,
      });
    }
  }

  return {
    strategy,
    steps,
    totalInterest: sum([...state.values()].map((s) => s.interest)),
    debtFreeInMonths: month,
  };
}

/**
 * Run both strategies and price the difference.
 *
 * The point is not to declare avalanche the winner — it always wins on arithmetic. It
 * is to tell the user exactly what snowball costs, so someone who needs an early win to
 * stay motivated can choose it knowingly rather than be lectured out of it. A plan
 * abandoned in month three saves nothing.
 */
export function compareStrategies(loans: Loan[], monthlySurplus: Paise): StrategyComparison {
  const avalanche = buildPayoffPlan(loans, monthlySurplus, 'avalanche');
  const snowball = buildPayoffPlan(loans, monthlySurplus, 'snowball');

  const extraCost = subtract(snowball.totalInterest, avalanche.totalInterest);
  const extraMonths = snowball.debtFreeInMonths - avalanche.debtFreeInMonths;

  const firstWinAvalanche = avalanche.steps[0]?.clearedInMonth ?? Infinity;
  const firstWinSnowball = snowball.steps[0]?.clearedInMonth ?? Infinity;
  const winSooner = firstWinAvalanche - firstWinSnowball;

  const rupees = (p: Paise) => `₹${Math.round(p / 100).toLocaleString('en-IN')}`;

  let reasoning: string;
  if (extraCost <= 0) {
    reasoning =
      'Both orders cost the same here, so take the snowball: you close a loan sooner at no extra interest.';
  } else if (extraCost < 500000 && winSooner >= 3) {
    reasoning = `Avalanche saves ${rupees(extraCost)} in interest, but snowball clears its first loan ${winSooner} months earlier. At that price the early win is worth it if it keeps you on the plan.`;
  } else {
    reasoning = `Avalanche is the better plan: paying the highest-rate debt first saves ${rupees(
      extraCost,
    )} in interest${extraMonths > 0 ? ` and gets you debt-free ${extraMonths} months sooner` : ''}.`;
  }

  return {
    avalanche,
    snowball,
    snowballExtraCost: extraCost,
    snowballExtraMonths: extraMonths,
    recommendation:
      extraCost <= 0 || (extraCost < 500000 && winSooner >= 3) ? 'snowball' : 'avalanche',
    reasoning,
  };
}
