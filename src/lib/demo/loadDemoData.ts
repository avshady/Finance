/**
 * Writes `generateDemoData()`'s bundle into the local Dexie DB (the only
 * persistence layer this app has — docs/ARCHITECTURE.md §3) and offers a full
 * wipe back to empty. Both are thin wrappers over `src/lib/core/db`; all the
 * actual data lives in `generateDemoData`.
 */

import { getDb } from '@/lib/core/db';
import {
  bulkUpsertCategories,
  bulkUpsertTransactions,
  saveAccount,
  saveBudget,
  saveGoal,
  saveLoan,
  saveProfile,
  saveRecurring,
} from '@/lib/core/db';
import { generateDemoData, type GenerateDemoDataOptions } from './generateDemoData';

/** Generate a fresh demo bundle and write every part of it into Dexie. */
export async function loadDemoData(options: GenerateDemoDataOptions = {}): Promise<void> {
  const bundle = generateDemoData(options);

  await bulkUpsertCategories(bundle.categories);
  await Promise.all(bundle.accounts.map((a) => saveAccount(a)));
  await bulkUpsertTransactions(bundle.transactions);
  await Promise.all(bundle.loans.map((l) => saveLoan(l)));
  await Promise.all(bundle.budgets.map((b) => saveBudget(b)));
  await Promise.all(bundle.goals.map((g) => saveGoal(g)));
  await Promise.all(bundle.recurring.map((r) => saveRecurring(r)));
  await saveProfile(bundle.profile);
}

/**
 * Wipe every table back to empty — the honest reset a demo needs before handing
 * the app to someone who is about to connect their own real data.
 */
export async function clearAllData(): Promise<void> {
  const db = getDb();
  await db.transaction(
    'rw',
    [
      db.accounts,
      db.transactions,
      db.categories,
      db.loans,
      db.budgets,
      db.goals,
      db.recurring,
      db.rawEvents,
      db.insights,
      db.profile,
      db.userCategoryOverrides,
    ],
    async () => {
      await Promise.all([
        db.accounts.clear(),
        db.transactions.clear(),
        db.categories.clear(),
        db.loans.clear(),
        db.budgets.clear(),
        db.goals.clear(),
        db.recurring.clear(),
        db.rawEvents.clear(),
        db.insights.clear(),
        db.profile.clear(),
        db.userCategoryOverrides.clear(),
      ]);
    },
  );
}
