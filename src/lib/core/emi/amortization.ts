/**
 * Loan amortization in integer paise.
 *
 * Every figure here is reconstructed by iterating the schedule rather than by a
 * closed-form shortcut. Closed forms drift: they assume an unrounded instalment, but a
 * real lender rounds the EMI to the rupee and then absorbs the difference in the final
 * instalment. Over 240 months that difference is thousands of rupees, and "total
 * interest" is exactly the number the user makes a prepayment decision on.
 */

import {
  ZERO,
  abs,
  add,
  paise,
  scale,
  subtract,
  sum,
  type Paise,
} from '../domain/money';
import type { AmortizationRow, AmortizationSchedule, IsoDate, Loan } from '../domain/types';

/** Guard: a schedule that has not closed after this many months is not converging. */
const MAX_INSTALMENTS = 1200; // 100 years

export function monthlyRate(annualRate: number): number {
  if (!Number.isFinite(annualRate) || annualRate < 0) {
    throw new RangeError(`monthlyRate: bad annual rate: ${annualRate}`);
  }
  return annualRate / 12;
}

/**
 * Standard EMI: P·r·(1+r)^n / ((1+r)^n − 1), rounded to the rupee as lenders do.
 * Falls back to straight-line division at a 0% rate (the "no cost EMI" case).
 */
export function computeEmi(principal: Paise, annualRate: number, tenureMonths: number): Paise {
  if (!Number.isInteger(tenureMonths) || tenureMonths <= 0) {
    throw new RangeError(`computeEmi: bad tenure: ${tenureMonths}`);
  }
  if (principal <= 0) return ZERO;

  const r = monthlyRate(annualRate);
  if (r === 0) return roundToRupee(paise(Math.ceil(principal / tenureMonths)));

  const growth = Math.pow(1 + r, tenureMonths);
  const exact = (principal * r * growth) / (growth - 1);
  return roundToRupee(paise(Math.round(exact)));
}

/**
 * Tenure implied by a given instalment. Used to answer "if I pay ₹5,000 more a month,
 * when does this close?" — the question behind every prepayment decision.
 * Returns null when the instalment cannot service the interest (the loan never closes).
 */
export function tenureForEmi(
  principal: Paise,
  annualRate: number,
  emiAmount: Paise,
): number | null {
  if (principal <= 0) return 0;
  const r = monthlyRate(annualRate);
  if (r === 0) return Math.ceil(principal / emiAmount);

  const monthlyInterest = scale(principal, r);
  if (emiAmount <= monthlyInterest) return null; // negative amortization

  const n = Math.log(emiAmount / (emiAmount - principal * r)) / Math.log(1 + r);
  if (!Number.isFinite(n)) return null;

  // `computeEmi` rounds the instalment to the rupee, so the exact tenure often lands a
  // hair above a whole month (180.0004). Taking a naive ceiling there invents a 181st
  // instalment of a few rupees and reports a tenure one month longer than the lender
  // does. Absorb a residual worth under 1% of an instalment into the final payment,
  // which is exactly what `buildSchedule` does when it trims.
  const whole = Math.floor(n);
  if (whole >= 1) {
    const growth = Math.pow(1 + r, whole);
    const residual = principal * growth - (emiAmount * (growth - 1)) / r;
    if (residual <= emiAmount * 0.01) return whole;
  }
  return whole + 1;
}

export interface ScheduleOptions {
  principal: Paise;
  annualRate: number;
  /** Instalment amount. When omitted it is computed from tenureMonths. */
  emiAmount?: Paise;
  tenureMonths: number;
  startDate: IsoDate;
  /** Extra principal paid on top of the EMI, every month. */
  extraMonthly?: Paise;
  /** One-off lump sums, applied after that month's instalment. */
  lumpSums?: Array<{ month: number; amount: Paise }>;
}

/**
 * Build the full schedule.
 *
 * Interest is charged on the opening balance each period; anything left of the payment
 * reduces principal. The final instalment is trimmed to exactly clear the balance, so
 * the schedule ends at zero and never at ±₹37 of float residue.
 */
