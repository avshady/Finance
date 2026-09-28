/**
 * Aggregation primitives shared across the analytics module.
 * Pure functions of Transaction[]/Account[] — no I/O, no float arithmetic on amounts.
 */

import type { Account, Category, MonthKey, Transaction } from '../domain/types';
import { LIABILITY_KINDS } from '../domain/types';
import { add, median, type Paise, subtract, sum, ZERO } from '../domain/money';

/** Extract the "YYYY-MM" month key from an ISO date. */
export function monthKey(isoDate: string): MonthKey {
  return isoDate.slice(0, 7);
}

/** True when a category id is flagged essential (missing category is never essential). */
function isEssential(categoryId: string, categories: readonly Category[]): boolean {
  const cat = categories.find((c) => c.id === categoryId);
  return cat?.essential === true;
}

/**
 * Txns that count toward income/expense at all: not excluded, not a transfer leg.
 * Transfers between the user's own accounts are neither income nor expense.
 */
function isCountable(txn: Transaction): boolean {
  return !txn.excluded && txn.kind !== 'transfer';
}

/**
 * Per-month total outflow, keyed by MonthKey.
 * - `investment` outflows are excluded (reported separately as investmentOutflow).
 * - `refund` credits net against their category rather than existing elsewhere.
 * - `income` txns never contribute to spend.
 */
export function spendByMonth(
  txns: readonly Transaction[],
  categories: readonly Category[],
): Record<MonthKey, Paise> {
  const out: Record<MonthKey, Paise> = {};
  for (const t of txns) {
    if (!isCountable(t)) continue;
    if (t.kind === 'investment') continue;
    const mk = monthKey(t.date);
    if (t.kind === 'refund') {
      // Net a refund against the month's spend (reduces outflow).
      out[mk] = subtract(out[mk] ?? ZERO, t.amount);
      continue;
    }
    if (t.direction !== 'debit') continue;
    if (t.kind === 'income') continue;
    out[mk] = add(out[mk] ?? ZERO, t.amount);
  }
  return out;
}

/** Per-month total income, keyed by MonthKey. Refunds are netted against expense, not income. */
export function incomeByMonth(txns: readonly Transaction[]): Record<MonthKey, Paise> {
  const out: Record<MonthKey, Paise> = {};
  for (const t of txns) {
    if (!isCountable(t)) continue;
    if (t.kind !== 'income') continue;
    if (t.direction !== 'credit') continue;
    const mk = monthKey(t.date);
    out[mk] = add(out[mk] ?? ZERO, t.amount);
  }
  return out;
}

/**
 * Total investment outflow per month — an outflow that becomes an asset, not consumption.
 * Reported separately so it never inflates `spendByMonth`/expenses.
 */
export function investmentOutflowByMonth(txns: readonly Transaction[]): Record<MonthKey, Paise> {
  const out: Record<MonthKey, Paise> = {};
  for (const t of txns) {
    if (!isCountable(t)) continue;
    if (t.kind !== 'investment') continue;
    if (t.direction !== 'debit') continue;
    const mk = monthKey(t.date);
    out[mk] = add(out[mk] ?? ZERO, t.amount);
  }
  return out;
}

/**
 * Per-category total spend across the whole window, keyed by categoryId.
 * Same exclusion rules as spendByMonth: refunds net against their category, transfers/
 * investments/excluded/income txns never contribute.
 */
export function spendByCategory(
  txns: readonly Transaction[],
  _categories: readonly Category[],
): Record<string, Paise> {
  const out: Record<string, Paise> = {};
  for (const t of txns) {
    if (!isCountable(t)) continue;
    if (t.kind === 'investment') continue;
    if (t.kind === 'income') continue;
    if (t.kind === 'refund') {
      out[t.categoryId] = subtract(out[t.categoryId] ?? ZERO, t.amount);
      continue;
    }
    if (t.direction !== 'debit') continue;
    out[t.categoryId] = add(out[t.categoryId] ?? ZERO, t.amount);
  }
  return out;
}

/** Net worth: total assets minus total liabilities. */
export function netWorth(accounts: readonly Account[]): Paise {
  return subtract(totalAssets(accounts), totalLiabilities(accounts));
}

