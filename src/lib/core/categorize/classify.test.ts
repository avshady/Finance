import { describe, expect, it } from 'vitest';
import { classify, detectSelfTransfer } from './classify';

describe('classify', () => {
  it('classifies an exact merchant match (food delivery)', () => {
    const result = classify({ merchant: 'SWIGGY', rawDescription: 'UPI/P2M/123456/SWIGGY', direction: 'debit' });
    expect(result.categoryId).toBe('cat.food.food_delivery');
    expect(result.kind).toBe('expense');
    expect(result.auto).toBe(true);
    expect(result.confidence).toBeCloseTo(0.9);
  });

  it('folds a merchant alias before matching (SWIGGY INSTAMART -> SWIGGY -> food.delivery)', () => {
    const result = classify({ merchant: 'SWIGGY INSTAMART', rawDescription: 'SWIGGY INSTAMART', direction: 'debit' });
    expect(result.categoryId).toBe('cat.food.food_delivery');
  });

  it('falls back to a keyword rule when no exact merchant matches', () => {
    const result = classify({ rawDescription: 'PAYMENT TO LOCAL KIRANA STORE', direction: 'debit' });
    expect(result.categoryId).toBe('cat.food.groceries');
    expect(result.confidence).toBeCloseTo(0.7);
  });

  it('lets fee rules beat generic matches (annual fee)', () => {
    const result = classify({ rawDescription: 'ANNUAL FEE FOR CREDIT CARD AMAZON PAY ICICI', direction: 'debit' });
    expect(result.categoryId).toBe('cat.fees.bank_charges');
    expect(result.kind).toBe('fee');
  });

  it('lets investment rules beat generic matches (SIP mandate)', () => {
    const result = classify({ rawDescription: 'ACH SIP ZERODHA MUTUAL FUND MANDATE', direction: 'debit' });
    // SIP has higher priority than mutual_fund keyword, both are investment-kind
    expect(result.kind).toBe('investment');
    expect(result.categoryId).toBe('cat.investment.sip_mutual_fund');
  });

  it('infers emi_payment kind from EMI narration', () => {
    const result = classify({ rawDescription: 'EMI PAYMENT FOR LOAN A/C 998877', direction: 'debit' });
    expect(result.kind).toBe('emi_payment');
    expect(result.categoryId).toBe('cat.debt.other_emi');
  });

  it('infers income kind for a salary credit', () => {
    const result = classify({ rawDescription: 'SALARY CREDIT SEPTEMBER', direction: 'credit' });
    expect(result.kind).toBe('income');
    expect(result.categoryId).toBe('cat.income.salary');
  });

  it('detects a self-transfer and overrides kind even on an exact merchant match', () => {
    const result = classify({
      merchant: 'SWIGGY',
      rawDescription: 'TRANSFER TO SELF SAVINGS A/C',
      direction: 'debit',
    });
    expect(result.kind).toBe('transfer');
  });

  it('falls back to uncategorized with low confidence for unrecognised narrations', () => {
    const result = classify({ rawDescription: 'XQZPLM RANDOM VENDOR 998234', direction: 'debit' });
    expect(result.categoryId).toBe('cat.uncategorized.general');
    expect(result.confidence).toBeLessThan(0.5);
  });

  it('a user override always wins, at confidence 1, even over an exact merchant rule', () => {
    const result = classify(
      { merchant: 'SWIGGY', rawDescription: 'UPI/P2M/1/SWIGGY', direction: 'debit' },
      { SWIGGY: 'cat.food.restaurants' },
    );
    expect(result.categoryId).toBe('cat.food.restaurants');
    expect(result.confidence).toBe(1);
    expect(result.auto).toBe(false);
  });

  it('an unrecognised credit falls back to a generic income category', () => {
    const result = classify({ rawDescription: 'MISC CREDIT FROM UNKNOWN PARTY', direction: 'credit' });
    expect(result.kind).toBe('income');
  });
});

describe('detectSelfTransfer', () => {
  it('detects "self" keyword narrations', () => {
    expect(detectSelfTransfer('TRANSFER TO SELF A/C')).toBe(true);
  });

  it('detects a narration containing one of the user\'s own account masks', () => {
    expect(detectSelfTransfer('TRF TO A/C XX4321', ['4321'])).toBe(true);
  });

  it('returns false for an ordinary merchant narration', () => {
    expect(detectSelfTransfer('UPI/P2M/1/SWIGGY')).toBe(false);
  });
});
