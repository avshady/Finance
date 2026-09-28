/**
 * SnapshotMetrics / FinancialSnapshot builders.
 * Medians drive the "typical month" figures so a bonus or a one-off splurge doesn't
 * distort every downstream ratio; a partial current month is excluded from every
 * median window because it is structurally low, not actually low.
 */

import type {
  Account,
  Budget,
  Category,
  FinancialSnapshot,
  Goal,
  Loan,
  MonthKey,
  RecurringItem,
  SnapshotMetrics,
  Transaction,
  UserProfile,
} from '../domain/types';
import { median, type Paise, ratio, subtract, sum, ZERO } from '../domain/money';
import {
  essentialSpendByMonth,
  incomeByMonth,
  liquidAssets,
  monthKey,
  netWorth,
  spendByCategory,
  spendByMonth,
  totalAssets,
  totalLiabilities,
  trailingMonthKeys,
} from './aggregate';

export interface BuildMetricsInput {
  asOf: string;
  accounts: readonly Account[];
  transactions: readonly Transaction[];
  categories: readonly Category[];
  loans: readonly Loan[];
  /** How many complete (non-current) months to include in median windows. Default 12. */
  windowMonths?: number;
}

/** Median of a Record<MonthKey, Paise> restricted to (and zero-filled across) `months`. */
function medianOverMonths(perMonth: Record<MonthKey, Paise>, months: readonly MonthKey[]): Paise {
  return median(months.map((mk) => perMonth[mk] ?? ZERO));
}

/** The MonthKeys eligible for a median window: complete months, excluding the current one. */
function completeMonthWindow(asOf: string, windowMonths: number): MonthKey[] {
  const current = monthKey(asOf);
  const parts = current.split('-').map(Number);
  const y = parts[0] ?? 1970;
  const m = parts[1] ?? 1;
  const prevMonthDate = new Date(Date.UTC(y, m - 1 - 1, 1)); // last day of month before current
  const prevYY = prevMonthDate.getUTCFullYear();
  const prevMM = String(prevMonthDate.getUTCMonth() + 1).padStart(2, '0');
  const lastComplete: MonthKey = `${prevYY}-${prevMM}`;
  return trailingMonthKeys(lastComplete, windowMonths);
}

export function buildMetrics(input: BuildMetricsInput): SnapshotMetrics {
  const { asOf, accounts, transactions, categories, loans } = input;
  const windowMonths = input.windowMonths ?? 12;

  const completeMonths = completeMonthWindow(asOf, windowMonths);

  const incomeMap = incomeByMonth(transactions);
  const expenseMap = spendByMonth(transactions, categories);
  const essentialMap = essentialSpendByMonth(transactions, categories);

  const monthlyIncome = medianOverMonths(incomeMap, completeMonths);
  const monthlyExpenses = medianOverMonths(expenseMap, completeMonths);
  const monthlyEssentialExpenses = medianOverMonths(essentialMap, completeMonths);

  const assets = totalAssets(accounts);
  const liabilities = totalLiabilities(accounts);
  const liquid = liquidAssets(accounts);

  const savingsRate =
    monthlyIncome === 0 ? null : ratio(subtract(monthlyIncome, monthlyExpenses), monthlyIncome);

  const totalMonthlyEmi = sum(
    loans.filter((l) => !l.closed).map((l) => l.emiAmount),
  );
  const emiToIncomeRatio = monthlyIncome === 0 ? null : ratio(totalMonthlyEmi, monthlyIncome);

  const emergencyFundMonths =
    monthlyEssentialExpenses === 0 ? null : ratio(liquid, monthlyEssentialExpenses);

  const creditCardsWithLimit = accounts.filter(
    (a) => a.kind === 'credit_card' && !a.archived && a.creditLimit !== undefined,
  );
  const creditLimitTotal = sum(creditCardsWithLimit.map((a) => a.creditLimit as Paise));
  const creditBalanceTotal = sum(creditCardsWithLimit.map((a) => a.balance));
  const creditUtilisation =
    creditCardsWithLimit.length === 0 || creditLimitTotal === 0
      ? null
      : ratio(creditBalanceTotal, creditLimitTotal);

  return {
    netWorth: netWorth(accounts),
    totalAssets: assets,
    totalLiabilities: liabilities,
    liquidAssets: liquid,
    monthlyIncome,
    monthlyExpenses,
    monthlyEssentialExpenses,
    savingsRate,
    totalMonthlyEmi,
    emiToIncomeRatio,
    emergencyFundMonths,
    creditUtilisation,
    spendByCategory: spendByCategory(transactions, categories),
    spendByMonth: expenseMap,
    incomeByMonth: incomeMap,
  };
}

export interface BuildSnapshotInput {
  asOf: string;
  profile: UserProfile;
  accounts: readonly Account[];
  transactions: readonly Transaction[];
  loans: readonly Loan[];
  budgets: readonly Budget[];
  goals: readonly Goal[];
  recurring: readonly RecurringItem[];
  categories: readonly Category[];
  windowMonths?: number;
}

/** Assemble a complete FinancialSnapshot from the raw entity arrays + profile + asOf. */
export function buildSnapshot(input: BuildSnapshotInput): FinancialSnapshot {
  const metrics = buildMetrics({
    asOf: input.asOf,
    accounts: input.accounts,
    transactions: input.transactions,
    categories: input.categories,
    loans: input.loans,
    windowMonths: input.windowMonths,
  });

  return {
    asOf: input.asOf,
    profile: input.profile,
    accounts: [...input.accounts],
    transactions: [...input.transactions],
    loans: [...input.loans],
    budgets: [...input.budgets],
    goals: [...input.goals],
    recurring: [...input.recurring],
    categories: [...input.categories],
    metrics,
  };
}
