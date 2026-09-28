/**
 * Spending anomaly detection, built on median + MAD (median absolute deviation) —
 * a robust statistic that doesn't get poisoned by the single outlier a 12-point
 * mean+stddev series is guaranteed to have.
 */

import type { Budget, Category, Transaction } from '../domain/types';
import { abs, add, median, type Paise, ratio, scale, subtract, ZERO } from '../domain/money';
import { monthKey, spendByCategory } from './aggregate';

const MIN_HISTORY_MONTHS = 4;
/** Scale factor that makes MAD comparable to stddev under normality (1/Phi^-1(3/4)). */
const MAD_TO_SIGMA = 1.4826;
/** deviationScore threshold above which we call it an anomaly. */
const ANOMALY_THRESHOLD = 3;

export interface CategoryAnomaly {
  categoryId: string;
  currentMonth: Paise;
  baseline: Paise;
  deviationScore: number;
  excessAmount: Paise;
  direction: 'spike' | 'drop';
}

export interface LargeTransactionFlag {
  transactionId: string;
  categoryId: string;
  amount: Paise;
  typicalAmount: Paise;
  deviationScore: number;
}

export interface NewMerchantFlag {
  merchant: string;
  transactionId: string;
  date: string;
  amount: Paise;
  categoryId: string;
}

export interface VelocityStatus {
  categoryId: string;
  spentSoFar: Paise;
  limit: Paise;
  projectedMonthEnd: Paise;
  paceRatio: number;
  willExceed: boolean;
}

function isSpendTxn(t: Transaction): boolean {
  return (
    !t.excluded &&
    t.direction === 'debit' &&
    t.kind !== 'transfer' &&
    t.kind !== 'investment' &&
    t.kind !== 'income'
  );
}

function normalizeMerchant(t: Transaction): string {
  return (t.merchant ?? t.rawDescription).toUpperCase().trim().replace(/\s+/g, ' ');
}

/** Median absolute deviation, in Paise-space, scaled to be stddev-comparable. */
function mad(values: readonly Paise[], center: Paise): Paise {
  const deviations = values.map((v) => abs(subtract(v, center)));
  return median(deviations);
}

/** Robust z-score: (value - median) / (MAD * 1.4826). Returns 0 when MAD is 0. */
function robustZ(value: Paise, center: Paise, madValue: Paise): number {
  if (madValue === 0) {
    return value === center ? 0 : value > center ? Infinity : -Infinity;
  }
  return (value - center) / (madValue * MAD_TO_SIGMA);
}

/**
 * Per-category anomaly detection for the current calendar month (by `asOf`), against
 * a baseline of that category's prior months. Requires at least MIN_HISTORY_MONTHS of
 * prior history for a category before it can flag anything.
 */
export function detectCategoryAnomalies(
  txns: readonly Transaction[],
  categories: readonly Category[],
  asOf: string,
): CategoryAnomaly[] {
  const currentMonthKey = monthKey(asOf);

  // Build per-category, per-month totals.
  const byCategory = new Map<string, Map<string, Paise>>();
  for (const t of txns) {
    if (!isSpendTxn(t) && t.kind !== 'refund') continue;
    const mk = monthKey(t.date);
    let months = byCategory.get(t.categoryId);
    if (!months) {
      months = new Map();
      byCategory.set(t.categoryId, months);
    }
    const delta = t.kind === 'refund' ? subtract(ZERO, t.amount) : t.amount;
    months.set(mk, add(months.get(mk) ?? ZERO, delta));
  }

  const results: CategoryAnomaly[] = [];

  for (const [categoryId, months] of byCategory) {
    const priorMonthKeys = [...months.keys()].filter((mk) => mk !== currentMonthKey).sort();
    if (priorMonthKeys.length < MIN_HISTORY_MONTHS) continue;

    const priorValues = priorMonthKeys.map((mk) => months.get(mk) ?? ZERO);
    const baseline = median(priorValues);
    const madValue = mad(priorValues, baseline);

    const currentValue = months.get(currentMonthKey) ?? ZERO;
    const score = robustZ(currentValue, baseline, madValue);
    const absScore = Math.abs(score);

    // NaN (e.g. no current-month data and no deviation) is not an anomaly; a genuinely
    // infinite score (MAD is 0 and the current value differs at all) is.
    if (Number.isNaN(absScore) || absScore < ANOMALY_THRESHOLD) continue;

    results.push({
      categoryId,
      currentMonth: currentValue,
      baseline,
      deviationScore: Math.abs(score),
      excessAmount: abs(subtract(currentValue, baseline)),
      direction: currentValue >= baseline ? 'spike' : 'drop',
    });
  }

  return results.sort((a, b) => b.deviationScore - a.deviationScore);
}

