'use client';

import { useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { getDb, saveAccount, saveRawEvent, listCategoryOverrides } from '@/lib/core/db';
import { BUILTIN_CATEGORIES } from '@/lib/core/db/seed';
import { CHANNELS, importCsv } from '@/lib/core/ingest';
import { commitParsedTransactions } from '@/lib/hooks/transactionIngest';
import { ZERO } from '@/lib/core/domain/money';
import type { Account, ChannelDescriptor, ChannelStatus } from '@/lib/core/domain/types';
import { Card, CardHeader } from '@/components/Card';
import { Button, Field, TextArea } from '@/components/forms';
import { Disclaimer } from '@/components/Disclaimer';

const STATUS_META: Record<ChannelStatus, { label: string; dot: string; text: string; explain: string }> = {
  live: {
    label: 'Live',
    dot: 'bg-positive',
    text: 'text-positive',
    explain: 'Works today, no setup beyond what is described below.',
  },
  'needs-credentials': {
    label: 'Needs credentials',
    dot: 'bg-warning',
    text: 'text-warning',
    explain: 'Not connected. You would need to supply your own account/API credentials for this to move data.',
  },
  'needs-companion-app': {
    label: 'Needs companion app',
    dot: 'bg-accent',
    text: 'text-accent',
    explain: 'Not connected. The browser alone cannot read this; a native companion or share action is required.',
  },
};

const LATENCY_LABEL: Record<ChannelDescriptor['latency'], string> = {
  'real-time': 'Real-time',
  minutes: 'Minutes',
  hours: 'Hours',
  'on-demand': 'On-demand',
};

function newAccountId(): string {
  return `acct_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export default function ConnectorsPage() {
  const db = getDb();
  const accounts = useLiveQuery(() => db.accounts.toArray(), []);

  return (
    <div className="space-y-5 pb-4">
      <header>
        <h1 className="text-lg font-semibold text-foreground">Connectors</h1>
        <p className="text-xs text-muted">
          Exactly what each channel can do today, stated honestly. Nothing here claims a bank connection that
          doesn&apos;t exist.
        </p>
      </header>

      <div className="space-y-3">
        {CHANNELS.map((c) => (
          <ChannelCard key={c.id} channel={c} />
        ))}
      </div>

      <CsvImportCard accounts={accounts ?? []} />
      <SmsPasteCard accounts={accounts ?? []} />

      <Disclaimer />
    </div>
  );
}

function ChannelCard({ channel }: { channel: ChannelDescriptor }) {
  const meta = STATUS_META[channel.status];
  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-foreground">{channel.label}</p>
          <p className="mt-1 text-xs text-muted">{channel.requirement}</p>
        </div>
        <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border px-2 py-0.5 text-xs ${meta.text}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} aria-hidden="true" />
          {meta.label}
        </span>
      </div>
      <div className="mt-2 flex items-center gap-3 text-[11px] text-muted">
        <span>Latency: {LATENCY_LABEL[channel.latency]}</span>
        <span>&middot;</span>
        <span>{meta.explain}</span>
      </div>
    </Card>
  );
}

function useDefaultAccount(accounts: Account[]) {
  return useMemo(() => accounts.find((a) => !a.archived) ?? null, [accounts]);
}

async function ensureImportAccount(accounts: Account[]): Promise<string> {
  const existing = accounts.find((a) => !a.archived);
  if (existing) return existing.id;
  const now = new Date().toISOString();
  const account: Account = {
    id: newAccountId(),
    name: 'Imported account',
    kind: 'savings',
    currency: 'INR',
    balance: ZERO,
    archived: false,
    createdAt: now,
    updatedAt: now,
  };
  await saveAccount(account);
  return account.id;
}

function CsvImportCard({ accounts }: { accounts: Account[] }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const overrides = useLiveQuery(() => listCategoryOverrides(), []);
  const categories = useLiveQuery(() => getDb().categories.toArray(), []);
  const defaultAccount = useDefaultAccount(accounts);

  async function handleFile(file: File) {
    setBusy(true);
    setStatus(null);
    try {
      const text = await file.text();
      const parsed = importCsv(text);
      if (parsed.length === 0) {
        setStatus('No recognisable transaction rows found in that file.');
        return;
      }
      const accountId = defaultAccount?.id ?? (await ensureImportAccount(accounts));
      const overrideMap = Object.fromEntries((overrides ?? []).map((o) => [o.merchant, o.categoryId]));
      const cats = categories && categories.length > 0 ? categories : BUILTIN_CATEGORIES;
      const result = await commitParsedTransactions({
        parsed,
        accountId,
        channel: 'csv',
        categories: cats,
        overrides: overrideMap,
      });
      setStatus(
        `Imported ${result.committed.length} transaction(s). ${result.needsReview.length} sent to the review queue (low parse confidence). ${result.duplicates} duplicate(s) skipped.`,
      );
    } catch {
      setStatus('Could not parse that file. Check it is a CSV export from your bank.');
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  return (
    <Card>
      <CardHeader title="Import a CSV statement" subtitle="Works with HDFC, ICICI, SBI, Axis, Kotak exports, and generic CSVs with date/narration/amount columns." />
      <input
        ref={fileRef}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleFile(file);
        }}
      />
      <Button variant="secondary" onClick={() => fileRef.current?.click()} disabled={busy}>
        {busy ? 'Importing...' : 'Choose CSV file'}
      </Button>
      {status ? <p className="mt-2 text-xs text-muted">{status}</p> : null}
    </Card>
  );
}

function SmsPasteCard({ accounts }: { accounts: Account[] }) {
  const [text, setText] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const overrides = useLiveQuery(() => listCategoryOverrides(), []);
  const categories = useLiveQuery(() => getDb().categories.toArray(), []);
  const defaultAccount = useDefaultAccount(accounts);

  async function handleParse() {
    if (!text.trim()) return;
    setBusy(true);
    setStatus(null);
    try {
      const { smsParser } = await import('@/lib/core/ingest');
      const now = new Date().toISOString();
      const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
      const accountId = defaultAccount?.id ?? (await ensureImportAccount(accounts));
      const overrideMap = Object.fromEntries((overrides ?? []).map((o) => [o.merchant, o.categoryId]));
      const cats = categories && categories.length > 0 ? categories : BUILTIN_CATEGORIES;

      let committed = 0;
      let review = 0;
      let skipped = 0;
      for (const line of lines) {
        const event = { id: `sms_${Date.now()}_${Math.random()}`, channel: 'sms' as const, receivedAt: now, payload: line };
        await saveRawEvent(event);
        const parsed = smsParser.parse(event);
        if (parsed.length === 0) {
          skipped += 1;
          continue;
        }
        const result = await commitParsedTransactions({
          parsed,
          accountId,
          channel: 'sms',
          categories: cats,
          overrides: overrideMap,
        });
        committed += result.committed.length;
        review += result.needsReview.length;
      }
      setStatus(`Parsed ${lines.length} line(s): ${committed} added, ${review} sent to review, ${skipped} not recognised as a transaction.`);
      setText('');
    } catch {
      setStatus('Could not parse that text.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader title="Paste a transaction SMS" subtitle="One message per line. Runs the same 40+ bank/card template parser the companion app would use." />
      <Field label="SMS text">
        <TextArea rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. Rs.499.00 debited from A/c XX1234 on 28-Sep-26 to SWIGGY via UPI Ref 123456789012" />
      </Field>
      <Button onClick={handleParse} disabled={busy || !text.trim()}>
        {busy ? 'Parsing...' : 'Parse & add'}
      </Button>
      {status ? <p className="mt-2 text-xs text-muted">{status}</p> : null}
    </Card>
  );
}
