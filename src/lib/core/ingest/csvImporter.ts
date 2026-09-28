/**
 * Generic CSV / bank-statement ChannelAdapter.
 *
 * A real CSV tokenizer (quoted fields with embedded commas, escaped `""` quotes,
 * CRLF and bare LF, a leading BOM) plus fuzzy header detection — bank statements
 * routinely have a few preamble rows (account name, statement period) before the
 * actual header row.
 */

import { negate, parseAmount } from '../domain/money';
import type { Paise } from '../domain/money';
import type { ChannelAdapter, ChannelDescriptor, ParsedTransaction, RawEvent } from '../domain/types';
import { extractAccountMask, parseDateFlexible } from './shared';

const descriptor: ChannelDescriptor = {
  id: 'csv',
  label: 'CSV / statement import',
  status: 'live',
  latency: 'on-demand',
  requirement: 'Export a statement (CSV) from net banking and upload it. No credentials needed.',
};

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

/** Parse RFC4180-ish CSV text into rows of cells. Handles quotes, "" escapes, CRLF, BOM. */
export function parseCsv(input: string): string[][] {
  let text = input;
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // strip BOM

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  const n = text.length;

  function endField() {
    row.push(field);
    field = '';
  }
  function endRow() {
    endField();
    rows.push(row);
    row = [];
  }

  while (i < n) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === ',') {
      endField();
      i += 1;
      continue;
    }
    if (ch === '\r') {
      // consume, real newline handled by \n or end of row on \r alone
      if (text[i + 1] === '\n') {
        i += 1;
        continue;
      }
      endRow();
      i += 1;
      continue;
    }
    if (ch === '\n') {
      endRow();
      i += 1;
      continue;
    }
    field += ch;
    i += 1;
  }
  // trailing field/row
  if (field.length > 0 || row.length > 0) endRow();

  // drop fully-empty trailing rows
  while (rows.length > 0 && rows[rows.length - 1]!.every((c) => c.trim() === '')) rows.pop();

  return rows;
}

// ---------------------------------------------------------------------------
// Header detection + column mapping
// ---------------------------------------------------------------------------

export type ColumnRole = 'date' | 'narration' | 'debit' | 'credit' | 'amount' | 'balance' | 'reference';

const KEYWORDS: Record<ColumnRole, RegExp[]> = {
  date: [/^(txn|transaction|value|posting)?\s*date$/i, /^date$/i],
  narration: [/narration/i, /description/i, /particulars/i, /transaction details/i, /remarks/i, /details/i],
  debit: [/^debit/i, /withdrawal/i, /\bdr\.?\s*(amt|amount)?$/i, /debit amt/i],
  credit: [/^credit/i, /deposit/i, /\bcr\.?\s*(amt|amount)?$/i, /credit amt/i],
  amount: [/^amount$/i, /txn amount/i, /transaction amount/i],
  balance: [/closing balance/i, /available balance/i, /^balance$/i, /\bbal\.?$/i],
  reference: [/reference/i, /ref\.?\s*no/i, /chq\.?\s*\/?\s*ref\s*no/i, /cheque no/i, /utr/i, /^ref$/i],
};

function matchRole(header: string): ColumnRole | undefined {
  const h = header.trim();
  for (const role of Object.keys(KEYWORDS) as ColumnRole[]) {
    if (KEYWORDS[role].some((re) => re.test(h))) return role;
  }
  return undefined;
}

export interface HeaderDetection {
  headerRowIndex: number;
  columns: Partial<Record<ColumnRole, number>>;
}

