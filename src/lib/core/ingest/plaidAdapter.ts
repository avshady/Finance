/**
 * Plaid adapter (non-India accounts).
 *
 * ---------------------------------------------------------------------------
 * GOING LIVE REQUIRES a paid Plaid `client_id` + `secret` and an Item created
 * through Plaid Link (the user authenticating with their bank via Plaid's UI).
 * This module makes NO network call and fabricates NO transaction data. It only
 * normalizes the shape Plaid's `/transactions/sync` endpoint returns, which a
 * configured integration would hand it after the real API call. Until
 * credentials are configured (see descriptor.status), nothing here talks to Plaid.
 * ---------------------------------------------------------------------------
 */

import { fromRupees, negate } from '../domain/money';
import type { Paise } from '../domain/money';
import type { ChannelAdapter, ChannelDescriptor, ParsedTransaction, RawEvent } from '../domain/types';

const descriptor: ChannelDescriptor = {
  id: 'plaid',
  label: 'Plaid (non-India banks)',
  status: 'needs-credentials',
  latency: 'minutes',
  requirement:
    'Requires a Plaid client_id/secret and the user linking their bank via Plaid Link. No data is fetched until this is configured.',
};

// ---------------------------------------------------------------------------
// Plaid /transactions/sync response shape (subset used here).
// Amounts in Plaid are POSITIVE for money leaving the account (a debit/expense)
// and NEGATIVE for money coming in (a credit) — the inverse of most bank feeds.
// ---------------------------------------------------------------------------

export interface PlaidTransaction {
  transaction_id: string;
  account_id: string;
  amount: number; // major units; positive = outflow, negative = inflow
  iso_currency_code?: string | null;
  date: string; // YYYY-MM-DD
  authorized_date?: string | null;
  name: string;
  merchant_name?: string | null;
  payment_channel?: 'online' | 'in store' | 'other';
  personal_finance_category?: { primary?: string; detailed?: string };
  pending?: boolean;
}

export interface PlaidSyncPayload {
  added: PlaidTransaction[];
  modified?: PlaidTransaction[];
  removed?: Array<{ transaction_id: string }>;
  next_cursor?: string;
  has_more?: boolean;
}

export function isPlaidPayload(value: unknown): value is PlaidSyncPayload {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return Array.isArray(v.added);
}

function channelToMethod(channel: PlaidTransaction['payment_channel']): ParsedTransaction['method'] {
  if (channel === 'online') return 'card_debit';
  if (channel === 'in store') return 'card_debit';
  return 'unknown';
}

function toPaiseAbs(amount: number): Paise {
  const p = fromRupees(Math.abs(amount));
  return p;
}

export function normalizePlaidTransactions(txns: PlaidTransaction[]): ParsedTransaction[] {
  return txns
    .filter((t) => !t.pending)
    .map((t) => {
      const amount = toPaiseAbs(t.amount);
      return {
        amount,
        direction: t.amount > 0 ? 'debit' : 'credit',
        date: t.date,
        merchant: t.merchant_name || t.name,
        rawDescription: t.name,
        method: channelToMethod(t.payment_channel),
        reference: t.transaction_id,
        balanceAfter: undefined,
        institution: undefined,
        accountMask: undefined,
        confidence: 0.95,
      } satisfies ParsedTransaction;
    });
}

export const plaidAdapter: ChannelAdapter = {
  descriptor,
  canParse(event: RawEvent): boolean {
    if (event.channel !== 'webhook' && event.channel !== 'plaid') return false;
    try {
      return isPlaidPayload(JSON.parse(event.payload));
    } catch {
      return false;
    }
  },
  parse(event: RawEvent): ParsedTransaction[] {
    let payload: unknown;
    try {
      payload = JSON.parse(event.payload);
    } catch {
      return [];
    }
    if (!isPlaidPayload(payload)) return [];
    return normalizePlaidTransactions(payload.added);
  },
};

export default plaidAdapter;
