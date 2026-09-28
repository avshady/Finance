import { describe, expect, it } from 'vitest';
import { paise } from '../domain/money';
import { dedupeBatch, fingerprint, isDuplicate, type DedupeCandidate } from './dedupe';

function candidate(overrides: Partial<DedupeCandidate>): DedupeCandidate {
  return {
    amount: paise(45_000),
    direction: 'debit',
    rawDescription: 'SWIGGY',
    method: 'upi',
    confidence: 0.9,
    accountId: 'acc1',
    observedAt: '2026-09-27T10:00:00.000Z',
    ...overrides,
  };
}

describe('isDuplicate', () => {
  it('treats the same swipe arriving via SMS then email as a duplicate', () => {
    const sms = candidate({ reference: 'REF123', observedAt: '2026-09-27T10:00:00.000Z', confidence: 0.95 });
    const email = candidate({ reference: 'REF123', observedAt: '2026-09-27T10:02:10.000Z', confidence: 0.8 });
    expect(isDuplicate(email, [sms])).toBe(true);
  });

  it('matches within the 90 second window just inside the boundary', () => {
    const a = candidate({ observedAt: '2026-09-27T10:00:00.000Z' });
    const b = candidate({ observedAt: '2026-09-27T10:01:29.000Z' }); // 89s later
    expect(isDuplicate(b, [a])).toBe(true);
  });

  it('does not match just outside the 90 second window', () => {
    const a = candidate({ observedAt: '2026-09-27T10:00:00.000Z' });
    const b = candidate({ observedAt: '2026-09-27T10:01:31.000Z' }); // 91s later
    expect(isDuplicate(b, [a])).toBe(false);
  });

  it('prefers reference match precedence over amount/window heuristics', () => {
    // Different amounts but matching reference: still a duplicate (reference decisive).
    const a = candidate({ reference: 'REFXYZ', amount: paise(45_000) });
    const b = candidate({ reference: 'REFXYZ', amount: paise(45_100) });
    expect(isDuplicate(b, [a])).toBe(true);
  });

  it('does not merge two distinct same-amount transactions 10 minutes apart', () => {
    const a = candidate({ observedAt: '2026-09-27T10:00:00.000Z' });
    const b = candidate({ observedAt: '2026-09-27T10:10:00.000Z' });
    expect(isDuplicate(b, [a])).toBe(false);
  });

  it('does not match across different accounts', () => {
    const a = candidate({ accountId: 'acc1' });
    const b = candidate({ accountId: 'acc2' });
    expect(isDuplicate(b, [a])).toBe(false);
  });

  it('does not match different directions', () => {
    const a = candidate({ direction: 'debit' });
    const b = candidate({ direction: 'credit' });
    expect(isDuplicate(b, [a])).toBe(false);
  });
});

describe('dedupeBatch', () => {
  it('collapses the SMS+email duplicate and prefers the higher-confidence record', () => {
    const sms = candidate({ reference: 'REF999', confidence: 0.95, method: 'upi' });
    const email = candidate({ reference: 'REF999', confidence: 0.6, method: 'unknown' });
    const { unique, duplicates } = dedupeBatch([sms, email]);
    expect(unique).toHaveLength(1);
    expect(unique[0]!.confidence).toBe(0.95);
    expect(unique[0]!.method).toBe('upi');
    expect(duplicates).toHaveLength(1);
    expect(duplicates[0]!.confidence).toBe(0.6);
  });

  it('keeps two genuinely distinct transactions separate', () => {
    const a = candidate({ observedAt: '2026-09-27T10:00:00.000Z', reference: 'A1' });
    const b = candidate({ observedAt: '2026-09-27T10:10:00.000Z', reference: 'B2' });
    const { unique, duplicates } = dedupeBatch([a, b]);
    expect(unique).toHaveLength(2);
    expect(duplicates).toHaveLength(0);
  });
});

describe('fingerprint', () => {
  it('is stable for the same reference/account', () => {
    const a = candidate({ reference: 'REF1' });
    const b = candidate({ reference: 'REF1', observedAt: '2026-09-27T11:00:00.000Z' });
    expect(fingerprint(a)).toBe(fingerprint(b));
  });
});
