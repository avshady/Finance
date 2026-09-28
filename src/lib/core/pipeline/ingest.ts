/**
 * The real-time ingest pipeline (docs/ARCHITECTURE.md §8).
 *
 * ```
 * SMS / push / webhook / share-target
 *         |
 *         v
 *   POST /api/ingest  -or-  Web Share Target  -or-  companion app
 *         |
 *         v  Zod validation
 *    ChannelAdapter.parse() -> RawEvent
 *         v
 *    Dedupe (channel + ref + amount + 90s window)
 *         v
 *    Categorize -> persist -> recompute snapshot -> re-run advisor
 * ```
 *
 * This module implements everything up to and including "persist" for a single
 * `RawEvent`. It is pure TypeScript over the repository functions in `../db` — no
 * React, no Next.js, no fetch — so it is testable with nothing more than a Dexie
 * (or fake-IndexedDB) instance and runs identically from an API route, the Web
 * Share Target page, or a companion app.
 *
 * Dedupe is mandatory, never optional (see `../ingest/dedupe.ts` and
 * ARCHITECTURE.md §8): the same swipe routinely arrives by SMS and by email, and a
 * double-counted salary credit wrecks every ratio the advisor engine computes.
 */

import { z } from 'zod';
import { ZERO, type Paise } from '../domain/money';
import type {
  Account,
  AccountKind,
  ChannelId,
  ParsedTransaction,
  RawEvent,
  Transaction,
} from '../domain/types';
import { classify, type ClassifyResult } from '../categorize/classify';
import { parseEvent } from '../ingest/registry';
import {
  findByReference,
  findPossibleDuplicate,
  listAccounts,
  listCategoryOverrides,
  listRawEvents,
  saveAccount,
  saveRawEvent,
  saveTransaction,
} from '../db/repositories';

// ---------------------------------------------------------------------------
// Confidence routing
// ---------------------------------------------------------------------------

/**
 * A parsed transaction below this parser confidence never lands silently in the
 * ledger. It is still persisted (never dropped — the user typed/received real
 * money-moving data) but flagged `excluded: true` with a note, so it is invisible
 * to analytics/advice until a human confirms it. This mirrors the contract
 * documented on `ParsedTransaction.confidence` in `../domain/types.ts`.
 */
export const REVIEW_CONFIDENCE_THRESHOLD = 0.5;

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const CHANNEL_IDS = [
  'manual',
  'csv',
  'sms',
  'email',
  'account_aggregator',
  'plaid',
  'webhook',
  'share_target',
] as const satisfies readonly ChannelId[];

export const RawEventSchema = z.object({
  id: z.string().trim().min(1, 'id is required'),
  channel: z.enum(CHANNEL_IDS),
  receivedAt: z
    .string()
    .refine((v) => !Number.isNaN(Date.parse(v)), 'receivedAt must be a parseable ISO instant'),
  payload: z.string().min(1, 'payload must not be empty'),
  sender: z.string().optional(),
  meta: z.record(z.unknown()).optional(),
});

// ---------------------------------------------------------------------------
// Outcome shape
// ---------------------------------------------------------------------------

export interface DuplicateReport {
  parsed: ParsedTransaction;
  /** Which check caught it: an exact bank reference match, or the 90s amount/direction window. */
  reason: 'reference' | 'window';
  /** The id of the pre-existing transaction this candidate duplicates, when known. */
  matchedTransactionId?: string;
}

export interface IngestError {
  message: string;
  parsed?: ParsedTransaction;
}

/** What the UI needs to report exactly what happened with one RawEvent. */
export interface IngestOutcome {
  rawEventId: string;
  /** Transactions written to the ledger at or above `REVIEW_CONFIDENCE_THRESHOLD`. */
  created: Transaction[];
  /** Parsed transactions recognised as duplicates of something already stored. */
  duplicates: DuplicateReport[];
  /**
   * Transactions persisted with `excluded: true` because the parser wasn't sure —
   * they exist in the ledger (so nothing is silently lost) but stay out of
   * analytics/advice until the user confirms or corrects them.
   */
  needsReview: Transaction[];
  /** Validation failures, parser exceptions, or per-transaction failures. */
  errors: IngestError[];
}

function emptyOutcome(rawEventId: string): IngestOutcome {
  return { rawEventId, created: [], duplicates: [], needsReview: [], errors: [] };
}

// ---------------------------------------------------------------------------
// Ids (no external uuid dependency; core stays dependency-free)
// ---------------------------------------------------------------------------