/** Scan the first `maxScan` rows for the row that looks most like a header row. */
export function detectHeader(rows: string[][], maxScan = 25): HeaderDetection | null {
  let best: HeaderDetection | null = null;
  let bestScore = 0;

  for (let r = 0; r < Math.min(maxScan, rows.length); r++) {
    const cells = rows[r];
    if (!cells) continue;
    const columns: Partial<Record<ColumnRole, number>> = {};
    let score = 0;
    cells.forEach((cell, idx) => {
      const role = matchRole(cell);
      if (role && columns[role] === undefined) {
        columns[role] = idx;
        score += 1;
      }
    });
    // Need at least a date column and one of (narration, amount, debit/credit)
    const hasShape =
      columns.date !== undefined &&
      (columns.narration !== undefined ||
        columns.amount !== undefined ||
        columns.debit !== undefined ||
        columns.credit !== undefined);
    if (hasShape && score > bestScore) {
      bestScore = score;
      best = { headerRowIndex: r, columns };
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Presets (per-bank header aliases). Auto-detection already covers these; the
// presets exist to document the known shapes and to let a caller pin one.
// ---------------------------------------------------------------------------

export interface CsvPreset {
  id: string;
  label: string;
  /** Extra header aliases beyond the generic keyword set, role -> literal header text (lowercase). */
  aliases: Partial<Record<ColumnRole, string[]>>;
}

export const HDFC_PRESET: CsvPreset = {
  id: 'hdfc',
  label: 'HDFC Bank',
  aliases: {
    date: ['date'],
    narration: ['narration'],
    debit: ['withdrawal amt.', 'debit amount'],
    credit: ['deposit amt.', 'credit amount'],
    balance: ['closing balance'],
    reference: ['chq./ref.no.', 'chq/ref no'],
  },
};

export const ICICI_PRESET: CsvPreset = {
  id: 'icici',
  label: 'ICICI Bank',
  aliases: {
    date: ['transaction date', 'value date'],
    narration: ['transaction remarks'],
    debit: ['withdrawal amount (inr)', 'debit amount'],
    credit: ['deposit amount (inr)', 'credit amount'],
    balance: ['balance (inr)'],
    reference: ['cheque number', 's no.'],
  },
};

export const SBI_PRESET: CsvPreset = {
  id: 'sbi',
  label: 'State Bank of India',
  aliases: {
    date: ['txn date'],
    narration: ['description'],
    debit: ['debit'],
    credit: ['credit'],
    balance: ['balance'],
    reference: ['ref no./cheque no.'],
  },
};

export const AXIS_PRESET: CsvPreset = {
  id: 'axis',
  label: 'Axis Bank',
  aliases: {
    date: ['tran date'],
    narration: ['particulars'],
    debit: ['debit'],
    credit: ['credit'],
    balance: ['balance'],
    reference: ['chq no'],
  },
};

export const KOTAK_PRESET: CsvPreset = {
  id: 'kotak',
  label: 'Kotak Mahindra Bank',
  aliases: {
    date: ['transaction date'],
    narration: ['description'],
    debit: ['withdrawal (dr)'],
    credit: ['deposit (cr)'],
    balance: ['balance'],
    reference: ['chq/ref no.'],
  },
};

export const GENERIC_PRESET: CsvPreset = { id: 'generic', label: 'Generic / unknown bank', aliases: {} };

export const CSV_PRESETS: CsvPreset[] = [HDFC_PRESET, ICICI_PRESET, SBI_PRESET, AXIS_PRESET, KOTAK_PRESET, GENERIC_PRESET];

// ---------------------------------------------------------------------------
// Row -> ParsedTransaction
// ---------------------------------------------------------------------------

function cellAmount(cell: string | undefined): Paise | null {
  if (!cell) return null;
  const trimmed = cell.trim();
  if (!trimmed || trimmed === '-' || /^0(\.0+)?$/.test(trimmed)) return null;
  return parseAmount(trimmed);
}

export function rowsToTransactions(rows: string[][], detection: HeaderDetection): ParsedTransaction[] {
  const { columns } = detection;
  const out: ParsedTransaction[] = [];

  for (let r = detection.headerRowIndex + 1; r < rows.length; r++) {
    const cells = rows[r];
    if (!cells || cells.every((c) => c.trim() === '')) continue;

    const dateCell = columns.date !== undefined ? cells[columns.date] : undefined;
    const narrationCell = columns.narration !== undefined ? cells[columns.narration] : undefined;
    const debitCell = columns.debit !== undefined ? cells[columns.debit] : undefined;
    const creditCell = columns.credit !== undefined ? cells[columns.credit] : undefined;
    const amountCell = columns.amount !== undefined ? cells[columns.amount] : undefined;
    const balanceCell = columns.balance !== undefined ? cells[columns.balance] : undefined;
    const referenceCell = columns.reference !== undefined ? cells[columns.reference] : undefined;

    let amount: Paise | null = null;
    let direction: 'debit' | 'credit' | null = null;

    const debitAmt = cellAmount(debitCell);
    const creditAmt = cellAmount(creditCell);
    if (debitAmt !== null) {
      amount = debitAmt;
      direction = 'debit';
    } else if (creditAmt !== null) {
      amount = creditAmt;
      direction = 'credit';
    } else if (amountCell !== undefined) {
      const signed = cellAmount(amountCell);
      if (signed !== null) {
        direction = signed < 0 ? 'debit' : 'credit';
        amount = signed < 0 ? negate(signed) : signed;
      }
    }

    if (amount === null || direction === null) continue; // no usable amount on this row

    const date = dateCell ? parseDateFlexible(dateCell) ?? undefined : undefined;
    const rawDescription = narrationCell?.trim() || cells.join(' ').trim();
    const balanceAfter = balanceCell ? cellAmount(balanceCell) ?? undefined : undefined;
    const reference = referenceCell?.trim() || undefined;
    const accountMask = rawDescription ? extractAccountMask(rawDescription) : undefined;

    out.push({
      amount,
      direction,
      date,
      merchant: undefined,
      rawDescription,
      method: 'unknown',
      reference,
      balanceAfter,
      accountMask,
      confidence: date ? 0.9 : 0.65,
    });
  }

  return out;
}

export function importCsv(text: string): ParsedTransaction[] {
  const rows = parseCsv(text);
  const detection = detectHeader(rows);
  if (!detection) return [];
  return rowsToTransactions(rows, detection);
}

export const csvImporter: ChannelAdapter = {
  descriptor,
  canParse(event: RawEvent): boolean {
    return event.channel === 'csv';
  },
  parse(event: RawEvent): ParsedTransaction[] {
    return importCsv(event.payload);
  },
};

export default csvImporter;
