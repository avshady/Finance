/**
 * Dexie schema — the only persistence layer in the app (see docs/ARCHITECTURE.md §3:
 * IndexedDB is the source of truth, not a server database).
 *
 * Imports from ../domain use relative paths, never the `@` alias, because `core/`
 * must stay usable outside the Next.js app (e.g. from a test runner or a future
 * companion app) without path-alias resolution.
 */

import Dexie, { type EntityTable } from 'dexie';
import type {
  Account,
  Budget,
  Category,
  Goal,
  Insight,
  Loan,
  RawEvent,
  RecurringItem,
  Transaction,
  UserProfile,
} from '../domain/types';
import type { IsoInstant } from '../domain/types';

/** The single row `profile` ever holds. */
export const PROFILE_SINGLETON_ID = 'singleton';

/** Stored profile: the domain `UserProfile` plus the fixed row id it lives at. */
export interface StoredProfile extends UserProfile {
  id: typeof PROFILE_SINGLETON_ID;
  updatedAt: IsoInstant;
}

/**
 * The learned merchant -> category map. User corrections land here and always win
 * over the rules engine (docs/ARCHITECTURE.md §7).
 */
export interface UserCategoryOverride {
  /** Normalized merchant string — primary key. */
  merchant: string;
  categoryId: string;
  updatedAt: IsoInstant;
}

export class WealthWiseDB extends Dexie {
  accounts!: EntityTable<Account, 'id'>;
  transactions!: EntityTable<Transaction, 'id'>;
  categories!: EntityTable<Category, 'id'>;
  loans!: EntityTable<Loan, 'id'>;
  budgets!: EntityTable<Budget, 'id'>;
  goals!: EntityTable<Goal, 'id'>;
  recurring!: EntityTable<RecurringItem, 'id'>;
  rawEvents!: EntityTable<RawEvent, 'id'>;
  insights!: EntityTable<Insight, 'id'>;
  profile!: EntityTable<StoredProfile, 'id'>;
  userCategoryOverrides!: EntityTable<UserCategoryOverride, 'merchant'>;

  constructor(name = 'WealthWiseDB') {
    super(name);

    this.version(1).stores({
      accounts: 'id, kind, archived, sourceChannel',
      // `reference` is the dedupe key (bank UTR/RRN); `[accountId+date]` serves the
      // account statement view; `date` and `categoryId`/`merchant` serve analytics.
      transactions: 'id, accountId, date, categoryId, merchant, reference, observedAt, [accountId+date]',
      categories: 'id, group, parentId, essential, builtin',
      loans: 'id, kind, closed',
      budgets: 'id, categoryId',
      goals: 'id, kind, priority',
      recurring: 'id, merchant, dormant, cancelled, detected',
      rawEvents: 'id, channel, receivedAt',
      insights: 'id, severity, rule, generatedAt',
      profile: 'id',
      userCategoryOverrides: 'merchant, categoryId',
    });
  }
}

let dbInstance: WealthWiseDB | undefined;

/** Lazily-created singleton so importing this module has no side effects at load time. */
export function getDb(): WealthWiseDB {
  if (!dbInstance) {
    dbInstance = new WealthWiseDB();
  }
  return dbInstance;
}
