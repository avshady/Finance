/**
 * Contract test binding the categorizer to the seeded category set.
 *
 * These two modules were written independently and drifted: the rules table emitted 33
 * category ids that did not exist in the seed. Nothing crashed — transactions were simply
 * filed under ids with no Category record, so the `essential` flag never resolved, which
 * silently corrupted `monthlyEssentialExpenses`, and with it the emergency-fund target and
 * every ratio derived from it. Exactly the class of failure that is invisible until
 * someone acts on a wrong number.
 *
 * This test makes that drift impossible to reintroduce.
 */

import { describe, expect, it } from 'vitest';

import { BUILTIN_CATEGORIES } from '../db/seed';
import { EXACT_MERCHANT_RULES, KEYWORD_RULES } from './rules';
import { classify } from './classify';

const SEEDED = new Set(BUILTIN_CATEGORIES.map((c) => c.id));

function referencedIds(): string[] {
  const ids = new Set<string>();
  for (const rule of Object.values(EXACT_MERCHANT_RULES)) ids.add(rule.categoryId);
  for (const rule of KEYWORD_RULES) ids.add(rule.categoryId);
  return [...ids];
}

describe('categorizer / seed contract', () => {
  it('seeds a unique id for every builtin category', () => {
    expect(SEEDED.size).toBe(BUILTIN_CATEGORIES.length);
  });

  it('every category id the rules table emits exists in the seed', () => {
    const referenced = referencedIds();
    // Guard against the assertion silently checking nothing: an earlier version of this
    // test read the wrong field off the rules table and passed vacuously.
    expect(referenced.length).toBeGreaterThan(30);
    expect(referenced.every((id) => typeof id === 'string' && id.startsWith('cat.'))).toBe(true);

    const missing = referenced.filter((id) => !SEEDED.has(id));
    expect(missing).toEqual([]);
  });

  it('routes an unrecognised merchant to a seeded fallback category', () => {
    const result = classify(
      { rawDescription: 'ZZQQ UNRECOGNISED VENDOR 99', direction: 'debit' },
      {},
    );
    expect(SEEDED.has(result.categoryId)).toBe(true);
  });

  it('files known merchants under seeded categories', () => {
    for (const description of [
      'UPI/P2M/412345678901/SWIGGY LIMITED BANGALORE',
      'NETFLIX.COM',
      'INDIANOIL PETROL PUMP',
      'ZERODHA BROKING SIP',
      'LATE PAYMENT FEE',
      'SALARY CREDIT SEP',
    ]) {
      const result = classify({ rawDescription: description, direction: 'debit' }, {});
      expect(SEEDED.has(result.categoryId), `${description} -> ${result.categoryId}`).toBe(true);
    }
  });
});