export function buildSchedule(options: ScheduleOptions): AmortizationSchedule {
  const { principal, annualRate, tenureMonths, startDate } = options;
  const extraMonthly = options.extraMonthly ?? ZERO;
  const emiAmount = options.emiAmount ?? computeEmi(principal, annualRate, tenureMonths);
  const r = monthlyRate(annualRate);

  const lumpByMonth = new Map<number, Paise>();
  for (const { month, amount } of options.lumpSums ?? []) {
    lumpByMonth.set(month, add(lumpByMonth.get(month) ?? ZERO, amount));
  }

  const rows: AmortizationRow[] = [];
  let balance = principal;
  let instalment = 0;

  while (balance > 0 && instalment < MAX_INSTALMENTS) {
    instalment += 1;

    const interest = scale(balance, r);
    let payment = add(emiAmount, extraMonthly, lumpByMonth.get(instalment) ?? ZERO);

    // An instalment that cannot cover the interest means the balance grows forever.
    // Surface that as an error rather than silently emitting 1200 rows.
    if (payment <= interest && balance > 0) {
      throw new RangeError(
        `buildSchedule: instalment ${payment} does not cover interest ${interest}; loan never amortizes`,
      );
    }

    let principalPart = subtract(payment, interest);

    // Final instalment: pay exactly what is owed, no more.
    if (principalPart >= balance) {
      principalPart = balance;
      payment = add(principalPart, interest);
    }

    balance = subtract(balance, principalPart);

    rows.push({
      instalment,
      date: addMonths(startDate, instalment - 1),
      payment,
      interest,
      principal: principalPart,
      balance,
    });
  }

  if (balance > 0) {
    throw new RangeError('buildSchedule: did not amortize within the instalment cap');
  }

  const totalInterest = sum(rows.map((row) => row.interest));
  const totalPaid = sum(rows.map((row) => row.payment));
  const last = rows[rows.length - 1];

  return {
    rows,
    totalInterest,
    totalPaid,
    payoffDate: last?.date ?? startDate,
    months: rows.length,
  };
}

/** Schedule for the remaining life of a loan, starting from today's outstanding. */
export function remainingSchedule(loan: Loan, extraMonthly: Paise = ZERO): AmortizationSchedule {
  const remainingMonths = Math.max(loan.tenureMonths - loan.paidInstalments, 1);
  return buildSchedule({
    principal: loan.outstanding,
    annualRate: loan.annualRate,
    emiAmount: loan.emiAmount,
    tenureMonths: remainingMonths,
    startDate: nextEmiDate(loan),
    extraMonthly,
  });
}

/** Interest still to be paid if nothing changes. The baseline every saving is measured against. */
export function remainingInterest(loan: Loan): Paise {
  return remainingSchedule(loan).totalInterest;
}

/**
 * Total interest already paid, reconstructed from the original schedule.
 * Useful for the sunk-cost figure users ask for, and to sanity-check `outstanding`
 * against what the lender should be reporting.
 */
export function interestPaidToDate(loan: Loan): Paise {
  if (loan.paidInstalments <= 0) return ZERO;
  const full = buildSchedule({
    principal: loan.principal,
    annualRate: loan.annualRate,
    emiAmount: loan.emiAmount,
    tenureMonths: loan.tenureMonths,
    startDate: loan.startDate,
  });
  return sum(full.rows.slice(0, loan.paidInstalments).map((row) => row.interest));
}

/**
 * The single most useful number on a loan: what fraction of the NEXT instalment is
 * interest. Early in a 20-year home loan this is ~80%, which is what makes early
 * prepayment so much more valuable than late prepayment — and it is the fact that
 * motivates users to act.
 */
export function interestShareOfNextEmi(loan: Loan): number | null {
  if (loan.emiAmount <= 0) return null;
  const interest = scale(loan.outstanding, monthlyRate(loan.annualRate));
  return interest / loan.emiAmount;
}

