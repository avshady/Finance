import { describe, expect, it } from 'vitest';
import { normalizeMerchant } from './normalizeMerchant';

describe('normalizeMerchant', () => {
  it('strips UPI prefix, order id and city suffix', () => {
    expect(normalizeMerchant('UPI/P2M/412345678901/SWIGGY LIMITED BANGALORE')).toBe('SWIGGY');
  });

  it('strips a UPI handle', () => {
    expect(normalizeMerchant('SWIGGY@okhdfcbank')).toBe('SWIGGY');
    expect(normalizeMerchant('9876543210@ybl')).toBe('');
  });

  it('strips POS/ATM and terminal ids', () => {
    expect(normalizeMerchant('POS 123456 AMAZON RETAIL INDIA PVT LTD')).toBe('AMAZON');
  });

  it('strips NEFT/IMPS/RTGS prefixes', () => {
    expect(normalizeMerchant('NEFT-N123456789012-EMPLOYER PVT LTD')).toBe('EMPLOYER');
    expect(normalizeMerchant('IMPS-998877665544-JOHN DOE')).toBe('JOHN DOE');
  });

  it('strips trailing state names', () => {
    expect(normalizeMerchant('OLACABS KARNATAKA')).toBe('OLA');
  });

  it('folds canonical aliases together', () => {
    expect(normalizeMerchant('SWIGGY INSTAMART')).toBe('SWIGGY');
    expect(normalizeMerchant('SWIGGYIT')).toBe('SWIGGY');
    expect(normalizeMerchant('AMAZON PAY')).toBe('AMAZON');
    expect(normalizeMerchant('AMZN')).toBe('AMAZON');
    expect(normalizeMerchant('OLACABS')).toBe('OLA');
  });

  it('collapses whitespace and uppercases', () => {
    expect(normalizeMerchant('  zomato   limited  ')).toBe('ZOMATO');
  });

  it('handles empty/undefined input', () => {
    expect(normalizeMerchant(undefined)).toBe('');
    expect(normalizeMerchant('')).toBe('');
  });

  it('strips date fragments', () => {
    expect(normalizeMerchant('SWIGGY 27-09-26')).toBe('SWIGGY');
  });
});
