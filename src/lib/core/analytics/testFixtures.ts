/**
 * Shared test-fixture builders for the analytics module's test suites.
 * Not a *.test.ts file itself — Vitest only collects *.test.ts, so this file adds no
 * test cases of its own; it only supplies builders those files import.
 */

import type { Account, Budget, Category, Loan, Transaction } from '../domain/types';
import { fromRupees, type Paise } from '../domain/money';

let idCounter = 0;
function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

export function resetIds(): void {
  idCounter = 0;
}

export const CATEGORIES: Category[] = [
  { id: 'rent', name: 'Rent', group: 'housing', essential: true, builtin: true },
  { id: 'groceries', name: 'Groceries', group: 'food', essential: true, builtin: true },
  { id: 'utilities', name: 'Utilities', group: 'utilities', essential: true, builtin: true },
  { id: 'dining', name: 'Dining Out', group: 'food', essential: false, builtin: true },
  { id: 'entertainment', name: 'Entertainment', group: 'entertainment', essential: false, builtin: true },
  { id: 'shopping', name: 'Shopping', group: 'shopping', essential: false, builtin: true },
  { id: 'salary', name: 'Salary', group: 'income', essential: false, builtin: true },
  { id: 'subscriptions', name: 'Subscriptions', group: 'entertainment', essential: false, builtin: true },
  { id: 'investments', name: 'Investments', group: 'investment', essential: false, builtin: true },
  { id: 'transfer', name: 'Transfer', group: 'transfer', essential: false, builtin: true },
];

export function makeTxn(overrides: Partial<Transaction> & { date: string; amount: Paise }): Transaction {
  return {
    id: nextId('txn'),
    accountId: 'acc-checking',
    direction: overrides.direction ?? 'debit',
    currency: 'INR',
    observedAt: `${overrides.date}T10:00:00.000Z`,
    rawDescription: overrides.rawDescription ?? 'TXN',
    merchant: overrides.merchant,
    categoryId: overrides.categoryId ?? 'shopping',
    categoryAuto: true,
    kind: overrides.kind ?? 'expense',
    method: overrides.method ?? 'upi',
    channel: overrides.channel ?? 'sms',
    excluded: overrides.excluded,
    reference: overrides.reference,
    transferPairId: overrides.transferPairId,
    createdAt: `${overrides.date}T10:00:00.000Z`,
    updatedAt: `${overrides.date}T10:00:00.000Z`,
    ...overrides,
  };
}

export function rupees(n: number): Paise {
  return fromRupees(n);
}

export function makeAccount(overrides: Partial<Account> & { kind: Account['kind']; balance: Paise }): Account {
  return {
    id: nextId('acc'),
    name: overrides.name ?? 'Account',
    currency: 'INR',
    createdAt: '2020-01-01T00:00:00.000Z',
    updatedAt: '2020-01-01T00:00:00.000Z',
    ...overrides,
  };
}

export function makeLoan(overrides: Partial<Loan> & { emiAmount: Paise; outstanding: Paise }): Loan {
  return {
    id: nextId('loan'),
    name: overrides.name ?? 'Loan',
    kind: overrides.kind ?? 'personal',
    principal: overrides.principal ?? overrides.outstanding,
    annualRate: overrides.annualRate ?? 0.1,
    rateType: overrides.rateType ?? 'fixed',
    tenureMonths: overrides.tenureMonths ?? 36,
    paidInstalments: overrides.paidInstalments ?? 0,
    emiDay: overrides.emiDay ?? 5,
    startDate: overrides.startDate ?? '2024-01-05',
    createdAt: '2024-01-05T00:00:00.000Z',
    updatedAt: '2024-01-05T00:00:00.000Z',
    ...overrides,
  };
}

export function makeBudget(overrides: Partial<Budget> & { categoryId: string; limit: Paise }): Budget {
  return {
    id: nextId('budget'),
    createdAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}