/**
 * Effective post-tax cost of a loan.
 *
 * This is the number that decides prepay-vs-invest, and most tools get it wrong by
 * comparing the headline rate against expected equity returns. A home loan at 8.6%
 * with §24(b) interest relief at a 30% marginal rate effectively costs ~6.0%; telling
 * someone to prepay that instead of investing destroys wealth.
 *
 * `marginalTaxRate` is the user's slab rate as a decimal. Under the new regime most of
 * these deductions are unavailable, so callers should pass 0 there.
 */
export function effectiveRate(loan: Loan, marginalTaxRate: number): number {
  const benefit = loan.taxBenefit;
  if (!benefit || benefit.section === 'none' || marginalTaxRate <= 0) return loan.annualRate;

  const annualInterest = scale(loan.outstanding, loan.annualRate);
  if (annualInterest <= 0) return loan.annualRate;

  // Only interest-side relief reduces the cost of carrying the loan. §80C on home-loan
  // principal is real but is usually already exhausted by EPF/ELSS/insurance, so
  // counting it here would overstate the benefit for most people.
  if (benefit.section !== '24b' && benefit.section !== '80E') return loan.annualRate;

  const deductible = benefit.annualCap === undefined
    ? annualInterest
    : paise(Math.min(annualInterest, benefit.annualCap));

  const relief = scale(deductible, marginalTaxRate);
  const netInterest = subtract(annualInterest, relief);
  return loan.outstanding > 0 ? netInterest / loan.outstanding : loan.annualRate;
}

// ---------------------------------------------------------------------------
// Date helpers. Month arithmetic clamps to the end of short months, so an EMI on
// the 31st does not silently jump into March.
// ---------------------------------------------------------------------------

export function addMonths(isoDate: IsoDate, months: number): IsoDate {
  const [y, m, d] = isoDate.split('-').map(Number);
  if (!y || !m || !d) throw new RangeError(`addMonths: bad date: ${isoDate}`);
  const total = (y * 12 + (m - 1)) + months;
  const year = Math.floor(total / 12);
  const month = total % 12;
  const day = Math.min(d, daysInMonth(year, month));
  return `${pad(year, 4)}-${pad(month + 1, 2)}-${pad(day, 2)}`;
}

function daysInMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

function pad(n: number, width: number): string {
  return String(n).padStart(width, '0');
}

/**
 * Next scheduled EMI date.
 *
 * Derived from the start date and the number of instalments paid. That alone can land in
 * the past whenever `paidInstalments` lags reality - which it routinely does, since it
 * only advances when a payment is actually observed, and a statement can arrive days
 * late. A UI rendering that figure then reports a "next" EMI "in -27 days".
 *
 * Passing `asOf` rolls the date forward whole months to the next occurrence on or after
 * that date, which is the date a borrower would actually name. Omitting it keeps the
 * plain schedule-derived date, which is what the amortization functions want.
 */
export function nextEmiDate(loan: Loan, asOf?: IsoDate): IsoDate {
  const scheduled = addMonths(loan.startDate, loan.paidInstalments);
  if (asOf === undefined || scheduled >= asOf) return scheduled;

  // Step in whole months from the schedule so the EMI day is preserved (and stays
  // clamped for short months by addMonths).
  const monthsBehind =
    (yearOf(asOf) - yearOf(scheduled)) * 12 + (monthOf(asOf) - monthOf(scheduled));
  let candidate = addMonths(scheduled, Math.max(monthsBehind, 0));
  while (candidate < asOf) candidate = addMonths(candidate, 1);
  return candidate;
}

function yearOf(date: IsoDate): number {
  return Number(date.slice(0, 4));
}

function monthOf(date: IsoDate): number {
  return Number(date.slice(5, 7));
}

function roundToRupee(a: Paise): Paise {
  return paise(Math.round(a / 100) * 100);
}

export { abs };
