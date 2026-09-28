/**
 * Category + TxnKind classification.
 *
 * Precedence: user override (always wins, confidence 1) -> exact merchant rule
 * -> keyword rule -> heuristic fallback -> `cat.uncategorized.general`.
 */

import type { PaymentMethod, TxnDirection, TxnKind } from '../domain/types';
import { normalizeMerchant } from './normalizeMerchant';
import { EXACT_MERCHANT_RULES, KEYWORD_RULES, UNCATEGORIZED, type KeywordRule } from './rules';

export interface ClassifyInput {
  /** Raw or already-normalized merchant name, when known. */
  merchant?: string;
  /** Raw bank/UPI narration — always present, used for keyword and self-transfer matching. */
  rawDescription: string;
  direction: TxnDirection;
  method?: PaymentMethod;
  /** The user's own account masks (last 4 digits), for self-transfer detection. */
  ownAccountMasks?: string[];
}

export interface ClassifyResult {
  categoryId: string;
  kind: TxnKind;
  confidence: number;
  /** False only when a user override decided the category. */
  auto: boolean;
}

const SELF_TRANSFER_RE = /\b(self|own\s*account|mine\s*a\/?c|to\s*self)\b/i;

/** Heuristic self-transfer detection: narration keywords, or a mask that is the user's own. */
export function detectSelfTransfer(rawDescription: string, ownAccountMasks: string[] = []): boolean {
  if (SELF_TRANSFER_RE.test(rawDescription)) return true;
  for (const mask of ownAccountMasks) {
    if (mask && new RegExp(`(?<!\\d)${mask}(?!\\d)`).test(rawDescription)) return true;
  }
  return false;
}

function inferKindFallback(input: ClassifyInput, categoryId: string): TxnKind {
  if (categoryId.startsWith('cat.debt.')) return 'emi_payment';
  if (categoryId.startsWith('cat.investment.')) return 'investment';
  if (categoryId.startsWith('cat.fees.')) return 'fee';
  if (categoryId.startsWith('cat.income.')) return 'income';
  if (categoryId.startsWith('cat.transfer.')) return 'transfer';
  if (input.direction === 'credit') return 'income';
  return 'expense';
}

function bestKeywordMatch(haystack: string): KeywordRule | undefined {
  let best: KeywordRule | undefined;
  for (const rule of KEYWORD_RULES) {
    if (rule.pattern.test(haystack) && (!best || rule.priority > best.priority)) {
      best = rule;
    }
  }
  return best;
}

/**
 * Classify a transaction-ish input into a category + kind.
 * `overrides` is the learned merchant -> categoryId map (see learn.ts); it is a
 * plain object so the caller (the db layer) owns persistence.
 */
export function classify(input: ClassifyInput, overrides: Record<string, string> = {}): ClassifyResult {
  const normalized = normalizeMerchant(input.merchant ?? input.rawDescription);
  const selfTransfer = detectSelfTransfer(input.rawDescription, input.ownAccountMasks);

  // 1. User override always wins.
  if (normalized && overrides[normalized]) {
    const categoryId = overrides[normalized];
    return {
      categoryId,
      kind: selfTransfer ? 'transfer' : inferKindFallback(input, categoryId),
      confidence: 1,
      auto: false,
    };
  }

  // 2. Exact merchant rule.
  const exact = normalized ? EXACT_MERCHANT_RULES[normalized] : undefined;
  if (exact) {
    return {
      categoryId: exact.categoryId,
      kind: selfTransfer ? 'transfer' : exact.kind ?? inferKindFallback(input, exact.categoryId),
      confidence: 0.9,
      auto: true,
    };
  }

  // 3. Keyword rule, highest priority match wins.
  const haystack = `${normalized} ${input.rawDescription}`;
  const keyword = bestKeywordMatch(haystack);
  if (keyword) {
    return {
      categoryId: keyword.categoryId,
      kind: selfTransfer ? 'transfer' : keyword.kind ?? inferKindFallback(input, keyword.categoryId),
      confidence: 0.7,
      auto: true,
    };
  }

  // 4. Heuristic fallback.
  if (selfTransfer) {
    return { categoryId: 'cat.transfer.internal', kind: 'transfer', confidence: 0.6, auto: true };
  }
  if (input.direction === 'credit') {
    return { categoryId: 'cat.income.other', kind: 'income', confidence: 0.4, auto: true };
  }

  // 5. Give up.
  return { categoryId: UNCATEGORIZED, kind: 'expense', confidence: 0.3, auto: true };
}
