/**
 * Recurring/subscription detection: group by normalized merchant, cluster the gaps
 * between charges into a canonical interval, and flag dormant subscriptions.
 */

import type { RecurrenceInterval, RecurringItem, Transaction } from '../domain/types';
import { add, mean, type Paise, scale } from '../domain/money';

/** Canonical interval definitions: nominal day length + tolerance band, in days. */
const INTERVALS: Array<{ interval: RecurrenceInterval; days: number; min: number; max: number }> = [
  { interval: 'weekly', days: 7, min: 6, max: 9 },
  { interval: 'monthly', days: 30, min: 28, max: 34 },
  { interval: 'quarterly', days: 91, min: 80, max: 100 },
  { interval: 'half_yearly', days: 182, min: 165, max: 200 },
  { interval: 'yearly', days: 365, min: 340, max: 390 },
];

/** Amount tolerance for "the same" recurring charge: ~10% variance. */
const AMOUNT_TOLERANCE = 0.1;

/** Normalize a merchant string for grouping: uppercase, trim, collapse whitespace. */
function normalizeMerchant(merchant: string | undefined, rawDescription: string): string {
  const base = (merchant ?? rawDescription).toUpperCase().trim().replace(/\s+/g, ' ');
  return base;
}

function daysBetween(a: string, b: string): number {
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  return Math.abs(tb - ta) / 86_400_000;
}

function matchInterval(avgGapDays: number): { interval: RecurrenceInterval; days: number } | null {
  for (const def of INTERVALS) {
    if (avgGapDays >= def.min && avgGapDays <= def.max) {
      return { interval: def.interval, days: def.days };
    }
  }
  return null;
}

/** True when every amount in the cluster is within ~10% of the mean. */
function amountsConsistent(amounts: readonly Paise[]): boolean {
  if (amounts.length === 0) return true;
  const avg = mean(amounts);
  if (avg === 0) return amounts.every((a) => a === 0);
  return amounts.every((a) => Math.abs(a - avg) / Math.abs(avg) <= AMOUNT_TOLERANCE);
}

function addDays(isoDate: string, days: number): string {
  const t = Date.parse(isoDate);
  const d = new Date(t + days * 86_400_000);
  return d.toISOString().slice(0, 10);
}

/**
 * Detect recurring/subscription items from a transaction window.
 * Only outflow-shaped transactions (debit, non-transfer, non-excluded) are considered.
 */
export function detectRecurring(
  txns: readonly Transaction[],
  asOf: string,
): RecurringItem[] {
  const candidates = txns.filter(
    (t) => !t.excluded && t.direction === 'debit' && t.kind !== 'transfer',
  );

  const groups = new Map<string, Transaction[]>();
  for (const t of candidates) {
    const key = normalizeMerchant(t.merchant, t.rawDescription);
    const arr = groups.get(key);
    if (arr) arr.push(t);
    else groups.set(key, [t]);
  }

  const results: RecurringItem[] = [];

  for (const [merchantKey, group] of groups) {
    if (group.length < 2) continue;
    const sorted = [...group].sort((a, b) => Date.parse(a.date) - Date.parse(b.date));

    const gaps: number[] = [];
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const cur = sorted[i];
      if (!prev || !cur) continue;
      gaps.push(daysBetween(prev.date, cur.date));
    }
    if (gaps.length === 0) continue;

    const avgGap = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    const matched = matchInterval(avgGap);
    if (!matched) continue;

    // Check every consecutive gap falls in-band (tolerant clustering, not just the average).
    const def = INTERVALS.find((d) => d.interval === matched.interval);
    if (!def) continue;
    const allGapsInBand = gaps.every((g) => g >= def.min - 3 && g <= def.max + 3);
    if (!allGapsInBand) continue;

    const amounts = sorted.map((t) => t.amount);
    if (!amountsConsistent(amounts)) continue;

    const occurrences = sorted.length;
    // >=3 occurrences: confidence starts above the 0.7 "asserted as fact" bar and climbs
    // with more history. 2 occurrences stays a low-confidence candidate at ~0.5.
    const confidence = occurrences >= 3 ? Math.min(0.95, 0.75 + (occurrences - 3) * 0.05) : 0.5;

    const last = sorted[sorted.length - 1];
    const first = sorted[0];
    if (!last || !first) continue;

    const nextExpected = addDays(last.date, matched.days);
    const daysSinceLast = daysBetween(last.date, asOf);
    const dormant = daysSinceLast > matched.days * 2;

    results.push({
      id: `recurring:${merchantKey}:${matched.interval}`,
      merchant: merchantKey,
      amount: mean(amounts),
      interval: matched.interval,
      categoryId: last.categoryId,
      accountId: last.accountId,
      firstSeen: first.date,
      lastSeen: last.date,
      nextExpected,
      confidence,
      detected: true,
      dormant,
    });
  }

  return results.sort((a, b) => a.merchant.localeCompare(b.merchant));
}

/** Multiplier to convert one occurrence's amount into an annual cost, per interval. */
const ANNUAL_MULTIPLIER: Record<RecurrenceInterval, number> = {
  weekly: 52,
  monthly: 12,
  quarterly: 4,
  half_yearly: 2,
  yearly: 1,
};

/** Annualised cost of a single recurring item. */
export function annualisedCost(item: RecurringItem): Paise {
  return scale(item.amount, ANNUAL_MULTIPLIER[item.interval]);
}

/** Multiplier to convert one occurrence's amount into a monthly cost, per interval. */
const MONTHLY_MULTIPLIER: Record<RecurrenceInterval, number> = {
  weekly: 52 / 12,
  monthly: 1,
  quarterly: 1 / 3,
  half_yearly: 1 / 6,
  yearly: 1 / 12,
};

/** Sum of every (non-cancelled) recurring item's cost, normalised to a monthly figure. */
export function totalRecurringMonthly(items: readonly RecurringItem[]): Paise {
  return add(
    ...items
      .filter((i) => !i.cancelled)
      .map((i) => scale(i.amount, MONTHLY_MULTIPLIER[i.interval])),
  );
}