/** Sum of non-archived asset account balances (liability-kind accounts excluded). */
export function totalAssets(accounts: readonly Account[]): Paise {
  return sum(
    accounts
      .filter((a) => !a.archived && !LIABILITY_KINDS.includes(a.kind))
      .map((a) => a.balance),
  );
}

/** Sum of liability balances (stored positive in Account.balance). */
export function totalLiabilities(accounts: readonly Account[]): Paise {
  return sum(
    accounts
      .filter((a) => !a.archived && LIABILITY_KINDS.includes(a.kind))
      .map((a) => a.balance),
  );
}

/** Cash reachable within a day: savings + current + wallet + cash accounts. */
export function liquidAssets(accounts: readonly Account[]): Paise {
  const liquidKinds = new Set(['savings', 'current', 'wallet', 'cash']);
  return sum(
    accounts
      .filter((a) => !a.archived && liquidKinds.has(a.kind))
      .map((a) => a.balance),
  );
}

/**
 * Median monthly spend across categories flagged `essential === true`.
 * For each essential category, build its month-by-month spend series (zero-filled
 * across the full observed window) and take the median of the monthly totals summed
 * across essential categories per month, then the median across months.
 */
export function essentialMonthlyOutflow(
  txns: readonly Transaction[],
  categories: readonly Category[],
): Paise {
  const months = new Set<MonthKey>();
  for (const t of txns) months.add(monthKey(t.date));
  const perMonth = essentialSpendByMonth(txns, categories);
  const values = [...months].map((mk) => perMonth[mk] ?? ZERO);
  return median(values);
}

/**
 * Per-month spend restricted to categories flagged `essential === true`, zero-filled
 * across every MonthKey present in `txns`. Exported for reuse by metrics.ts, which
 * needs to restrict the median window to "complete" months.
 */
export function essentialSpendByMonth(
  txns: readonly Transaction[],
  categories: readonly Category[],
): Record<MonthKey, Paise> {
  const essentialIds = new Set(categories.filter((c) => c.essential).map((c) => c.id));
  const out: Record<MonthKey, Paise> = {};
  if (essentialIds.size === 0) return out;

  for (const t of txns) {
    if (!isCountable(t)) continue;
    if (!essentialIds.has(t.categoryId)) continue;
    if (t.kind === 'investment' || t.kind === 'income') continue;
    const mk = monthKey(t.date);
    if (t.kind === 'refund') {
      out[mk] = subtract(out[mk] ?? ZERO, t.amount);
      continue;
    }
    if (t.direction !== 'debit') continue;
    out[mk] = add(out[mk] ?? ZERO, t.amount);
  }
  return out;
}

/**
 * Cashflow series for the trailing `months` months, oldest first, zero-filled for
 * months with no activity. `asOf` (IsoInstant/IsoDate) anchors the trailing window;
 * defaults to the latest month present in `txns` when omitted.
 */
export function cashflowSeries(
  txns: readonly Transaction[],
  months: number,
  asOf?: string,
): Array<{ month: MonthKey; income: Paise; expense: Paise; net: Paise }> {
  const anchor = asOf ? monthKey(asOf) : latestMonth(txns);
  if (!anchor) return [];

  const keys = trailingMonthKeys(anchor, months);
  const inc = incomeByMonth(txns);
  const exp = spendByMonth(txns, []);

  return keys.map((mk) => {
    const income = inc[mk] ?? ZERO;
    const expense = exp[mk] ?? ZERO;
    return { month: mk, income, expense, net: subtract(income, expense) };
  });
}

/** Latest MonthKey present among the given transactions, or null if empty. */
function latestMonth(txns: readonly Transaction[]): MonthKey | null {
  let latest: MonthKey | null = null;
  for (const t of txns) {
    const mk = monthKey(t.date);
    if (latest === null || mk > latest) latest = mk;
  }
  return latest;
}

/** Build `count` consecutive MonthKeys ending at (and including) `endMonth`, oldest first. */
export function trailingMonthKeys(endMonth: MonthKey, count: number): MonthKey[] {
  const parts = endMonth.split('-').map(Number);
  const y = parts[0] ?? 1970;
  const m = parts[1] ?? 1;
  const out: MonthKey[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    const yy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    out.push(`${yy}-${mm}`);
  }
  return out;
}
