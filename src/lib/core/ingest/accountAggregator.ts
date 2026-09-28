/**
 * RBI Account Aggregator (Setu / Finvu / Onemoney) adapter.
 *
 * ---------------------------------------------------------------------------
 * GOING LIVE REQUIRES:
 *   1. The user's own FIU (Financial Information User) registration with RBI.
 *   2. A commercial contract with a licensed AA (Setu, Finvu, Onemoney, ...).
 *   3. Per-consent user approval in the AA's consent flow before any data moves.
 * This module makes NO network call and fabricates NO bank data. It only
 * normalizes an AA-shaped FI Data payload that a configured integration would
 * hand it after decrypting the consent-scoped response. Until credentials are
 * configured (see descriptor.status), nothing here talks to a real bank.
 * ---------------------------------------------------------------------------
 */

import { fromRupees, negate } from '../domain/money';
import type { Paise } from '../domain/money';
import type { ChannelAdapter, ChannelDescriptor, ParsedTransaction, RawEvent } from '../domain/types';

const descriptor: ChannelDescriptor = {
  id: 'account_aggregator',
  label: 'Account Aggregator (Setu / Finvu / Onemoney)',
  status: 'needs-credentials',
  latency: 'minutes',
  requirement:
    'Requires the user\'s own FIU registration with RBI and a contract with a licensed Account Aggregator, plus a per-consent approval flow. No data is fetched until this is configured.',
};

// ---------------------------------------------------------------------------
// AA FI Data payload shape (deposit accounts + credit-card accounts), as the
// AA ReBIT/Sahamati spec returns it after decryption.
// ---------------------------------------------------------------------------

export type AaTxnType = 'CREDIT' | 'DEBIT';

export interface AaTransaction {
  txnId: string;
  amount: string; // decimal string, major units, e.g. "1234.56"
  narration: string;
  type: AaTxnType;
  mode?: string; // UPI, NEFT, IMPS, CARD, ATM, OTHERS, ...
  valueDate: string; // ISO date or datetime
  transactionTimestamp?: string;
  currentBalance?: string;
  reference?: string;
}

export interface AaAccountBlock {
  linkedAccRef: string;
  maskedAccNumber?: string;
  fiType?: 'DEPOSIT' | 'TERM_DEPOSIT' | 'RECURRING_DEPOSIT' | 'CREDIT_CARD';
  bank?: string;
  transactions: { transaction: AaTransaction[] };
}

export interface AaFiDataPayload {
  fiDataRange?: { from: string; to: string };
  accounts: AaAccountBlock[];
}

export function isAaPayload(value: unknown): value is AaFiDataPayload {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  if (!Array.isArray(v.accounts)) return false;
  return v.accounts.every((acc) => {
    if (!acc || typeof acc !== 'object') return false;
    const a = acc as Record<string, unknown>;
    return typeof a.linkedAccRef === 'string' && a.transactions !== undefined && typeof a.transactions === 'object';
  });
}

function toPaise(decimalRupees: string): Paise | null {
  const n = Number(decimalRupees);
  if (!Number.isFinite(n)) return null;
  return fromRupees(n);
}

function modeToMethod(mode: string | undefined): ParsedTransaction['method'] {
  const m = (mode ?? '').toUpperCase();
  if (m.includes('UPI')) return 'upi';
  if (m.includes('NEFT')) return 'neft';
  if (m.includes('RTGS')) return 'rtgs';
  if (m.includes('IMPS')) return 'imps';
  if (m.includes('CARD')) return 'card_debit';
  if (m.includes('ATM')) return 'cash';
  return 'unknown';
}

export function normalizeAaPayload(payload: AaFiDataPayload): ParsedTransaction[] {
  const out: ParsedTransaction[] = [];
  for (const account of payload.accounts) {
    for (const txn of account.transactions.transaction ?? []) {
      const amount = toPaise(txn.amount);
      if (amount === null) continue;
      const balance = txn.currentBalance ? toPaise(txn.currentBalance) : null;
      out.push({
        amount: amount < 0 ? negate(amount) : amount,
        direction: txn.type === 'CREDIT' ? 'credit' : 'debit',
        date: (txn.valueDate ?? txn.transactionTimestamp ?? '').slice(0, 10) || undefined,
        merchant: undefined,
        rawDescription: txn.narration ?? '',
        method: modeToMethod(txn.mode),
        reference: txn.reference || txn.txnId || undefined,
        balanceAfter: balance ?? undefined,
        institution: account.bank,
        accountMask: account.maskedAccNumber?.slice(-4),
        confidence: 0.95, // structured, source-of-truth data once genuinely fetched
      });
    }
  }
  return out;
}

export const accountAggregatorAdapter: ChannelAdapter = {
  descriptor,
  canParse(event: RawEvent): boolean {
    if (event.channel !== 'account_aggregator') return false;
    try {
      const parsed = JSON.parse(event.payload);
      return isAaPayload(parsed);
    } catch {
      return false;
    }
  },
  parse(event: RawEvent): ParsedTransaction[] {
    // No network call is ever made here. This only normalizes a payload the caller
    // already obtained through a configured, credentialed AA integration.
    let payload: unknown;
    try {
      payload = JSON.parse(event.payload);
    } catch {
      return [];
    }
    if (!isAaPayload(payload)) return [];
    return normalizeAaPayload(payload);
  },
};

export default accountAggregatorAdapter;
