import { describe, expect, it } from 'vitest';
import type { ParsedTransaction, RawEvent } from '../domain/types';
import { smsParser } from './smsParser';

function sms(payload: string, sender?: string): RawEvent {
  return { id: 'evt1', channel: 'sms', receivedAt: '2026-09-27T10:00:00.000Z', payload, sender };
}

/** Parse a single SMS and return its one expected ParsedTransaction. */
function parseOne(payload: string, sender?: string): ParsedTransaction {
  const results = smsParser.parse(sms(payload, sender));
  expect(results).toHaveLength(1);
  return results[0]!;
}

describe('smsParser', () => {
  it('parses a UPI debit with reference', () => {
    const t = parseOne('Rs.450.00 debited from a/c **1234 on 27-09-26 to SWIGGY via UPI. Ref 512345678901. Not you? Call 18002586161');
    expect(t.amount).toBe(45000);
    expect(t.direction).toBe('debit');
    expect(t.method).toBe('upi');
    expect(t.merchant).toBe('SWIGGY');
    expect(t.reference).toBe('512345678901');
    expect(t.date).toBe('2026-09-27');
    expect(t.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it('parses a large salary credit with Indian grouping and Avl Bal', () => {
    const t = parseOne('INR 1,25,000.00 credited to your A/c XX4321 on 01-09-26 by SALARY. Avl Bal INR 2,45,120.55');
    expect(t.amount).toBe(12_500_000);
    expect(t.direction).toBe('credit');
    expect(t.merchant).toBe('SALARY');
    expect(t.balanceAfter).toBe(24_512_055);
    expect(t.date).toBe('2026-09-01');
  });

  it('parses a credit card spend', () => {
    const t = parseOne('Your HDFC Bank Credit Card ending 5678 was used for Rs 2,340 at AMAZON on 26-09-26.');
    expect(t.amount).toBe(234_000);
    expect(t.direction).toBe('debit');
    expect(t.method).toBe('card_credit');
    expect(t.merchant).toBe('AMAZON');
    expect(t.institution).toBe('HDFC');
    expect(t.accountMask).toBe('5678');
  });

  it('parses an EMI debit', () => {
    const t = parseOne('Rs 18500 debited towards EMI for Loan A/c 99887766 on 05-09-26.');
    expect(t.amount).toBe(1_850_000);
    expect(t.direction).toBe('debit');
    expect(t.date).toBe('2026-09-05');
  });

  it('parses a P2P transfer with ddMONyy date and Refno', () => {
    const t = parseOne('A/c XX1234 debited by Rs.500.0 on date 27Sep26 trf to JOHN DOE Refno 123456789');
    expect(t.amount).toBe(50_000);
    expect(t.direction).toBe('debit');
    expect(t.date).toBe('2026-09-27');
    expect(t.merchant).toBe('JOHN DOE');
    expect(t.reference).toBe('123456789');
    expect(t.accountMask).toBe('1234');
  });

  it('parses an ICICI UPI credit', () => {
    const t = parseOne('Dear Customer, Rs 750.00 credited to your ICICI Bank a/c XX7890 on 15-08-26 via UPI from RAHUL. Ref no 998877665544.', 'AX-ICICIB');
    expect(t.amount).toBe(75_000);
    expect(t.direction).toBe('credit');
    expect(t.institution).toBe('ICICI');
    expect(t.reference).toBe('998877665544');
  });

  it('parses an SBI debit card POS transaction', () => {
    const t = parseOne('Your SBI Debit Card was used for Rs 1,200.00 at RELIANCE TRENDS on 10-09-2026. Avl Bal Rs 50,000.00');
    expect(t.amount).toBe(120_000);
    expect(t.direction).toBe('debit');
    expect(t.method).toBe('card_debit');
    expect(t.institution).toBe('SBI');
  });

  it('parses an Axis Bank NEFT credit', () => {
    const t = parseOne('Rs.15,000.00 credited to A/c XX3344 via NEFT on 2026-09-20 from EMPLOYER PVT LTD. Ref NEFT12345678');
    expect(t.amount).toBe(1_500_000);
    expect(t.direction).toBe('credit');
    expect(t.method).toBe('neft');
    expect(t.date).toBe('2026-09-20');
  });

  it('parses a Kotak UPI debit', () => {
    const t = parseOne('Rs 320 debited from Kotak a/c XX5566 to ZOMATO via UPI on 12-09-26. UPI Ref 445566778899');
    expect(t.amount).toBe(32_000);
    expect(t.institution).toBe('KOTAK');
    expect(t.merchant).toBe('ZOMATO');
  });

  it('parses an IDFC First wallet load', () => {
    const t = parseOne('Rs 1000.00 debited from your IDFC FIRST Bank a/c XX9988 to Paytm Wallet on 01-09-26. Ref 111222333');
    expect(t.amount).toBe(100_000);
    expect(t.institution).toBe('IDFC_FIRST');
  });

  it('parses a Yes Bank IMPS debit', () => {
    const t = parseOne('Rs 5,500 debited from Yes Bank a/c XX1111 via IMPS to VENDOR SERVICES on 03-09-26. Ref 778899001122');
    expect(t.amount).toBe(550_000);
    expect(t.method).toBe('imps');
    expect(t.institution).toBe('YES_BANK');
  });

  it('parses an IndusInd Bank debit', () => {
    const t = parseOne('Rs.999.00 debited from IndusInd Bank a/c XX2222 to BOOKMYSHOW via UPI on 18-09-26. Ref 334455667788');
    expect(t.amount).toBe(99_900);
    expect(t.institution).toBe('INDUSIND');
    expect(t.merchant).toBe('BOOKMYSHOW');
  });

  it('parses a PNB RTGS credit', () => {
    const t = parseOne('INR 5,00,000.00 credited to your PNB a/c XX4455 via RTGS on 22-09-26 by CLIENT PAYMENT. Ref RTGS998877');
    expect(t.amount).toBe(50_000_000);
    expect(t.method).toBe('rtgs');
    expect(t.institution).toBe('PNB');
  });

  it('parses a Bank of Baroda debit', () => {
    const t = parseOne('Rs 2,500.00 debited from BOB a/c XX6677 to UBER via UPI on 09-09-26. Ref 556677889900');
    expect(t.amount).toBe(250_000);
    expect(t.institution).toBe('BOB');
    expect(t.merchant).toBe('UBER');
  });

  it('parses a Canara Bank debit', () => {
    const t = parseOne('Rs 800 debited from Canara Bank a/c XX7788 to SWIGGY via UPI on 14-09-26. Ref 667788990011');
    expect(t.amount).toBe(80_000);
    expect(t.institution).toBe('CANARA');
  });

  it('parses a Union Bank of India debit', () => {
    const t = parseOne('Rs 3,200.00 debited from Union Bank a/c XX8899 to FLIPKART via UPI on 16-09-26. Ref 778899001133');
    expect(t.amount).toBe(320_000);
    expect(t.institution).toBe('UNION_BANK');
  });

  it('parses a Federal Bank debit', () => {
    const t = parseOne('Rs 450.50 debited from Federal Bank a/c XX9900 to MYNTRA via UPI on 19-09-26. Ref 889900112244');
    expect(t.amount).toBe(45_050);
    expect(t.institution).toBe('FEDERAL');
  });

  it('parses an RBL Bank credit card transaction', () => {
    const t = parseOne('Your RBL Bank Credit Card ending 3344 was used for Rs 5,600 at CROMA on 21-09-26.');
    expect(t.amount).toBe(560_000);
    expect(t.method).toBe('card_credit');
    expect(t.institution).toBe('RBL');
  });

  it('parses an AU Small Finance Bank debit', () => {
    const t = parseOne('Rs 1,100.00 debited from AU Small Finance Bank a/c XX0011 to NYKAA via UPI on 23-09-26. Ref 990011223355');
    expect(t.amount).toBe(110_000);
    expect(t.institution).toBe('AU_SFB');
  });

  it('parses an Amex card transaction', () => {
    const t = parseOne('Your American Express Card was used for Rs 12,000 at MAKEMYTRIP on 24-09-26.');
    expect(t.amount).toBe(1_200_000);
    expect(t.institution).toBe('AMEX');
  });

  it('parses a CRED rent payment', () => {
    const t = parseOne('Rs 25,000.00 debited from a/c XX3300 to LANDLORD via UPI on 25-09-26 through CRED. Ref 001122334455');
    expect(t.amount).toBe(2_500_000);
    expect(t.institution).toBe('CRED');
  });

  // ---- Negative cases: non-financial messages must return [] ----

  it('returns [] for an OTP message', () => {
    expect(smsParser.parse(sms('123456 is your OTP for transaction of Rs.5000 at AMAZON. Do not share this OTP with anyone.'))).toEqual([]);
  });

  it('returns [] for a plain OTP without amount', () => {
    expect(smsParser.parse(sms('Your OTP is 998877. Valid for 10 mins. Do not share with anyone.'))).toEqual([]);
  });

  it('returns [] for a promotional/offer message', () => {
    expect(
      smsParser.parse(sms('Get flat 50% off on your next order! Use code SAVE50. Shop now on the app. T&C apply.')),
    ).toEqual([]);
  });

  it('returns [] for a cashback promo mentioning an amount but no transaction', () => {
    expect(smsParser.parse(sms('Get cashback upto Rs.500 on your next UPI payment! Offer valid till 30-09-26. Download the app now.'))).toEqual([]);
  });

  it('returns [] for a balance-enquiry-only alert', () => {
    expect(smsParser.parse(sms('Your available balance as on 27-09-26 is Rs.45,320.00 in a/c XX1234.'))).toEqual([]);
  });

  it('returns [] for a minimum-due reminder', () => {
    expect(smsParser.parse(sms('Reminder: Your minimum amount due of Rs.2,500 is payable by 05-10-26 on card ending 5678.'))).toEqual([]);
  });

  it('returns [] for credit-limit marketing', () => {
    expect(smsParser.parse(sms('Good news! Your credit limit has been increased to Rs.2,00,000. Enjoy more spending power.'))).toEqual([]);
  });

  it('returns [] for a cheque-bounced notice without an amount', () => {
    expect(smsParser.parse(sms('Your cheque no 000123 has been returned unpaid due to insufficient funds. Please contact your branch.'))).toEqual([]);
  });
});
