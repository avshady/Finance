/**
 * Typed async CRUD + the specific queries the rest of the app needs, on top of the
 * Dexie schema in ./schema.ts. This is the only I/O boundary inside `core/`.
 */

import type {
  Account,
  Budget,
  Category,
  Goal,
  Insight,
  IsoDate,
  Loan,
  RawEvent,
  RecurringItem,
  Transaction,
  TxnDirection,
  UserProfile,
} from '../domain/types';
import { getDb, PROFILE_SINGLETON_ID, type StoredProfile, type UserCategoryOverride, type WealthWiseDB } from './schema';

/** Dedupe window: the same swipe can arrive by SMS and email within seconds. */
const DUPLICATE_WINDOW_MS = 90_000;

function db(): WealthWiseDB {
  return getDb();
}

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

export async function getAccount(id: string): Promise<Account | undefined> {
  return db().accounts.get(id);
}

export async function listAccounts(): Promise<Account[]> {
  return db().accounts.toArray();
}

export async function saveAccount(account: Account): Promise<string> {
  return db().accounts.put(account);
}

export async function deleteAccount(id: string): Promise<void> {
  return db().accounts.delete(id);
}

// ---------------------------------------------------------------------------
// Transactions
// ---------------------------------------------------------------------------

export async function getTransaction(id: string): Promise<Transaction | undefined> {
  return db().transactions.get(id);
}

export async function listTransactions(): Promise<Transaction[]> {
  return db().transactions.toArray();
}

export async function saveTransaction(txn: Transaction): Promise<string> {
  return db().transactions.put(txn);
}

export async function deleteTransaction(id: string): Promise<void> {
  return db().transactions.delete(id);
}

/** Insert-or-update many transactions in a single write transaction. */
export async function bulkUpsertTransactions(txns: Transaction[]): Promise<void> {
  if (txns.length === 0) return;
  await db().transactions.bulkPut(txns);
}

/** All transactions with `date` in `[fromIso, toIso]` inclusive, oldest first. */
export async function getTransactionsBetween(fromIso: IsoDate, toIso: IsoDate): Promise<Transaction[]> {
  return db()
    .transactions.where('date')
    .between(fromIso, toIso, true, true)
    .sortBy('date');
}

/** The strongest dedupe key: bank reference / UTR / RRN. */
export async function findByReference(ref: string): Promise<Transaction | undefined> {
  if (!ref) return undefined;
  return db().transactions.where('reference').equals(ref).first();
}

/**
 * Fallback dedupe when no bank reference is available: same account, amount and
 * direction, observed within a 90-second window of each other (docs/ARCHITECTURE.md
 * §8 — "the same swipe arrives by SMS AND email").
 */
