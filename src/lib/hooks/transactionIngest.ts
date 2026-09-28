/**
 * Shared, non-React helpers that turn ParsedTransaction[] (from any ingest channel)
 * into persisted Transaction rows: classify, dedupe against what's already in Dexie,
 * and route low-confidence parses to a review queue instead of the ledger.
 *
 * Not a React hook itself, but lives alongside the hooks because both the manual-entry
 * form (/transactions) and the CSV/SMS import controls (/connectors) need identical
 * behaviour and neither owns the other.
 */

import { bulkUpsertTransactions, deleteTransaction, getDb, saveTransaction } from '@/lib/core/db';
import { classify } from '@/lib/core/categorize';
import { dedupeBatch, type DedupeCandidate } from '@/lib/core/ingest';
import { paise, type Paise } from '@/lib/core/domain/money';
import type { Category, ChannelId, ParsedTransaction, Transaction } from '@/lib/core/domain/types';

/** Below this, ARCHITECTURE.md §8 says: review queue, not the ledger. */
export const REVIEW_CONFIDENCE_THRESHOLD = 0.5;
/** Tag used to mark a transaction as awaiting confirmation. Transaction has no
 * dedicated confidence field, so this (plus `excluded: true`, which keeps it out of
 * analytics/advice until confirmed) is how the review queue is represented. */
export const NEEDS_REVIEW_TAG = 'needs-review';

function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

export interface CommitResult {
  committed: Transaction[];
  needsReview: Transaction[];
  duplicates: number;
}

/**
 * Classify, dedupe (against both the batch itself and existing transactions on the
 * account), and persist a batch of parsed transactions from any channel.
 */
export async function commitParsedTransactions(params: {
  parsed: ParsedTransaction[];
  accountId: string;
  channel: ChannelId;
  categories: Category[];
  overrides: Record<string, string>;
  ownAccountMasks?: string[];
}): Promise<CommitResult> {
  const db = getDb();
  const { parsed, accountId, channel, categories, overrides } = params;
  const now = new Date().toISOString();

  const candidates: DedupeCandidate[] = parsed.map((p) => ({ ...p, accountId, observedAt: now }));
  const existingForAccount = await db.transactions.where('accountId').equals(accountId).toArray();
  const existingCandidates: DedupeCandidate[] = existingForAccount.map((t) => ({
    amount: t.amount,
    direction: t.direction,
    date: t.date,
    merchant: t.merchant,
    rawDescription: t.rawDescription,
    method: t.method,
    reference: t.reference,
    balanceAfter: t.balanceAfter,
    confidence: 1,
    accountId: t.accountId,
    observedAt: t.observedAt,
  }));

  const { unique } = dedupeBatch([...existingCandidates, ...candidates]);
  const uniqueNewOnly = unique.filter((u) => !existingCandidates.includes(u));
  const duplicateCount = candidates.length - uniqueNewOnly.length;

  const committed: Transaction[] = [];
  const needsReview: Transaction[] = [];

  for (const p of uniqueNewOnly) {
    const classification = classify(
      {
        merchant: p.merchant,
        rawDescription: p.rawDescription,
        direction: p.direction,
        method: p.method,
        ownAccountMasks: params.ownAccountMasks,
      },
      overrides,
    );
    const categoryId = categories.some((c) => c.id === classification.categoryId)
      ? classification.categoryId
      : 'cat.uncategorized.general';

    const lowConfidence = p.confidence < REVIEW_CONFIDENCE_THRESHOLD;

    const txn: Transaction = {
      id: newId('txn'),
      accountId,
      amount: paise(Math.abs(p.amount)),
      direction: p.direction,
      currency: 'INR',
      date: p.date ?? now.slice(0, 10),
      observedAt: now,
      rawDescription: p.rawDescription,
      merchant: p.merchant,
      categoryId,
      categoryAuto: classification.auto,
      kind: classification.kind,
      method: p.method,
      reference: p.reference,
      balanceAfter: p.balanceAfter,
      channel,
      excluded: lowConfidence,
      tags: lowConfidence ? [NEEDS_REVIEW_TAG] : undefined,
      createdAt: now,
      updatedAt: now,
    };

    if (lowConfidence) needsReview.push(txn);
    else committed.push(txn);
  }

  await bulkUpsertTransactions([...committed, ...needsReview]);

  return { committed, needsReview, duplicates: duplicateCount };
}

/** Confirm a review-queue transaction: clears the flag so it counts in analytics/advice. */
export async function confirmReviewTransaction(txn: Transaction, categoryId?: string): Promise<void> {
  await saveTransaction({
    ...txn,
    categoryId: categoryId ?? txn.categoryId,
    categoryAuto: categoryId ? false : txn.categoryAuto,
    excluded: false,
    tags: (txn.tags ?? []).filter((t) => t !== NEEDS_REVIEW_TAG),
    updatedAt: new Date().toISOString(),
  });
}

/** Reject a review-queue transaction: it was noise (OTP-adjacent parse, duplicate, etc). */
export async function rejectReviewTransaction(id: string): Promise<void> {
  await deleteTransaction(id);
}

export type { Paise };
