import { describe, expect, it } from 'vitest';
import { generateDemoData } from './generateDemoData';
import { BUILTIN_CATEGORIES } from '../core/db/seed';
import { buildSnapshot } from '../core/analytics';
import { ALL_RULES, generateAdvice, resetInsightIds } from '../core/advisor';

const KNOWN_CATEGORY_IDS = new Set(BUILTIN_CATEGORIES.map((c) => c.id));

describe('generateDemoData', () => {
  it('uses only categoryIds that exist in BUILTIN_CATEGORIES', () => {
    const { transactions, budgets, recurring } = generateDemoData({ seed: 1 });
    expect(transactions.length).toBeGreaterThan(0);

    for (const t of transactions) {
      expect(KNOWN_CATEGORY_IDS.has(t.categoryId)).toBe(true);
    }
    for (const b of budgets) {
      expect(KNOWN_CATEGORY_IDS.has(b.categoryId)).toBe(true);
    }
    for (const r of recurring) {
      expect(KNOWN_CATEGORY_IDS.has(r.categoryId)).toBe(true);
    }
  });

  it('emits only positive, safe-integer paise amounts', () => {
    const { transactions, loans, recurring, budgets, goals } = generateDemoData({ seed: 2 });

    for (const t of transactions) {
      expect(Number.isSafeInteger(t.amount)).toBe(true);
      expect(t.amount).toBeGreaterThan(0);
      if (t.balanceAfter !== undefined) {
        expect(Number.isSafeInteger(t.balanceAfter)).toBe(true);
      }
    }
    for (const l of loans) {
      expect(Number.isSafeInteger(l.principal)).toBe(true);
      expect(l.principal).toBeGreaterThan(0);
      expect(Number.isSafeInteger(l.outstanding)).toBe(true);
      expect(l.outstanding).toBeGreaterThanOrEqual(0);
      expect(Number.isSafeInteger(l.emiAmount)).toBe(true);
      expect(l.emiAmount).toBeGreaterThan(0);
    }
    for (const r of recurring) {
      expect(Number.isSafeInteger(r.amount)).toBe(true);
      expect(r.amount).toBeGreaterThan(0);
    }
    for (const b of budgets) {
      expect(Number.isSafeInteger(b.limit)).toBe(true);
      expect(b.limit).toBeGreaterThan(0);
    }
    for (const g of goals) {
      expect(Number.isSafeInteger(g.targetAmount)).toBe(true);
      expect(g.targetAmount).toBeGreaterThan(0);
    }
  });

  it('spans exactly 14 distinct calendar months, ending on the current month', () => {
    const asOf = new Date('2026-09-28T12:00:00.000Z');
    const { transactions } = generateDemoData({ seed: 3, asOf });

    const monthKeys = new Set(transactions.map((t) => t.date.slice(0, 7)));
    expect(monthKeys.size).toBe(14);
  });

  it('the 14 months are contiguous and the latest is the asOf month', () => {
    const asOf = new Date('2026-09-28T12:00:00.000Z');
    const { transactions } = generateDemoData({ seed: 4, asOf });
    const monthKeys = [...new Set(transactions.map((t) => t.date.slice(0, 7)))].sort();
    expect(monthKeys).toHaveLength(14);
    expect(monthKeys[monthKeys.length - 1]).toBe('2026-09');
    expect(monthKeys[0]).toBe('2025-08');
  });

  it('produces a non-empty, end-to-end advice feed including the dormant-subscription and fees findings', () => {
    resetInsightIds();
    const asOf = new Date('2026-09-28T12:00:00.000Z');
    const bundle = generateDemoData({ seed: 5, asOf });

    const snapshot = buildSnapshot({
      asOf: bundle.asOf,
      profile: bundle.profile,
      accounts: bundle.accounts,
      transactions: bundle.transactions,
      loans: bundle.loans,
      budgets: bundle.budgets,
      goals: bundle.goals,
      recurring: bundle.recurring,
      categories: bundle.categories,
    });

    const advice = generateAdvice(snapshot, ALL_RULES);

    expect(advice.errors).toEqual([]);
    expect(advice.insights.length).toBeGreaterThan(0);

    const ruleIds = advice.insights.map((i) => i.rule);
    expect(ruleIds).toContain('dormant-subscriptions');
    expect(ruleIds).toContain('fees-penalties');

    const dormantInsight = advice.insights.find((i) => i.rule === 'dormant-subscriptions');
    expect(dormantInsight?.headline.toLowerCase()).toContain('subscription');
    expect(dormantInsight?.evidence.some((e) => e.label.includes('SPOTIFY'))).toBe(true);

    const feesInsight = advice.insights.find((i) => i.rule === 'fees-penalties');
    expect(feesInsight?.impact.amountPaise).toBeGreaterThan(0);
  });
});
