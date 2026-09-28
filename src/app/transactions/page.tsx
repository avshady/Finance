'use client';

import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { getDb } from '@/lib/core/db';
import { BUILTIN_CATEGORIES } from '@/lib/core/db/seed';
import { saveTransaction, saveCategoryOverride, listCategoryOverrides } from '@/lib/core/db';
import { recordOverride, normalizeMerchant } from '@/lib/core/categorize';
import {
  commitParsedTransactions,
  confirmReviewTransaction,
  rejectReviewTransaction,
  NEEDS_REVIEW_TAG,
} from '@/lib/hooks/transactionIngest';
import { paise } from '@/lib/core/domain/money';
import type { Account, Category, PaymentMethod, Transaction, TxnDirection } from '@/lib/core/domain/types';
import { Card, CardHeader } from '@/components/Card';
import { CurrencyText } from '@/components/CurrencyText';
import { EmptyState } from '@/components/EmptyState';
import { Sheet } from '@/components/Sheet';
import { Button, Field, SelectInput, TextInput } from '@/components/forms';
import { SeverityBadge } from '@/components/SeverityBadge';

const PAGE_SIZE = 25;

const METHODS: PaymentMethod[] = [
  'upi', 'card_debit', 'card_credit', 'netbanking', 'imps', 'neft', 'rtgs', 'ach_mandate', 'cash', 'wallet', 'cheque', 'unknown',
];

