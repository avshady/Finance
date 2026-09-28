/**
 * Learned user overrides: merchant -> categoryId, always wins in classify().
 * Pure functions over a plain `Record<string, string>` — the db layer owns
 * persisting that record (e.g. to a Dexie table); this module has no I/O.
 */

import { normalizeMerchant } from './normalizeMerchant';

export type LearnedOverrides = Record<string, string>;

/**
 * Record (or replace) the category the user chose for a merchant. Returns a
 * new map; does not mutate `store`.
 */
export function recordOverride(store: LearnedOverrides, merchant: string, categoryId: string): LearnedOverrides {
  const key = normalizeMerchant(merchant);
  if (!key) return store;
  return { ...store, [key]: categoryId };
}

/** Remove a learned override for a merchant, if any. Returns a new map. */
export function forgetOverride(store: LearnedOverrides, merchant: string): LearnedOverrides {
  const key = normalizeMerchant(merchant);
  if (!key || !(key in store)) return store;
  const next = { ...store };
  delete next[key];
  return next;
}

/** Look up the learned category for a merchant, if the user has ever overridden it. */
export function applyLearned(store: LearnedOverrides, merchant: string | undefined): string | undefined {
  const key = normalizeMerchant(merchant);
  return key ? store[key] : undefined;
}

/** Merge two override maps; entries in `incoming` win on conflict. */
export function mergeLearned(base: LearnedOverrides, incoming: LearnedOverrides): LearnedOverrides {
  return { ...base, ...incoming };
}
