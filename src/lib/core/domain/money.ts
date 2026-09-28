/**
 * Money is a branded integer count of the minor unit (paise for INR).
 *
 * Floats are banned in the domain layer. `0.1 + 0.2 !== 0.3` is a cosmetic bug in a
 * budgeting screen and a compounding error in a 240-month amortization schedule.
 */

export type Paise = number & { readonly __brand: 'Paise' };

/** Construct Paise from an already-integer minor-unit value. */
export function paise(n: number): Paise {
  if (!Number.isFinite(n)) throw new RangeError(`paise: not finite: ${n}`);
  if (!Number.isInteger(n)) throw new RangeError(`paise: not an integer: ${n}`);
  if (!Number.isSafeInteger(n)) throw new RangeError(`paise: exceeds safe integer: ${n}`);
  return n as Paise;
}

export const ZERO = paise(0);

/** Construct Paise from a major unit (rupees). Rounds half-away-from-zero. */
export function fromRupees(rupees: number): Paise {
  if (!Number.isFinite(rupees)) throw new RangeError(`fromRupees: not finite: ${rupees}`);
  return paise(roundHalfAwayFromZero(rupees * 100));
}

/**
 * Parse a human/bank-formatted amount into Paise.
 * Handles: "1,23,456.78" (Indian grouping), "₹1234", "1 234,56" (EU), "(500)" (negative),
 * "1.2L" / "1.5 lakh" / "2Cr" / "3 crore" / "45K".
 * Returns null when the string contains no parseable amount.
 */
export function parseAmount(input: string): Paise | null {
  if (typeof input !== 'string') return null;
  let s = input.trim();
  if (!s) return null;

  let negative = false;
  // Accounting-style negatives: (1,234.00)
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }

  // Strip currency symbols, codes, and spacing. Keep digits, separators and sign.
  s = s
    .replace(/[₹$€£¥]/g, '')
    .replace(/\b(?:INR|USD|EUR|GBP|Rs\.?|rupees?)\b/gi, '')
    .trim();

  if (s.startsWith('-')) {
    negative = !negative;
    s = s.slice(1).trim();
  } else if (s.startsWith('+')) {
    s = s.slice(1).trim();
  }

  // Indian/English magnitude suffixes.
  const suffix = /^([\d.,\s]+?)\s*(k|lakhs?|lacs?|l|crores?|crs?|cr|m|mn)\b/i.exec(s);
  let multiplier = 1;
  if (suffix) {
    const unit = suffix[2].toLowerCase();
    if (unit === 'k') multiplier = 1_000;
    else if (unit === 'l' || unit.startsWith('lakh') || unit.startsWith('lac')) multiplier = 100_000;
    else if (unit === 'm' || unit === 'mn') multiplier = 1_000_000;
    else multiplier = 10_000_000; // crore
    s = suffix[1].trim();
  }

  const normalized = normalizeSeparators(s);
  if (normalized === null) return null;

  const value = Number(normalized);
  if (!Number.isFinite(value)) return null;

  const minor = roundHalfAwayFromZero(value * multiplier * 100);
  if (!Number.isSafeInteger(minor)) return null;
  return paise(negative ? -minor : minor);
}

/**
 * Resolve `,` / `.` / space grouping into a plain decimal string.
 * The last separator that is followed by exactly 1-2 digits is the decimal point;
 * 3 trailing digits is grouping ("1,234" is one thousand two hundred thirty four).
 */
function normalizeSeparators(s: string): string | null {
  const cleaned = s.replace(/\s/g, '');
  if (!/^[\d.,]+$/.test(cleaned)) return null;
  if (!/\d/.test(cleaned)) return null;

  const lastComma = cleaned.lastIndexOf(',');
  const lastDot = cleaned.lastIndexOf('.');
  const lastSep = Math.max(lastComma, lastDot);

  if (lastSep === -1) return cleaned;

  const tail = cleaned.slice(lastSep + 1);
  // Grouping separator, not a decimal point: strip all separators.
  if (tail.length === 3 || tail.length === 0 || !/^\d+$/.test(tail)) {
    return cleaned.replace(/[.,]/g, '');
  }
  const head = cleaned.slice(0, lastSep).replace(/[.,]/g, '');
  return `${head || '0'}.${tail}`;
}

