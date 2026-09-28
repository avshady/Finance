'use client';

/**
 * Client half of the Web Share Target flow. Parsing is a pure, non-persisting
 * preview (`parseEvent` + `classify`, both from `src/lib/core`) so nothing is
 * written to the local Dexie DB until the user explicitly confirms — including a
 * low-confidence parse, which this screen never auto-saves. Only "Save" runs the
 * full pipeline (`ingestRawEvent`), which is also what applies a category the
 * user corrected here.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { BUILTIN_CATEGORIES } from '@/lib/core/db';
import { saveCategoryOverride, saveTransaction } from '@/lib/core/db';
import { classify } from '@/lib/core/categorize';
import { parseEvent } from '@/lib/core/ingest';
import { format } from '@/lib/core/domain/money';
import { ingestRawEvent, REVIEW_CONFIDENCE_THRESHOLD } from '@/lib/core/pipeline/ingest';
import type { ParsedTransaction, RawEvent, Transaction } from '@/lib/core/domain/types';

type Stage = 'idle' | 'preview' | 'saving' | 'saved' | 'discarded' | 'error';

interface ShareClientProps {
  initialText: string;
}

function genEventId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  return c?.randomUUID ? c.randomUUID() : `share_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

function categoryLabel(categoryId: string): string {
  return BUILTIN_CATEGORIES.find((c) => c.id === categoryId)?.name ?? categoryId;
}

export default function ShareClient({ initialText }: ShareClientProps) {
  const [text, setText] = useState(initialText);
  const [stage, setStage] = useState<Stage>('idle');
  const [parsedList, setParsedList] = useState<ParsedTransaction[]>([]);
  const [categoryChoices, setCategoryChoices] = useState<string[]>([]);
  const [error, setError] = useState<string | undefined>();
  const [savedCount, setSavedCount] = useState(0);

  const runPreview = useCallback((raw: string) => {
    setError(undefined);
    setStage('idle');
    if (!raw.trim()) {
      setParsedList([]);
      return;
    }
    const event: RawEvent = {
      id: 'preview',
      channel: 'share_target',
      receivedAt: new Date().toISOString(),
      payload: raw,
    };
    let parsed: ParsedTransaction[];
    try {
      parsed = parseEvent(event);
    } catch (err) {
      setError(`Could not parse this text: ${(err as Error).message}`);
      return;
    }
    if (parsed.length === 0) {
      setError('No transaction was recognised in this text. It may be an OTP, a promo, or a format this app does not yet handle.');
      setParsedList([]);
      return;
    }
    setParsedList(parsed);
    setCategoryChoices(
      parsed.map(
        (p) =>
          classify({
            merchant: p.merchant,
            rawDescription: p.rawDescription,
            direction: p.direction,
            method: p.method,
          }).categoryId,
      ),
    );
    setStage('preview');
  }, []);

  useEffect(() => {
    if (initialText) runPreview(initialText);
    // Only on mount — a share sheet delivers `initialText` once; further edits go
    // through the "Re-parse" button so we don't re-run on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleCategoryChange(index: number, categoryId: string) {
    setCategoryChoices((prev) => prev.map((c, i) => (i === index ? categoryId : c)));
  }

  async function handleConfirm() {
    setStage('saving');
    setError(undefined);
    try {
      const event: RawEvent = {
        id: genEventId(),
        channel: 'share_target',
        receivedAt: new Date().toISOString(),
        payload: text,
      };
      const outcome = await ingestRawEvent(event);

      if (outcome.errors.length > 0 && outcome.created.length === 0 && outcome.needsReview.length === 0) {
        setError(outcome.errors.map((e) => e.message).join('; '));
        setStage('error');
        return;
      }

      const savedTxns: Transaction[] = [...outcome.created, ...outcome.needsReview];
      for (let i = 0; i < savedTxns.length; i += 1) {
        const txn = savedTxns[i];
        const chosenCategory = categoryChoices[i];
        if (!txn) continue;

        // Clear the review flag now that the user has explicitly confirmed this
        // transaction — that confirmation is exactly what a low-confidence parse
        // was waiting on before counting toward analytics/advice.
        const needsUpdate = txn.excluded === true || (chosenCategory && chosenCategory !== txn.categoryId);
        if (!needsUpdate) continue;

        const updated: Transaction = {
          ...txn,
          categoryId: chosenCategory ?? txn.categoryId,
          categoryAuto: chosenCategory && chosenCategory !== txn.categoryId ? false : txn.categoryAuto,
          excluded: undefined,
          notes: chosenCategory && chosenCategory !== txn.categoryId ? undefined : txn.notes,
          updatedAt: new Date().toISOString(),
        };
        await saveTransaction(updated);
        if (chosenCategory && chosenCategory !== txn.categoryId && updated.merchant) {
          await saveCategoryOverride(updated.merchant, chosenCategory);
        }
      }

      setSavedCount(savedTxns.length);
      setStage('saved');
    } catch (err) {
      setError((err as Error).message);
      setStage('error');
    }
  }

  function handleDiscard() {
    setStage('discarded');
    setParsedList([]);
  }

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-6 px-4 py-8">
      <header>
        <h1 className="text-2xl font-semibold text-foreground">Share to WealthWise</h1>
        <p className="mt-1 text-sm text-muted">
          Share a bank SMS or notification from your phone&apos;s share sheet, or paste the text below. Nothing is
          saved until you confirm.
        </p>
      </header>

      <div className="flex flex-col gap-2">
        <label htmlFor="share-text" className="text-sm font-medium text-foreground">
          Shared text
        </label>
        <textarea
          id="share-text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={4}
          placeholder="e.g. HDFC Bank: Rs.450.00 debited from a/c XX1234 on 28-09-26 to SWIGGY. Avl Bal Rs.24,551.00"
          className="w-full rounded-md border border-border bg-surface p-3 text-sm text-foreground"
        />
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => runPreview(text)}
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-background"
          >
            Parse
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-negative/40 bg-negative/10 p-3 text-sm text-negative" role="alert">
          {error}
        </div>
      )}

      {stage === 'preview' && parsedList.length > 0 && (
        <div className="flex flex-col gap-4">
          {parsedList.map((p, i) => {
            const belowThreshold = p.confidence < REVIEW_CONFIDENCE_THRESHOLD;
            return (
              <div key={i} className="rounded-lg border border-border bg-surface p-4">
                <div className="flex items-baseline justify-between">
                  <span className="text-lg font-semibold text-foreground">{format(p.amount)}</span>
                  <span
                    className={
                      p.direction === 'credit' ? 'text-sm font-medium text-positive' : 'text-sm font-medium text-negative'
                    }
                  >
                    {p.direction === 'credit' ? 'Received' : 'Spent'}
                  </span>
                </div>
                <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm text-muted">
                  <dt>Merchant</dt>
                  <dd className="text-foreground">{p.merchant ?? '(unknown)'}</dd>
                  <dt>Institution</dt>
                  <dd className="text-foreground">{p.institution ?? '(unrecognised)'}</dd>
                  <dt>Confidence</dt>
                  <dd className={belowThreshold ? 'text-warning' : 'text-foreground'}>
                    {Math.round(p.confidence * 100)}%{belowThreshold ? ' — needs your confirmation' : ''}
                  </dd>
                </dl>
                <div className="mt-3 flex flex-col gap-1">
                  <label htmlFor={`category-${i}`} className="text-xs font-medium text-muted">
                    Category
                  </label>
                  <select
                    id={`category-${i}`}
                    value={categoryChoices[i] ?? ''}
                    onChange={(e) => handleCategoryChange(i, e.target.value)}
                    className="rounded-md border border-border bg-surface-raised p-2 text-sm text-foreground"
                  >
                    {BUILTIN_CATEGORIES.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  <span className="text-xs text-muted">
                    Auto-picked: {categoryLabel(classify({ merchant: p.merchant, rawDescription: p.rawDescription, direction: p.direction, method: p.method }).categoryId)}
                  </span>
                </div>
                <p className="mt-3 truncate text-xs text-muted" title={p.rawDescription}>
                  {p.rawDescription}
                </p>
              </div>
            );
          })}

          <div className="flex gap-3">
            <button
              type="button"
              onClick={handleConfirm}
              disabled={stage !== 'preview'}
              className="rounded-md bg-positive px-4 py-2 text-sm font-medium text-background disabled:opacity-50"
            >
              Confirm &amp; save
            </button>
            <button
              type="button"
              onClick={handleDiscard}
              className="rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground"
            >
              Discard
            </button>
          </div>
        </div>
      )}

      {stage === 'saving' && <p className="text-sm text-muted">Saving…</p>}

      {stage === 'saved' && (
        <div className="rounded-lg border border-positive/40 bg-positive/10 p-4">
          <p className="text-sm text-foreground">
            Saved {savedCount} transaction{savedCount === 1 ? '' : 's'} to your local ledger.
          </p>
          <Link href="/transactions" className="mt-2 inline-block text-sm font-medium text-accent underline">
            View in Transactions →
          </Link>
        </div>
      )}

      {stage === 'discarded' && <p className="text-sm text-muted">Discarded — nothing was saved.</p>}
    </div>
  );
}
