/**
 * ChannelAdapter for transaction alert / receipt emails.
 *
 * Handles bank/card alert emails, UPI receipts, and merchant order-confirmation
 * emails (Amazon/Flipkart/Swiggy/Zomato/Uber). Strips HTML down to text first,
 * then reuses the same extraction contract as the SMS parser.
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
  id: 'email',
  label: 'Transaction email',
  status: 'needs-credentials',
  latency: 'minutes',
  requirement:
    'Requires connecting a Gmail/IMAP account (OAuth or app password) so the app can read alert and receipt emails. Nothing is read until that is configured.',
};

/** Strip tags/entities down to plain text, collapse whitespace. */
export function htmlToText(html: string): string {
  if (!/[<>]/.test(html)) return html;
  let text = html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>|<\/div>|<\/tr>|<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim();
  return text;
}

const MERCHANT_PATTERNS: RegExp[] = [
  /\bto\s+([A-Za-z0-9][A-Za-z0-9 &.'\-]{1,40}?)\s+via\s+UPI\b/i,
  /\border(?:\s+for|\s+from|\s+confirmation)?\s*[:\-]?\s*([A-Za-z0-9][A-Za-z0-9 &.'\-]{1,40}?)(?=\s+has been|\s+is confirmed|[.,\n]|$)/i,
  /\btrf\s+to\s+([A-Za-z0-9][A-Za-z0-9 &.'\-]{1,40}?)(?=\s+ref|[.,]|$)/i,
  /\bby\s+([A-Za-z0-9][A-Za-z0-9 &.'\-]{1,40}?)(?=[.,]|\s+avl|\s+available|$)/i,
  /\bat\s+([A-Za-z0-9][A-Za-z0-9 &.'\-]{1,40}?)(?=\s+on\s|[.,]|$)/i,
  /\bmerchant\s*[:\-]\s*([A-Za-z0-9][A-Za-z0-9 &.'\-]{1,40}?)(?=[.,\n]|$)/i,
  /\bfrom\s+([A-Za-z0-9][A-Za-z0-9 &.'\-]{1,40}?)(?=\s+on\s|[.,]|$)/i,
];

function extractMerchant(text: string, sender?: string): string | undefined {
  for (const re of MERCHANT_PATTERNS) {
    const m = re.exec(text);
    if (m) {
      const cleaned = cleanMerchantCapture(m[1]!);
      if (cleaned && !/^\d+$/.test(cleaned)) return cleaned;
    }
  }
  // Fall back to the sender's domain-ish name, e.g. "orders@amazon.in" -> AMAZON.
  if (sender) {
    const m = /@([a-z0-9.\-]+)\./i.exec(sender);
    if (m) return m[1]!.split('.')[0]!.toUpperCase();
  }
  return undefined;
}

function parseOne(event: RawEvent): ParsedTransaction | null {
  const text = htmlToText(event.payload);
  if (isNonFinancialMessage(text)) return null;

  const { amount, balanceAfter } = extractAmounts(text);
  if (amount === null) return null;

  const { direction, confident: directionConfident } = detectDirection(text);
  const date = parseDateFlexible(text);
  const method = detectMethod(text);
  const reference = extractReference(text);
  const institution = detectInstitution(text, event.sender);
  const accountMask = extractAccountMask(text);
  const merchant = extractMerchant(text, event.sender);

  let confidence: number;
  if (reference && directionConfident && date) {
    confidence = 0.95;
  } else if (directionConfident && date) {
    confidence = 0.75;
  } else {
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

export const emailParser: ChannelAdapter = {
  descriptor,
  canParse(event: RawEvent): boolean {
    return event.channel === 'email';
  },
  parse(event: RawEvent): ParsedTransaction[] {
    const result = parseOne(event);
    return result ? [result] : [];
  },
};

export default emailParser;