function groupByDate(txns: Transaction[]): Array<[string, Transaction[]]> {
  const map = new Map<string, Transaction[]>();
  for (const t of txns) {
    const list = map.get(t.date) ?? [];
    list.push(t);
    map.set(t.date, list);
  }
  return [...map.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
}

export default function TransactionsPage() {
  const db = getDb();
  const accounts = useLiveQuery(() => db.accounts.toArray(), []);
  const categoriesRaw = useLiveQuery(() => db.categories.toArray(), []);
  const allTxns = useLiveQuery(() => db.transactions.orderBy('date').reverse().toArray(), []);
  const overridesRaw = useLiveQuery(() => listCategoryOverrides(), []);

  const categories = categoriesRaw && categoriesRaw.length > 0 ? categoriesRaw : BUILTIN_CATEGORIES;
  const overrides = useMemo(
    () => Object.fromEntries((overridesRaw ?? []).map((o) => [o.merchant, o.categoryId])),
    [overridesRaw],
  );
  const categoriesById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);

  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [detail, setDetail] = useState<Transaction | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  const loading = allTxns === undefined || accounts === undefined;

  const { confirmed, review } = useMemo(() => {
    const txns = allTxns ?? [];
    const review = txns.filter((t) => t.tags?.includes(NEEDS_REVIEW_TAG));
    const confirmed = txns.filter((t) => !t.tags?.includes(NEEDS_REVIEW_TAG));
    return { confirmed, review };
  }, [allTxns]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return confirmed.filter((t) => {
      if (q && !(t.merchant?.toLowerCase().includes(q) || t.rawDescription.toLowerCase().includes(q))) return false;
      if (categoryFilter && t.categoryId !== categoryFilter) return false;
      if (fromDate && t.date < fromDate) return false;
      if (toDate && t.date > toDate) return false;
      return true;
    });
  }, [confirmed, search, categoryFilter, fromDate, toDate]);

  const visible = filtered.slice(0, visibleCount);
  const grouped = groupByDate(visible);

  async function handleCategoryCorrection(txn: Transaction, categoryId: string) {
    const merchantKey = normalizeMerchant(txn.merchant ?? txn.rawDescription);
    // recordOverride is the pure learning function; the repository call below is what
    // makes it stick for every future transaction from this merchant.
    const updated = recordOverride(overrides, merchantKey, categoryId);
    await saveCategoryOverride(merchantKey, updated[merchantKey] ?? categoryId);
    await saveTransaction({ ...txn, categoryId, categoryAuto: false, updatedAt: new Date().toISOString() });
    setDetail((d) => (d && d.id === txn.id ? { ...d, categoryId, categoryAuto: false } : d));
  }

  if (loading) {
    return <div className="flex min-h-[50vh] items-center justify-center text-sm text-muted">Loading...</div>;
  }

  return (
    <div className="space-y-4 pb-4">
      <header className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-foreground">Transactions</h1>
        <Button onClick={() => setAddOpen(true)}>+ Add</Button>
      </header>

      {review.length > 0 ? (
        <Card className="border-warning/40">
          <CardHeader
            title={`Review queue (${review.length})`}
            subtitle="Parsed with low confidence — confirm the category before these count toward your numbers."
          />
          <div className="space-y-2">
            {review.map((t) => (
              <div key={t.id} className="rounded-lg border border-border p-3">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <SeverityBadge severity="low" />
                  <CurrencyText amount={t.amount} signColor variant="short" className={t.direction === 'debit' ? 'text-negative' : 'text-positive'} />
                </div>
                <p className="mb-2 text-sm text-foreground">{t.rawDescription}</p>
                <div className="flex flex-wrap items-center gap-2">
                  <SelectInput
                    className="max-w-[180px]"
                    value={t.categoryId}
                    onChange={(e) => saveTransaction({ ...t, categoryId: e.target.value, categoryAuto: false })}
                  >
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </SelectInput>
                  <Button variant="primary" onClick={() => confirmReviewTransaction(t)}>
                    Confirm
                  </Button>
                  <Button variant="ghost" onClick={() => rejectReviewTransaction(t.id)}>
                    Reject
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      <Card>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <TextInput
            placeholder="Search merchant or description"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setVisibleCount(PAGE_SIZE);
            }}
            className="col-span-2 md:col-span-2"
          />
          <SelectInput
            value={categoryFilter}
            onChange={(e) => {
              setCategoryFilter(e.target.value);
              setVisibleCount(PAGE_SIZE);
            }}
          >
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </SelectInput>
          <div className="flex gap-2">
            <TextInput type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} aria-label="From date" />
            <TextInput type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} aria-label="To date" />
          </div>
        </div>
      </Card>

      {filtered.length === 0 ? (
        <EmptyState
          icon="📝"
          title="No transactions match"
          description={confirmed.length === 0 ? 'Add your first transaction or import a statement to get started.' : 'Try widening your filters.'}
          action={
            confirmed.length === 0 ? (
              <Button onClick={() => setAddOpen(true)}>Add a transaction</Button>
            ) : undefined
          }
        />
      ) : (
        <div className="space-y-4">
          {grouped.map(([date, txns]) => (
            <div key={date}>
              <h3 className="mb-1.5 px-1 text-xs font-medium text-muted">
                {new Date(date).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}
              </h3>
              <Card padded={false} className="divide-y divide-border overflow-hidden">
                {txns.map((t) => {
                  const cat = categoriesById.get(t.categoryId);
                  return (
                    <button
                      key={t.id}
                      onClick={() => setDetail(t)}
                      className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-surface-raised"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm text-foreground">{t.merchant || t.rawDescription}</p>
                        <p className="truncate text-xs text-muted">
                          {cat?.icon} {cat?.name ?? t.categoryId}
                          {t.categoryAuto ? '' : ' · corrected'}
                        </p>
                      </div>
                      <CurrencyText
                        amount={t.amount}
                        signColor
                        variant="short"
                        className={t.direction === 'debit' ? 'text-negative' : 'text-positive'}
                      />
                    </button>
                  );
                })}
              </Card>
            </div>
          ))}
          {filtered.length > visibleCount ? (
            <div className="flex justify-center">
              <Button variant="secondary" onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}>
                Load more ({filtered.length - visibleCount} remaining)
              </Button>
            </div>
          ) : null}
        </div>
      )}

      <Sheet open={detail !== null} onClose={() => setDetail(null)} title="Transaction detail">
        {detail ? (
          <div className="space-y-3 text-sm">
            <p className="text-foreground">{detail.rawDescription}</p>
            <CurrencyText amount={detail.amount} variant="full" className="text-lg font-semibold text-foreground" />
            <div className="grid grid-cols-2 gap-2 text-xs text-muted">
              <span>Date: {detail.date}</span>
              <span>Method: {detail.method}</span>
              <span>Kind: {detail.kind}</span>
              <span>Channel: {detail.channel}</span>
            </div>
            <Field label="Category" hint="Correcting this teaches the categorizer for future transactions from this merchant.">
              <SelectInput value={detail.categoryId} onChange={(e) => handleCategoryCorrection(detail, e.target.value)}>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.icon} {c.name}
                  </option>
                ))}
              </SelectInput>
            </Field>
          </div>
        ) : null}
      </Sheet>

      <AddTransactionSheet
        open={addOpen}
        onClose={() => setAddOpen(false)}
        accounts={accounts ?? []}
        categories={categories}
        overrides={overrides}
      />
    </div>
  );
}

