/**
 * Trend analysis: least-squares slopes, lifestyle inflation, and top movers.
 */

import type { Transaction } from '../domain/types';
import { add, type Paise, ratio, subtract, ZERO } from '../domain/money';
import { incomeByMonth, monthKey, spendByCategory, spendByMonth, trailingMonthKeys } from './aggregate';

export interface CategoryTrendResult {
  categoryId: string;
  /** Least-squares slope, in Paise per month. */
  slopePaisePerMonth: number;
  direction: 'rising' | 'falling' | 'flat';
}

export interface LifestyleInflationResult {
  incomeGrowthPct: number;
  savingsRateDelta: number;
  inflating: boolean;
}

export interface TopMover {
  categoryId: string;
  currentMonth: Paise;
  previousMonth: Paise;
  change: Paise;
}

const MIN_WINDOW_MONTHS = 6;
/** Slope-to-level ratio below which a trend is called "flat" rather than rising/falling. */
const FLAT_THRESHOLD = 0.02;

/** Per-category, per-month spend for a single categoryId across `months` trailing months. */
function categorySeries(
  txns: readonly Transaction[],
  categoryId: string,
  months: readonly string[],
): Paise[] {
  const perMonth: Record<string, Paise> = {};
  for (const t of txns) {
    if (t.excluded || t.kind === 'transfer' || t.kind === 'investment' || t.kind === 'income') continue;
    if (t.categoryId !== categoryId) continue;
    const mk = monthKey(t.date);
    if (t.kind === 'refund') {
      perMonth[mk] = subtract(perMonth[mk] ?? ZERO, t.amount);
      continue;
    }
    if (t.direction !== 'debit') continue;
    perMonth[mk] = add(perMonth[mk] ?? ZERO, t.amount);
  }
  return months.map((mk) => perMonth[mk] ?? ZERO);
}

/** Ordinary least-squares slope of y against x = 0..n-1. Returns 0 for fewer than 2 points. */
function leastSquaresSlope(values: readonly number[]): number {
  const n = values.length;
  if (n < 2) return 0;
  const xs = Array.from({ length: n }, (_, i) => i);
  const xMean = (n - 1) / 2;
  const yMean = values.reduce((a, b) => a + b, 0) / n;

  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    const x = xs[i] ?? 0;
    const y = values[i] ?? 0;
    num += (x - xMean) * (y - yMean);
    den += (x - xMean) ** 2;
  }
  if (den === 0) return 0;
  return num / den;
}

/**
 * Least-squares spend trend for one category over the trailing `months` months
 * (anchored at `asOf`'s month). Slope is in Paise/month.
 */
export function categoryTrend(
  txns: readonly Transaction[],
  categoryId: string,
  months: number,
  asOf: string,
): CategoryTrendResult {
  const anchor = monthKey(asOf);
  const monthKeys = trailingMonthKeys(anchor, months);
  const series = categorySeries(txns, categoryId, monthKeys);
  const values = series.map((p) => p as number);

  const slope = leastSquaresSlope(values);
  const level = values.reduce((a, b) => a + Math.abs(b), 0) / Math.max(values.length, 1);

  let direction: 'rising' | 'falling' | 'flat' = 'flat';
  if (level > 0) {
    const relative = slope / level;
    if (relative > FLAT_THRESHOLD) direction = 'rising';
    else if (relative < -FLAT_THRESHOLD) direction = 'falling';
  } else if (slope !== 0) {
    direction = slope > 0 ? 'rising' : 'falling';
  }

  return { categoryId, slopePaisePerMonth: slope, direction };
}

/**
 * Compares income growth against savings-rate change across a trailing window ending
 * at `asOf`'s month (the current, possibly partial, month is excluded). Requires at
 * least MIN_WINDOW_MONTHS complete months on each side of the comparison; below that,
 * returns a null-ish non-inflating result rather than asserting a signal from noise.
 */
export function lifestyleInflation(txns: readonly Transaction[], asOf: string): LifestyleInflationResult {
  const currentMonthKey = monthKey(asOf);
  // Complete months only: everything strictly before the current month.
  const allMonths = [...new Set(txns.map((t) => monthKey(t.date)))]
    .filter((mk) => mk < currentMonthKey)
    .sort();

  if (allMonths.length < MIN_WINDOW_MONTHS * 2) {
    return { incomeGrowthPct: 0, savingsRateDelta: 0, inflating: false };
  }

  const windowSize = Math.min(MIN_WINDOW_MONTHS, Math.floor(allMonths.length / 2));
  const earlyMonths = allMonths.slice(0, windowSize);
  const lateMonths = allMonths.slice(-windowSize);

  const income = incomeByMonth(txns);
  const expense = spendByMonth(txns, []);

  const sumOver = (map: Record<string, Paise>, keys: readonly string[]): Paise =>
    keys.reduce<Paise>((acc, mk) => add(acc, map[mk] ?? ZERO), ZERO);

  const earlyIncome = sumOver(income, earlyMonths);
  const lateIncome = sumOver(income, lateMonths);
  const earlyExpense = sumOver(expense, earlyMonths);
  const lateExpense = sumOver(expense, lateMonths);

  const incomeGrowthRatio = earlyIncome === 0 ? 0 : ((lateIncome as number) - (earlyIncome as number)) / (earlyIncome as number);
  const incomeGrowthPct = incomeGrowthRatio * 100;

  const earlySavingsRate = earlyIncome === 0 ? null : (ratio(subtract(earlyIncome, earlyExpense), earlyIncome) as number);
  const lateSavingsRate = lateIncome === 0 ? null : (ratio(subtract(lateIncome, lateExpense), lateIncome) as number);

  const savingsRateDelta =
    earlySavingsRate === null || lateSavingsRate === null ? 0 : lateSavingsRate - earlySavingsRate;

  // Lifestyle inflation: meaningful income growth (>=10%) absorbed with a flat-or-falling
  // savings rate (delta <= +2 percentage points, i.e. essentially no improvement).
  const inflating = incomeGrowthPct >= 10 && savingsRateDelta <= 0.02;

  return { incomeGrowthPct, savingsRateDelta, inflating };
}

/**
 * Categories with the largest month-over-month absolute change, comparing the latest
 * complete month against the one before it (anchored at `asOf`).
 */
export function topMovers(txns: readonly Transaction[], asOf: string, n: number): TopMover[] {
  const currentMonthKey = monthKey(asOf);
  const completeMonths = [...new Set(txns.map((t) => monthKey(t.date)))]
    .filter((mk) => mk < currentMonthKey)
    .sort();

  if (completeMonths.length < 2) return [];

  const latest = completeMonths[completeMonths.length - 1] as string;
  const previous = completeMonths[completeMonths.length - 2] as string;

  const latestTxns = txns.filter((t) => monthKey(t.date) === latest);
  const previousTxns = txns.filter((t) => monthKey(t.date) === previous);

  const latestByCategory = spendByCategory(latestTxns, []);
  const previousByCategory = spendByCategory(previousTxns, []);

  const categoryIds = new Set([...Object.keys(latestByCategory), ...Object.keys(previousByCategory)]);

  const movers: TopMover[] = [...categoryIds].map((categoryId) => {
    const currentMonth = latestByCategory[categoryId] ?? ZERO;
    const previousMonth = previousByCategory[categoryId] ?? ZERO;
    return {
      categoryId,
      currentMonth,
      previousMonth,
      change: subtract(currentMonth, previousMonth),
    };
  });

  return movers
    .sort((a, b) => Math.abs(b.change as number) - Math.abs(a.change as number))
    .slice(0, n);
}