export async function findPossibleDuplicate(params: {
  amount: number;
  direction: TxnDirection;
  date: IsoDate;
  accountId: string;
  observedAt?: string;
}): Promise<Transaction | undefined> {
  const { amount, direction, date, accountId } = params;
  const observedAtMs = params.observedAt ? Date.parse(params.observedAt) : Date.now();

  const candidates = await db()
    .transactions.where('[accountId+date]')
    .equals([accountId, date])
    .toArray();

  return candidates.find((candidate) => {
    if (candidate.amount !== amount || candidate.direction !== direction) return false;
    const candidateMs = Date.parse(candidate.observedAt);
    if (Number.isNaN(candidateMs)) return true; // can't compare — err toward flagging as duplicate
    return Math.abs(candidateMs - observedAtMs) <= DUPLICATE_WINDOW_MS;
  });
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

export async function getCategory(id: string): Promise<Category | undefined> {
  return db().categories.get(id);
}

export async function listCategories(): Promise<Category[]> {
  return db().categories.toArray();
}

export async function saveCategory(category: Category): Promise<string> {
  return db().categories.put(category);
}

export async function bulkUpsertCategories(categories: Category[]): Promise<void> {
  if (categories.length === 0) return;
  await db().categories.bulkPut(categories);
}

// ---------------------------------------------------------------------------
// Loans
// ---------------------------------------------------------------------------

export async function getLoan(id: string): Promise<Loan | undefined> {
  return db().loans.get(id);
}

export async function listLoans(): Promise<Loan[]> {
  return db().loans.toArray();
}

export async function saveLoan(loan: Loan): Promise<string> {
  return db().loans.put(loan);
}

export async function deleteLoan(id: string): Promise<void> {
  return db().loans.delete(id);
}

/** Loans still being repaid, for the debt planner and advisor engine. */
export async function getActiveLoans(): Promise<Loan[]> {
  return db().loans.filter((loan) => !loan.closed).toArray();
}

// ---------------------------------------------------------------------------
// Budgets
// ---------------------------------------------------------------------------

export async function listBudgets(): Promise<Budget[]> {
  return db().budgets.toArray();
}

export async function saveBudget(budget: Budget): Promise<string> {
  return db().budgets.put(budget);
}

export async function deleteBudget(id: string): Promise<void> {
  return db().budgets.delete(id);
}

// ---------------------------------------------------------------------------
// Goals
// ---------------------------------------------------------------------------

export async function listGoals(): Promise<Goal[]> {
  return db().goals.toArray();
}

export async function saveGoal(goal: Goal): Promise<string> {
  return db().goals.put(goal);
}

export async function deleteGoal(id: string): Promise<void> {
  return db().goals.delete(id);
}

// ---------------------------------------------------------------------------
// Recurring items
// ---------------------------------------------------------------------------

export async function listRecurring(): Promise<RecurringItem[]> {
  return db().recurring.toArray();
}

export async function saveRecurring(item: RecurringItem): Promise<string> {
  return db().recurring.put(item);
}

export async function deleteRecurring(id: string): Promise<void> {
  return db().recurring.delete(id);
}

// ---------------------------------------------------------------------------
// Raw ingest events
// ---------------------------------------------------------------------------

export async function saveRawEvent(event: RawEvent): Promise<string> {
  return db().rawEvents.put(event);
}

export async function listRawEvents(): Promise<RawEvent[]> {
  return db().rawEvents.toArray();
}

// ---------------------------------------------------------------------------
// Insights
// ---------------------------------------------------------------------------

export async function saveInsights(insights: Insight[]): Promise<void> {
  if (insights.length === 0) return;
  await db().insights.bulkPut(insights);
}

export async function listInsights(): Promise<Insight[]> {
  return db().insights.toArray();
}

export async function clearInsights(): Promise<void> {
  await db().insights.clear();
}

// ---------------------------------------------------------------------------
// Profile (singleton)
// ---------------------------------------------------------------------------

export async function getProfile(): Promise<UserProfile | undefined> {
  const stored = await db().profile.get(PROFILE_SINGLETON_ID);
  if (!stored) return undefined;
  const { id: _id, updatedAt: _updatedAt, ...profile } = stored;
  return profile;
}

export async function saveProfile(profile: UserProfile): Promise<void> {
  const stored: StoredProfile = {
    ...profile,
    id: PROFILE_SINGLETON_ID,
    updatedAt: new Date().toISOString(),
  };
  await db().profile.put(stored);
}

// ---------------------------------------------------------------------------
// Learned category overrides
// ---------------------------------------------------------------------------

export async function getCategoryOverride(merchant: string): Promise<UserCategoryOverride | undefined> {
  return db().userCategoryOverrides.get(merchant);
}

export async function listCategoryOverrides(): Promise<UserCategoryOverride[]> {
  return db().userCategoryOverrides.toArray();
}

export async function saveCategoryOverride(merchant: string, categoryId: string): Promise<void> {
  await db().userCategoryOverrides.put({
    merchant,
    categoryId,
    updatedAt: new Date().toISOString(),
  });
}
