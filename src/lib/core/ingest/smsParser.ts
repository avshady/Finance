/**
 * ChannelAdapter for Indian transaction SMS.
 *
 * Covers major bank/card/UPI sender templates. Deliberately conservative: a message
 * with no recognisable amount, or one that matches an OTP/promo/balance-enquiry
 * shape, returns `[]` rather than a guessed transaction — a false positive here
 * corrupts every downstream ratio the advisor engine computes.
 */

import type { ChannelAdapter, ChannelDescriptor, ParsedTransaction, RawEvent } from '../domain/types';
import {
  cleanMerchantCapture,
  detectDirection,
  detectInstitution,
  detectMethod,
  extractAccountMask,
  extractAmounts,
  extractReference,
  isNonFinancialMessage,
  parseDateFlexible,
} from './shared';

const descriptor: ChannelDescriptor = {
  id: 'sms',
  label: 'Transaction SMS',
  status: 'needs-companion-app',
  latency: 'real-time',
  requirement:
    'Requires an Android companion app (notification listener) or sharing individual SMS via the Web Share Target — the browser cannot read SMS on its own.',
};

// Merchant-capture patterns tried in order; first match wins.
const MERCHANT_PATTERNS: RegExp[] = [
  /\bto\s+([A-Za-z0-9][A-Za-z0-9 &.'\-]{1,40}?)\s+via\s+UPI\b/i,
  /\btrf\s+to\s+([A-Za-z0-9][A-Za-z0-9 &.'\-]{1,40}?)(?=\s+ref|\s+refno|[.,]|$)/i,
  /\bby\s+([A-Za-z0-9][A-Za-z0-9 &.'\-]{1,40}?)(?=[.,]|\s+avl|\s+available|$)/i,
  /\bat\s+([A-Za-z0-9][A-Za-z0-9 &.'\-]{1,40}?)(?=\s+on\s|[.,]|$)/i,
  /\btowards\s+([A-Za-z0-9][A-Za-z0-9 &.'\-]{1,40}?)(?=\s+for\b|\s+on\s|[.,]|$)/i,
  /\bfor\s+([A-Za-z0-9][A-Za-z0-9 &.'\-]{1,40}?)(?=\s+on\s|[.,]|$)/i,
  /\bto\s+([A-Za-z0-9][A-Za-z0-9 &.'\-]{1,40}?)(?=\s+on\s|[.,]|$)/i,
];

function extractMerchant(text: string): string | undefined {
  for (const re of MERCHANT_PATTERNS) {
    const m = re.exec(text);
    if (m) {
      const cleaned = cleanMerchantCapture(m[1]!);
      if (cleaned && !/^\d+$/.test(cleaned)) return cleaned;
    }
  }
  return undefined;
}

function parseOne(event: RawEvent): ParsedTransaction | null {
  const text = event.payload;
  if (isNonFinancialMessage(text)) return null;

  const { amount, balanceAfter } = extractAmounts(text);
  if (amount === null) return null;

  const { direction, confident: directionConfident } = detectDirection(text);
  const date = parseDateFlexible(text);
  const method = detectMethod(text);
  const reference = extractReference(text);
  const institution = detectInstitution(text, event.sender);
  const accountMask = extractAccountMask(text);
  const merchant = extractMerchant(text);

  let confidence: number;
  if (reference && directionConfident && date) {
    confidence = 0.95;
  } else if (directionConfident && date) {
    confidence = 0.75;
  } else {
    // amount found but direction or date had to be guessed
    confidence = 0.4;
  }

  return {
    amount,
    direction,
    date,
    merchant,
    rawDescription: text,
    method,
    reference,
    balanceAfter: balanceAfter ?? undefined,
    institution,
    accountMask,
    confidence,
  };
}

export const smsParser: ChannelAdapter = {
  descriptor,
  canParse(event: RawEvent): boolean {
    return event.channel === 'sms';
  },
  parse(event: RawEvent): ParsedTransaction[] {
    const result = parseOne(event);
    return result ? [result] : [];
  },
};

export default smsParser;
