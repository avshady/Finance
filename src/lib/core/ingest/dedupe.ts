/**
 * Cross-channel dedupe. The same swipe routinely arrives twice — once via SMS,
 * once via email, sometimes a third time via AA — and an ingest pipeline that
 * doesn't collapse those double-counts every downstream ratio (architecture §8).
 */

import type { IsoInstant, ParsedTransaction } from '../domain/types';

/**
 * A parsed transaction once it has been assigned to an account and stamped with
 * when it was observed — the shape dedupe operates on, just before persistence.
 */
export interface DedupeCandidate extends ParsedTransaction {
  accountId: string;
  observedAt: IsoInstant;
}

const DEDUPE_WINDOW_MS = 90_000;

/** A stable identity string for a transaction, used for quick lookups/logging. */
export function fingerprint(txn: DedupeCandidate): string {
  if (txn.reference) {
    return `ref:${txn.accountId}:${txn.reference}`;
  }
  return `heur:${txn.accountId}:${txn.direction}:${txn.amount}:${Math.floor(
    new Date(txn.observedAt).getTime() / DEDUPE_WINDOW_MS,
  )}`;
}

function sameAmount(a: DedupeCandidate, b: DedupeCandidate): boolean {
  return Math.abs(a.amount) === Math.abs(b.amount);
}

function withinWindow(a: DedupeCandidate, b: DedupeCandidate): boolean {
  const ta = new Date(a.observedAt).getTime();
  const tb = new Date(b.observedAt).getTime();
  if (!Number.isFinite(ta) || !Number.isFinite(tb)) return false;
  return Math.abs(ta - tb) <= DEDUPE_WINDOW_MS;
}

/**
 * Is `candidate` a duplicate of anything already in `existing`?
 * Exact reference match (when both sides have one) is decisive. Otherwise: same
 * absolute amount, same direction, same account, observed within 90 seconds.
 */
export function isDuplicate(candidate: DedupeCandidate, existing: DedupeCandidate[]): boolean {
  return existing.some((other) => matchesDuplicate(candidate, other));
}

function matchesDuplicate(a: DedupeCandidate, b: DedupeCandidate): boolean {
  if (a.accountId !== b.accountId) return false;

  if (a.reference && b.reference) {
    return a.reference === b.reference;
  }

  return a.direction === b.direction && sameAmount(a, b) && withinWindow(a, b);
}

/** Prefer the higher-confidence record when collapsing a duplicate pair. */
function preferred(a: DedupeCandidate, b: DedupeCandidate): DedupeCandidate {
  return b.confidence > a.confidence ? b : a;
}

export interface DedupeBatchResult {
  unique: DedupeCandidate[];
  duplicates: DedupeCandidate[];
}

/**
 * Collapse a batch of freshly-parsed candidates against each other. Duplicates
 * detected within the batch are merged in favour of the higher-confidence record;
 * the loser is reported in `duplicates`.
 */
export function dedupeBatch(parsed: DedupeCandidate[]): DedupeBatchResult {
  const kept: DedupeCandidate[] = [];
  const duplicates: DedupeCandidate[] = [];

  for (const candidate of parsed) {
    const matchIndex = kept.findIndex((k) => matchesDuplicate(candidate, k));
    if (matchIndex === -1) {
      kept.push(candidate);
      continue;
    }
    const existing = kept[matchIndex]!;
    const winner = preferred(existing, candidate);
    const loser = winner === existing ? candidate : existing;
    kept[matchIndex] = winner;
    duplicates.push(loser);
  }

  return { unique: kept, duplicates };
}