function genId(prefix: string): string {
  const c: { randomUUID?: () => string } | undefined = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return `${prefix}_${c.randomUUID()}`;
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 11)}`;
}

// ---------------------------------------------------------------------------
// Account resolution
// ---------------------------------------------------------------------------

function guessAccountKind(method: ParsedTransaction['method']): AccountKind {
  if (method === 'card_credit') return 'credit_card';
  if (method === 'wallet') return 'wallet';
  return 'savings';
}

/**
 * Match on institution + last-4 account mask, per ARCHITECTURE requirements — never
 * store more than a 4-digit mask. Creates a new account when nothing matches; the
 * user can rename/reclassify it later, but the pipeline must never drop a
 * transaction for want of an account to attach it to.
 */
export async function resolveAccount(
  parsed: ParsedTransaction,
  channel: ChannelId,
  accounts: readonly Account[],
): Promise<Account> {
  const institution = parsed.institution?.trim();
  const mask = parsed.accountMask ? parsed.accountMask.slice(-4) : undefined;

  if (institution || mask) {
    const match = accounts.find((a) => {
      if (a.archived) return false;
      const institutionMatches = institution
        ? (a.institution ?? '').toUpperCase() === institution.toUpperCase()
        : true;
      const maskMatches = mask ? a.mask === mask : true;
      // Require at least one of the two signals we actually have to agree; if we
      // only have a mask, don't match an account whose mask we don't know.
      if (institution && a.institution === undefined) return false;
      if (mask && a.mask === undefined) return false;
      return institutionMatches && maskMatches;
    });
    if (match) return match;
  }

  const now = new Date().toISOString();
  const namePieces = [institution, mask ? `••${mask}` : undefined].filter(Boolean);
  const account: Account = {
    id: genId('acc'),
    name: namePieces.length > 0 ? namePieces.join(' ') : `Unknown account (${channel})`,
    kind: guessAccountKind(parsed.method),
    institution,
    mask,
    currency: 'INR',
    balance: parsed.balanceAfter ?? ZERO,
    sourceChannel: channel,
    createdAt: now,
    updatedAt: now,
  };
  await saveAccount(account);
  return account;
}

// ---------------------------------------------------------------------------
// Single-event ingest
// ---------------------------------------------------------------------------

function toIsoDate(instant: string): string {
  const d = new Date(instant);
  if (Number.isNaN(d.getTime())) return instant.slice(0, 10);
  const parts = d.toISOString().split('T');
  return parts[0] ?? instant.slice(0, 10);
}

async function classifyWithOverrides(
  parsed: ParsedTransaction,
  ownAccountMasks: string[],
): Promise<ClassifyResult> {
  const stored = await listCategoryOverrides();
  const overrides: Record<string, string> = {};
  for (const o of stored) overrides[o.merchant] = o.categoryId;
  return classify(
    {
      merchant: parsed.merchant,
      rawDescription: parsed.rawDescription,
      direction: parsed.direction,
      method: parsed.method,
      ownAccountMasks,
    },
    overrides,
  );
}

/**
 * Ingest one `RawEvent` end to end: validate, parse, resolve accounts, dedupe,
 * classify, route by confidence, persist — and persist the `RawEvent` itself so a
 * bad parse can be reprocessed later without the user re-entering anything.
 */
export async function ingestRawEvent(event: RawEvent): Promise<IngestOutcome> {
  const validation = RawEventSchema.safeParse(event);
  if (!validation.success) {
    const rawEventId = typeof event?.id === 'string' && event.id ? event.id : genId('invalid');
    return {
      ...emptyOutcome(rawEventId),
      errors: validation.error.issues.map((issue) => ({
        message: `${issue.path.join('.') || '(root)'}: ${issue.message}`,
      })),
    };
  }
  const validEvent = validation.data as RawEvent;
  const outcome = emptyOutcome(validEvent.id);

  // Persist the RawEvent unconditionally first: even a parse that produces
  // nothing, or later throws, must not cost the user having to re-supply it.
  try {
    await saveRawEvent(validEvent);
  } catch (err) {
    outcome.errors.push({ message: `Failed to persist raw event: ${(err as Error).message}` });
    return outcome;
  }

  let parsedTxns: ParsedTransaction[];
  try {
    parsedTxns = parseEvent(validEvent);
  } catch (err) {
    outcome.errors.push({ message: `Parser threw: ${(err as Error).message}` });
    return outcome;
  }

  if (parsedTxns.length === 0) return outcome;

  const accounts = await listAccounts();
  const ownAccountMasks = accounts.map((a) => a.mask).filter((m): m is string => Boolean(m));

  for (const parsed of parsedTxns) {
    try {
      const account = await resolveAccount(parsed, validEvent.channel, accounts);
      if (!accounts.some((a) => a.id === account.id)) accounts.push(account);

      const date = parsed.date ?? toIsoDate(validEvent.receivedAt);
      const observedAt = validEvent.receivedAt;

      // 1. Strongest signal: exact bank reference / UTR / RRN match.
      if (parsed.reference) {
        const existing = await findByReference(parsed.reference);
        if (existing) {
          outcome.duplicates.push({ parsed, reason: 'reference', matchedTransactionId: existing.id });
          continue;
        }
      }

      // 2. Fallback: same account, amount, direction, within the 90s window —
      // this is what catches the same swipe arriving by both SMS and email.
      const possibleDup = await findPossibleDuplicate({
        amount: parsed.amount,
        direction: parsed.direction,
        date,
        accountId: account.id,
        observedAt,
      });
      if (possibleDup) {
        outcome.duplicates.push({ parsed, reason: 'window', matchedTransactionId: possibleDup.id });
        continue;
      }

      const classified = await classifyWithOverrides(parsed, ownAccountMasks);
      const needsReview = parsed.confidence < REVIEW_CONFIDENCE_THRESHOLD;
      const now = new Date().toISOString();

      const txn: Transaction = {
        id: genId('txn'),
        accountId: account.id,
        amount: parsed.amount,
        direction: parsed.direction,
        currency: account.currency,
        date,
        observedAt,
        rawDescription: parsed.rawDescription,
        merchant: parsed.merchant,
        categoryId: classified.categoryId,
        categoryAuto: classified.auto,
        kind: classified.kind,
        method: parsed.method,
        reference: parsed.reference,
        balanceAfter: parsed.balanceAfter,
        channel: validEvent.channel,
        excluded: needsReview ? true : undefined,
        notes: needsReview
          ? `Needs review: parser confidence ${Math.round(parsed.confidence * 100)}% is below the ${Math.round(
              REVIEW_CONFIDENCE_THRESHOLD * 100,
            )}% threshold for automatic posting. Confirm the amount, direction and merchant before counting this.`
          : undefined,
        createdAt: now,
        updatedAt: now,
      };

      await saveTransaction(txn);
      if (needsReview) outcome.needsReview.push(txn);
      else outcome.created.push(txn);
    } catch (err) {
      outcome.errors.push({ message: (err as Error).message, parsed });
    }
  }

  return outcome;
}

// ---------------------------------------------------------------------------
// Batch ingest
// ---------------------------------------------------------------------------

export interface IngestBatchOutcome {
  results: IngestOutcome[];
  totals: { created: number; duplicates: number; needsReview: number; errors: number };
}

/** Ingest several RawEvents, sequentially (so later events see earlier ones for dedupe). */
export async function ingestBatch(events: RawEvent[]): Promise<IngestBatchOutcome> {
  const results: IngestOutcome[] = [];
  for (const event of events) {
    // eslint-disable-next-line no-await-in-loop -- dedupe correctness needs strict ordering
    results.push(await ingestRawEvent(event));
  }
  const totals = results.reduce(
    (acc, r) => ({
      created: acc.created + r.created.length,
      duplicates: acc.duplicates + r.duplicates.length,
      needsReview: acc.needsReview + r.needsReview.length,
      errors: acc.errors + r.errors.length,
    }),
    { created: 0, duplicates: 0, needsReview: 0, errors: 0 },
  );
  return { results, totals };
}

// ---------------------------------------------------------------------------
// Reprocessing
// ---------------------------------------------------------------------------

/**
 * Re-run the pipeline for a previously-stored RawEvent — e.g. after a parser fix —
 * without the user re-entering anything. Re-ingesting is safe: the dedupe step
 * will recognise the transaction it created the first time (by reference, or by
 * the 90s amount/direction window) and report it as a duplicate rather than
 * double-posting it.
 */
export async function reprocessRawEvent(id: string): Promise<IngestOutcome | undefined> {
  const events = await listRawEvents();
  const event = events.find((e) => e.id === id);
  if (!event) return undefined;
  return ingestRawEvent(event);
}
