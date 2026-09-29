/**
 * The Web Share Target is the one genuinely real-time ingest path that needs no
 * credentials: long-press a bank SMS on Android, share it in, done.
 *
 * It silently parsed everything to nothing. Adapters gate on `event.channel`, the share
 * page emitted `channel: 'share_target'`, and no adapter claims that channel — so
 * `parseEvent` fell through its loop and returned []. The UI dutifully reported "no
 * transaction was recognised" for messages the SMS parser reads perfectly, and because
 * the failure looked like an unsupported format rather than a bug, it would have been
 * easy to keep believing the parser was simply weak.
 */

import { describe, expect, it } from 'vitest';

import { parseEvent } from './registry';
import type { RawEvent } from '../domain/types';

function shared(payload: string): RawEvent {
  return {
    id: 'share-1',
    channel: 'share_target',
    receivedAt: '2026-09-29T10:00:00.000Z',
    payload,
  };
}

describe('share_target routing', () => {
  it('parses a shared bank SMS', () => {
    const [txn] = parseEvent(
      shared('Rs.2,340.00 debited from a/c **1234 on 28-09-26 to AMAZON via UPI. Ref 998877665544.'),
    );
    expect(txn).toBeDefined();
    expect(txn!.amount).toBe(234000);
    expect(txn!.direction).toBe('debit');
    expect(txn!.merchant).toBe('AMAZON');
    expect(txn!.reference).toBe('998877665544');
  });

  it('parses a shared credit alert', () => {
    const [txn] = parseEvent(
      shared('INR 1,25,000.00 credited to your A/c XX4321 on 01-09-26 by SALARY. Avl Bal INR 2,45,120.55'),
    );
    expect(txn).toBeDefined();
    expect(txn!.amount).toBe(12500000);
    expect(txn!.direction).toBe('credit');
  });

  it('parses a shared card alert', () => {
    const [txn] = parseEvent(
      shared('Your HDFC Bank Credit Card ending 5678 was used for Rs 2,340 at AMAZON on 26-09-26.'),
    );
    expect(txn).toBeDefined();
    expect(txn!.amount).toBe(234000);
  });

  it('still refuses an OTP, even one quoting an amount', () => {
    expect(
      parseEvent(shared('Your OTP is 481920 for a transaction of Rs.9,999 on your card. Do not share.')),
    ).toEqual([]);
  });

  it('refuses a promotional message', () => {
    expect(
      parseEvent(shared('Get a pre-approved personal loan of Rs 5,00,000 at just 10.5%! Apply now.')),
    ).toEqual([]);
  });

  it('returns nothing for text with no transaction in it', () => {
    expect(parseEvent(shared('see you at 7'))).toEqual([]);
  });

  it('agrees with the sms channel on the same text', () => {
    const payload = 'Rs.450.00 debited from a/c **1234 on 27-09-26 to SWIGGY via UPI. Ref 512345678901.';
    const viaShare = parseEvent(shared(payload));
    const viaSms = parseEvent({ ...shared(payload), channel: 'sms', sender: 'VM-HDFCBK' });
    expect(viaShare).toEqual(viaSms);
    expect(viaShare).toHaveLength(1);
  });
});