/**
 * Single transactions far above their category's typical individual transaction size,
 * for the current month (by `asOf`). Uses median + MAD across each category's
 * historical individual transaction amounts.
 */
export function detectLargeTransactions(
  txns: readonly Transaction[],
  asOf: string,
): LargeTransactionFlag[] {
  const currentMonthKey = monthKey(asOf);
  const byCategory = new Map<string, Transaction[]>();
  for (const t of txns) {
    if (!isSpendTxn(t)) continue;
    const arr = byCategory.get(t.categoryId);
    if (arr) arr.push(t);
    else byCategory.set(t.categoryId, [t]);
  }

  const results: LargeTransactionFlag[] = [];

  for (const [categoryId, catTxns] of byCategory) {
    const historical = catTxns.filter((t) => monthKey(t.date) !== currentMonthKey);
    if (historical.length < 3) continue;

    const amounts = historical.map((t) => t.amount);
    const typical = median(amounts);
    const madValue = mad(amounts, typical);

    const currentTxns = catTxns.filter((t) => monthKey(t.date) === currentMonthKey);
    for (const t of currentTxns) {
      const score = robustZ(t.amount, typical, madValue);
      if (Number.isFinite(score) && score >= ANOMALY_THRESHOLD && t.amount > typical) {
        results.push({
          transactionId: t.id,
          categoryId,
          amount: t.amount,
          typicalAmount: typical,
          deviationScore: score,
        });
      }
    }
  }

  return results.sort((a, b) => b.deviationScore - a.deviationScore);
}

/** First-ever charge from a merchant, landing in the current month (by `asOf`). */
export function detectNewMerchants(
  txns: readonly Transaction[],
  asOf: string,
): NewMerchantFlag[] {
  const currentMonthKey = monthKey(asOf);
  const spendTxns = txns.filter(isSpendTxn).filter((t) => t.merchant !== undefined || t.rawDescription);

  const firstSeenByMerchant = new Map<string, Transaction>();
  for (const t of spendTxns) {
    const key = normalizeMerchant(t);
    const existing = firstSeenByMerchant.get(key);
    if (!existing || Date.parse(t.date) < Date.parse(existing.date)) {
      firstSeenByMerchant.set(key, t);
    }
  }

  const results: NewMerchantFlag[] = [];
  for (const [merchant, first] of firstSeenByMerchant) {
    if (monthKey(first.date) !== currentMonthKey) continue;
    results.push({
      merchant,
      transactionId: first.id,
      date: first.date,
      amount: first.amount,
      categoryId: first.categoryId,
    });
  }

  return results.sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
}

/**
 * Month-to-date spend pace against each budget's limit, extrapolated to month end.
 * `willExceed` is true when the projected month-end spend exceeds the limit.
 */
export function spendingVelocity(
  txns: readonly Transaction[],
  budgets: readonly Budget[],
  asOf: string,
): VelocityStatus[] {
  const currentMonthKey = monthKey(asOf);
  const asOfDate = new Date(asOf);
  const daysElapsed = asOfDate.getUTCDate();
  const daysInMonth = new Date(
    Date.UTC(asOfDate.getUTCFullYear(), asOfDate.getUTCMonth() + 1, 0),
  ).getUTCDate();

  const spendByCat = spendByCategory(
    txns.filter((t) => monthKey(t.date) === currentMonthKey),
    [],
  );

  return budgets.map((b) => {
    const spentSoFar = spendByCat[b.categoryId] ?? ZERO;
    const projectedMonthEnd = scale(spentSoFar, daysElapsed === 0 ? 0 : daysInMonth / daysElapsed);
    const paceRatioValue = ratio(projectedMonthEnd, b.limit);
    const paceRatio = paceRatioValue === null ? 0 : paceRatioValue;
    const willExceed = b.limit !== 0 && (projectedMonthEnd as number) > (b.limit as number);

    return {
      categoryId: b.categoryId,
      spentSoFar,
      limit: b.limit,
      projectedMonthEnd,
      paceRatio,
      willExceed,
    };
  });
}