/** Banker-free rounding: 0.5 always rounds away from zero, matching bank statements. */
function roundHalfAwayFromZero(n: number): number {
  return n < 0 ? -Math.round(-n) : Math.round(n);
}

// ---------------------------------------------------------------------------
// Arithmetic. Every operation stays in integer space.
// ---------------------------------------------------------------------------

export function add(...values: Paise[]): Paise {
  return paise(values.reduce<number>((a, b) => a + b, 0));
}

export function subtract(a: Paise, b: Paise): Paise {
  return paise(a - b);
}

export function negate(a: Paise): Paise {
  return paise(-a);
}

export function abs(a: Paise): Paise {
  return paise(Math.abs(a));
}

/** Multiply by a real scalar (a rate, a count, a share). Rounds to the paise. */
export function scale(a: Paise, factor: number): Paise {
  if (!Number.isFinite(factor)) throw new RangeError(`scale: not finite: ${factor}`);
  return paise(roundHalfAwayFromZero(a * factor));
}

/** Ratio of two money values as a plain number. Returns null when the denominator is 0. */
export function ratio(a: Paise, b: Paise): number | null {
  if (b === 0) return null;
  return a / b;
}

export function sum(values: readonly Paise[]): Paise {
  return paise(values.reduce<number>((acc, v) => acc + v, 0));
}

export function max(...values: Paise[]): Paise {
  return paise(Math.max(...values));
}

export function min(...values: Paise[]): Paise {
  return paise(Math.min(...values));
}

/** Arithmetic mean, rounded to the paise. Empty input is zero. */
export function mean(values: readonly Paise[]): Paise {
  if (values.length === 0) return ZERO;
  return scale(sum(values), 1 / values.length);
}

/** Median. Robust to the one-off ₹2L purchase that would drag a mean around. */
export function median(values: readonly Paise[]): Paise {
  if (values.length === 0) return ZERO;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  if (sorted.length % 2 === 1) return sorted[mid];
  return scale(add(sorted[mid - 1], sorted[mid]), 0.5);
}

/**
 * Split a value into n parts that sum back exactly to the original.
 * Remainder paise are distributed to the earliest parts, so nothing vanishes.
 */
export function allocate(total: Paise, parts: number): Paise[] {
  if (!Number.isInteger(parts) || parts <= 0) throw new RangeError(`allocate: bad parts: ${parts}`);
  const sign = total < 0 ? -1 : 1;
  const magnitude = Math.abs(total);
  const base = Math.floor(magnitude / parts);
  let remainder = magnitude - base * parts;
  return Array.from({ length: parts }, () => {
    const extra = remainder > 0 ? 1 : 0;
    if (remainder > 0) remainder -= 1;
    return paise(sign * (base + extra));
  });
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

export function toRupees(a: Paise): number {
  return a / 100;
}

/** Full precision, Indian grouping: "₹1,23,456.78" */
export function format(a: Paise, currency = 'INR', locale = 'en-IN'): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(toRupees(a));
}

/** Rounded to whole units for dashboards: "₹1,23,457" */
export function formatShort(a: Paise, currency = 'INR', locale = 'en-IN'): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(toRupees(a));
}

/**
 * Compact Indian notation for headline figures: "₹1.2L", "₹3.4Cr".
 * Large numbers in a projection are unreadable in full; this is for those.
 */
export function formatCompactINR(a: Paise): string {
  const rupees = toRupees(a);
  const sign = rupees < 0 ? '-' : '';
  const v = Math.abs(rupees);
  if (v >= 1_00_00_000) return `${sign}₹${trim(v / 1_00_00_000)}Cr`;
  if (v >= 1_00_000) return `${sign}₹${trim(v / 1_00_000)}L`;
  if (v >= 1_000) return `${sign}₹${trim(v / 1_000)}K`;
  return `${sign}₹${Math.round(v)}`;
}

function trim(n: number): string {
  return n.toFixed(n < 10 ? 2 : 1).replace(/\.?0+$/, '');
}
