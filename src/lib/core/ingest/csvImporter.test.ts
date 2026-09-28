import { describe, expect, it } from 'vitest';
import { detectHeader, importCsv, parseCsv } from './csvImporter';

describe('parseCsv', () => {
  it('handles quoted fields containing commas', () => {
    const rows = parseCsv('Date,Narration,Amount\n01-09-26,"SWIGGY, BANGALORE",450.00\n');
    expect(rows).toEqual([
      ['Date', 'Narration', 'Amount'],
      ['01-09-26', 'SWIGGY, BANGALORE', '450.00'],
    ]);
  });

  it('handles escaped double-quotes inside a quoted field', () => {
    const rows = parseCsv('Date,Narration\n01-09-26,"He said ""hi"" to me"\n');
    expect(rows[1]![1]).toBe('He said "hi" to me');
  });

  it('handles CRLF line endings', () => {
    const rows = parseCsv('Date,Amount\r\n01-09-26,100\r\n02-09-26,200\r\n');
    expect(rows).toEqual([
      ['Date', 'Amount'],
      ['01-09-26', '100'],
      ['02-09-26', '200'],
    ]);
  });

  it('strips a leading BOM', () => {
    const rows = parseCsv('﻿Date,Amount\n01-09-26,100\n');
    expect(rows[0]![0]).toBe('Date');
  });
});

describe('detectHeader', () => {
  it('finds the header row even with preamble rows before it', () => {
    const rows = parseCsv(
      'Statement of Account\nAccount Number: XX1234\nStatement Period: 01-09-26 to 30-09-26\n\nDate,Narration,Withdrawal Amt.,Deposit Amt.,Closing Balance\n01-09-26,SWIGGY,450.00,,10000.00\n',
    );
    const detection = detectHeader(rows);
    expect(detection).not.toBeNull();
    expect(detection!.headerRowIndex).toBe(4);
    expect(detection!.columns.date).toBe(0);
    expect(detection!.columns.narration).toBe(1);
    expect(detection!.columns.debit).toBe(2);
    expect(detection!.columns.credit).toBe(3);
    expect(detection!.columns.balance).toBe(4);
  });
});

describe('importCsv', () => {
  it('imports a debit/credit two-column layout', () => {
    const csv =
      'Date,Narration,Withdrawal Amt.,Deposit Amt.,Closing Balance,Chq/Ref No.\n' +
      '01-09-26,UPI/P2M/123456/SWIGGY,450.00,,99550.00,REF001\n' +
      '02-09-26,SALARY CREDIT,,50000.00,149550.00,REF002\n';
    const txns = importCsv(csv);
    expect(txns).toHaveLength(2);
    expect(txns[0]!.amount).toBe(45_000);
    expect(txns[0]!.direction).toBe('debit');
    expect(txns[0]!.balanceAfter).toBe(9_955_000);
    expect(txns[0]!.reference).toBe('REF001');
    expect(txns[1]!.amount).toBe(5_000_000);
    expect(txns[1]!.direction).toBe('credit');
  });

  it('imports a single signed-amount layout', () => {
    const csv = 'Date,Description,Amount,Balance\n01-09-26,SWIGGY,-450.00,99550.00\n02-09-26,SALARY,50000.00,149550.00\n';
    const txns = importCsv(csv);
    expect(txns).toHaveLength(2);
    expect(txns[0]!.direction).toBe('debit');
    expect(txns[0]!.amount).toBe(45_000);
    expect(txns[1]!.direction).toBe('credit');
    expect(txns[1]!.amount).toBe(5_000_000);
  });

  it('handles quoted commas, CRLF, BOM, and preamble rows together', () => {
    const csv =
      '﻿HDFC BANK STATEMENT\r\nAccount: XX9988\r\n\r\nDate,Narration,Withdrawal Amt.,Deposit Amt.,Closing Balance\r\n' +
      '05-09-26,"UPI/P2M/998877/BIG BAZAAR, MUMBAI",1200.00,,50000.00\r\n' +
      '06-09-26,"REFUND FROM ""AMAZON""",,300.00,50300.00\r\n';
    const txns = importCsv(csv);
    expect(txns).toHaveLength(2);
    expect(txns[0]!.rawDescription).toBe('UPI/P2M/998877/BIG BAZAAR, MUMBAI');
    expect(txns[0]!.amount).toBe(120_000);
    expect(txns[1]!.rawDescription).toBe('REFUND FROM "AMAZON"');
    expect(txns[1]!.direction).toBe('credit');
  });

  it('returns [] when no header row can be found', () => {
    expect(importCsv('just,some,random,text\nwith,no,recognisable,header\n')).toEqual([]);
  });
});
