/**
 * Manual entry adapter — a user typing/pasting a transaction. Always works,
 * needs no credentials. Validates the payload with Zod before trusting it.
 */

import { z } from 'zod';
import { paise } from '../domain/money';
import type { ChannelAdapter, ChannelDescriptor, ParsedTransaction, RawEvent } from '../domain/types';

const descriptor: ChannelDescriptor = {
  id: 'manual',
  label: 'Manual entry',
  status: 'live',
  latency: 'on-demand',
  requirement: 'None — the user enters the transaction directly.',
};

const PAYMENT_METHODS = [
  'upi',
  'card_debit',
  'card_credit',
  'netbanking',
  'imps',
  'neft',
  'rtgs',
  'ach_mandate',
  'cash',
  'wallet',
  'cheque',
  'unknown',
] as const;

export const ManualEntrySchema = z.object({
  /** Amount in Paise, positive integer. */
  amountPaise: z.number().int().positive(),
  direction: z.enum(['debit', 'credit']),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD').optional(),
  merchant: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().min(1).max(500).optional(),
  method: z.enum(PAYMENT_METHODS).optional(),
  reference: z.string().trim().max(100).optional(),
  balanceAfterPaise: z.number().int().optional(),
  accountMask: z
    .string()
    .regex(/^\d{4}$/, 'accountMask must be exactly the last 4 digits')
    .optional(),
});

export type ManualEntryInput = z.infer<typeof ManualEntrySchema>;

function parseOne(event: RawEvent): ParsedTransaction | null {
  let raw: unknown;
  try {
    raw = JSON.parse(event.payload);
  } catch {
    return null;
  }
  const result = ManualEntrySchema.safeParse(raw);
  if (!result.success) return null;
  const v = result.data;

  return {
    amount: paise(v.amountPaise),
    direction: v.direction,
    date: v.date,
    merchant: v.merchant,
    rawDescription: v.description ?? v.merchant ?? '',
    method: v.method ?? 'unknown',
    reference: v.reference,
    balanceAfter: v.balanceAfterPaise !== undefined ? paise(v.balanceAfterPaise) : undefined,
    accountMask: v.accountMask,
    confidence: 1,
  };
}

export const manualEntryAdapter: ChannelAdapter = {
  descriptor,
  canParse(event: RawEvent): boolean {
    return event.channel === 'manual';
  },
  parse(event: RawEvent): ParsedTransaction[] {
    const result = parseOne(event);
    return result ? [result] : [];
  },
};

export default manualEntryAdapter;