function AddTransactionSheet({
  open,
  onClose,
  accounts,
  categories,
  overrides,
}: {
  open: boolean;
  onClose: () => void;
  accounts: Account[];
  categories: Category[];
  overrides: Record<string, string>;
}) {
  const [amount, setAmount] = useState('');
  const [direction, setDirection] = useState<TxnDirection>('debit');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [merchant, setMerchant] = useState('');
  const [description, setDescription] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('upi');
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? '');
  const [categoryId, setCategoryId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    setError(null);
    const rupeeValue = Number(amount);
    if (!Number.isFinite(rupeeValue) || rupeeValue <= 0) {
      setError('Enter a valid amount.');
      return;
    }
    if (!accountId) {
      setError('Add an account first (Connectors screen creates one automatically on your first import, or use the default cash account).');
      return;
    }
    setSubmitting(true);
    try {
      const result = await commitParsedTransactions({
        parsed: [
          {
            amount: paise(Math.round(rupeeValue * 100)),
            direction,
            date,
            merchant: merchant || undefined,
            rawDescription: description || merchant || 'Manual entry',
            method,
            confidence: 1,
          },
        ],
        accountId,
        channel: 'manual',
        categories,
        overrides,
      });
      if (categoryId && result.committed[0]) {
        await saveTransaction({ ...result.committed[0], categoryId, categoryAuto: false });
      }
      setAmount('');
      setMerchant('');
      setDescription('');
      onClose();
    } catch {
      setError('Could not save this transaction.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="Add transaction">
      <div className="space-y-1">
        <Field label="Amount (₹)">
          <TextInput type="number" inputMode="decimal" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Direction">
            <SelectInput value={direction} onChange={(e) => setDirection(e.target.value as TxnDirection)}>
              <option value="debit">Debit (spend)</option>
              <option value="credit">Credit (income)</option>
            </SelectInput>
          </Field>
          <Field label="Date">
            <TextInput type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
        </div>
        <Field label="Merchant">
          <TextInput value={merchant} onChange={(e) => setMerchant(e.target.value)} placeholder="e.g. Swiggy" />
        </Field>
        <Field label="Notes / description">
          <TextInput value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Method">
            <SelectInput value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
              {METHODS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </SelectInput>
          </Field>
          <Field label="Account">
            <SelectInput value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              {accounts.length === 0 ? <option value="">No accounts yet</option> : null}
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </SelectInput>
          </Field>
        </div>
        <Field label="Category (optional override)">
          <SelectInput value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">Auto-categorize</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </SelectInput>
        </Field>
        {error ? <p className="text-xs text-negative">{error}</p> : null}
        <div className="mt-3 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting ? 'Saving...' : 'Save transaction'}
          </Button>
        </div>
      </div>
    </Sheet>
  );
}
