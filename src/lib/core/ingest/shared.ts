/**
 * Shared extraction helpers for SMS/email parsing (and reused by the CSV importer
 * where relevant). Pure functions only — no I/O.
 */

import { parseAmount } from '../domain/money';
import type { Paise } from '../domain/money';
import type { IsoDate, PaymentMethod, TxnDirection } from '../domain/types';

// ---------------------------------------------------------------------------
// Non-financial filtering
// ---------------------------------------------------------------------------

const TXN_VERB_RE =
  /\b(debited|debit(?:ed)?|credited|credit(?:ed)?|spent|paid|withdrawn|withdrawal|deposited|deposit|received|refunded|refund|used\s+for|purchase(?:d)?|txn\s+of|trf|transferred|sent)\b/i;

const OTP_RE = /\b(otp|one[\s-]?time[\s-]?password)\b/i;
const OTP_CONTEXT_RE = /(is your otp|otp is|do not share|valid for \d+ min|use otp|verification code)/i;

const PROMO_RE =
  /(cashback\s*upto|% ?off|\bsale\b|win\s+exciting|pre[\s-]?approved|congratulations you|lucky draw|limited period offer|shop now|download the app|apply now|click here|t&c apply|use code\b|exclusive offer|flat \d+% |offer valid|get upto)/i;

const MIN_DUE_RE = /\bminimum\s*(?:amount\s*)?due\b/i;
const CREDIT_LIMIT_MARKETING_RE = /\b(credit limit (?:has been )?(?:increased|enhanced|upgraded)|pre[\s-]?qualified|instant loan of up to|get a loan up to)\b/i;
const CHEQUE_BOUNCE_RE = /\bcheque\b.*\b(bounce|return|dishonour|dishonor)/i;
const BALANCE_ENQUIRY_ONLY_RE = /\b(available|avl)\.?\s*bal(?:ance)?\b[\s\S]{0,40}?\bis\b/i;

/**
 * True when the message carries no actual transaction — OTPs, promos, balance
 * enquiries, minimum-due reminders, credit-limit marketing, bare bounce notices.
 */
export function isNonFinancialMessage(text: string): boolean {
  const hasTxnVerb = TXN_VERB_RE.test(text);

  if (OTP_RE.test(text) && (OTP_CONTEXT_RE.test(text) || !hasTxnVerb)) return true;
  if (PROMO_RE.test(text) && !hasTxnVerb) return true;
  if (MIN_DUE_RE.test(text) && !hasTxnVerb) return true;
  if (CREDIT_LIMIT_MARKETING_RE.test(text)) return true;
  if (CHEQUE_BOUNCE_RE.test(text) && !/\bfor\s+(?:rs\.?|inr)/i.test(text)) return true;
  if (BALANCE_ENQUIRY_ONLY_RE.test(text) && !hasTxnVerb) return true;

  return false;
}

// ---------------------------------------------------------------------------
// Amount + balance extraction
// ---------------------------------------------------------------------------

const AMOUNT_TOKEN_RE = /(?:rs\.?\s*|inr\s*|₹\s*)([\d][\d,]*(?:\.\d+)?)/gi;
const BALANCE_CLAUSE_RE =
  /\b(?:avl\.?\s*bal(?:ance)?|available\s*bal(?:ance)?|bal(?:ance)?)\.?:?\s*(?:is)?\s*(?:rs\.?|inr|₹)?\s*[\d][\d,]*(?:\.\d+)?/gi;

export interface AmountExtraction {
  amount: Paise | null;
  balanceAfter: Paise | null;
  /** The input text with the balance clause stripped out, for downstream amount search. */
  textWithoutBalance: string;
}

export function extractAmounts(text: string): AmountExtraction {
  let balanceAfter: Paise | null = null;
  let textWithoutBalance = text;

  const balanceMatch = BALANCE_CLAUSE_RE.exec(text);
  BALANCE_CLAUSE_RE.lastIndex = 0;
  if (balanceMatch) {
    const numMatch = /[\d][\d,]*(?:\.\d+)?/.exec(balanceMatch[0]);
    if (numMatch) balanceAfter = parseAmount(numMatch[0]);
    textWithoutBalance = text.slice(0, balanceMatch.index) + text.slice(balanceMatch.index + balanceMatch[0].length);
  }

  AMOUNT_TOKEN_RE.lastIndex = 0;
  const first = AMOUNT_TOKEN_RE.exec(textWithoutBalance);
  const amount = first ? parseAmount(first[0]) : null;

  return { amount, balanceAfter, textWithoutBalance };
}

// ---------------------------------------------------------------------------
// Direction
// ---------------------------------------------------------------------------

const DEBIT_RE =
  /\b(debited|debit of|spent|paid|withdrawn|withdrawal of|used\s+for|purchase(?:d)?\s+of|trf\s+to|transferred\s+to|sent\s+to|debited by)\b/i;
const CREDIT_RE = /\b(credited|credit of|received|deposited|refund(?:ed)?|cashback(?:\s+of)?|salary\s+credit)\b/i;

/** Returns the detected direction and whether it was a confident keyword match. */
export function detectDirection(text: string): { direction: TxnDirection; confident: boolean } {
  const debit = DEBIT_RE.test(text);
  const credit = CREDIT_RE.test(text);
  if (debit && !credit) return { direction: 'debit', confident: true };
  if (credit && !debit) return { direction: 'credit', confident: true };
  if (debit && credit) {
    // Ambiguous message mentioning both verbs (e.g. "credited back after debit reversed").
    // Fall back to whichever verb appears first.
    const dIdx = text.search(DEBIT_RE);
    const cIdx = text.search(CREDIT_RE);
    return { direction: dIdx <= cIdx ? 'debit' : 'credit', confident: false };
  }
  // No keyword found at all — guess debit (most alerts are spends), low confidence.
  return { direction: 'debit', confident: false };
}

// ---------------------------------------------------------------------------
// Payment method
// ---------------------------------------------------------------------------

export function detectMethod(text: string): PaymentMethod {
  if (/credit card/i.test(text)) return 'card_credit';
  if (/debit card/i.test(text)) return 'card_debit';
  if (/\bupi\b/i.test(text)) return 'upi';
  if (/\bneft\b/i.test(text)) return 'neft';
  if (/\brtgs\b/i.test(text)) return 'rtgs';
  if (/\bimps\b/i.test(text)) return 'imps';
  if (/net\s*banking/i.test(text)) return 'netbanking';
  if (/\b(emi|mandate|sip|ecs|nach)\b/i.test(text)) return 'ach_mandate';
  if (/\bwallet\b/i.test(text)) return 'wallet';
  if (/\bcheque|chq\b/i.test(text)) return 'cheque';
  if (/\bcard\b/i.test(text)) return 'card_debit';
  if (/\bcash\b/i.test(text)) return 'cash';
  return 'unknown';
}

// ---------------------------------------------------------------------------
// Reference / UTR / RRN
// ---------------------------------------------------------------------------

const REFERENCE_RE =
  /\b(?:ref(?:erence)?\.?\s*no\.?|ref(?:erence)?\.?|refno|rrn|utr(?:\s*no\.?)?|txn\s*id)\s*[:.\-]?\s*([a-zA-Z0-9]{4,})/i;

export function extractReference(text: string): string | undefined {
  const m = REFERENCE_RE.exec(text);
  return m ? m[1] : undefined;
}

// ---------------------------------------------------------------------------
// Account mask (last 4 only)
// ---------------------------------------------------------------------------

const MASK_RE = /\b(?:a\/?c|acc(?:ount)?|card)\.?\s*(?:no\.?)?\s*[*xX]{2,}\s*(\d{4})\b/i;
const XX_RE = /\b[*xX]{2,}(\d{4})\b/;
const ENDING_RE = /\bending\s+(?:with\s+)?(\d{4})\b/i;

export function extractAccountMask(text: string): string | undefined {
  const m = MASK_RE.exec(text) || XX_RE.exec(text) || ENDING_RE.exec(text);
  return m ? m[1] : undefined;
}

// ---------------------------------------------------------------------------
// Institution detection
// ---------------------------------------------------------------------------

export const INSTITUTION_KEYWORDS: Array<{ code: string; re: RegExp }> = [
  { code: 'HDFC', re: /\bhdfc\b/i },
  { code: 'ICICI', re: /\bicici\b/i },
  { code: 'SBI', re: /\b(sbi|state bank of india)\b/i },
  { code: 'AXIS', re: /\baxis\b/i },
  { code: 'KOTAK', re: /\bkotak\b/i },
  { code: 'IDFC_FIRST', re: /\bidfc\s*first\b|\bidfc\b/i },
  { code: 'YES_BANK', re: /\byes\s*bank\b/i },
  { code: 'INDUSIND', re: /\bindusind\b/i },
  { code: 'PNB', re: /\b(pnb|punjab national bank)\b/i },
  { code: 'BOB', re: /\b(bob|bank of baroda)\b/i },
  { code: 'CANARA', re: /\bcanara\b/i },
  { code: 'UNION_BANK', re: /\bunion\s*bank\b/i },
  { code: 'FEDERAL', re: /\bfederal\s*bank\b/i },
  { code: 'RBL', re: /\brbl\b/i },
  { code: 'AU_SFB', re: /\bau\s*(small\s*finance|bank)\b/i },
  { code: 'PAYTM_BANK', re: /\bpaytm\s*payments?\s*bank\b/i },
  { code: 'AIRTEL_BANK', re: /\bairtel\s*payments?\s*bank\b/i },
  { code: 'AMEX', re: /\b(amex|american express)\b/i },
  { code: 'SBI_CARD', re: /\bsbi\s*card\b/i },
  { code: 'CRED', re: /\bcred\b/i },
  { code: 'GPAY', re: /\bg[- ]?pay|google pay\b/i },
  { code: 'PHONEPE', re: /\bphonepe\b/i },
  { code: 'PAYTM', re: /\bpaytm\b/i },
  { code: 'AMAZON_PAY', re: /\bamazon\s*pay\b/i },
];

export function detectInstitution(text: string, sender?: string): string | undefined {
  const hay = `${sender ?? ''} ${text}`;
  for (const { code, re } of INSTITUTION_KEYWORDS) {
    if (re.test(hay)) return code;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Date parsing
// ---------------------------------------------------------------------------

const MONTHS: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', sept: '09', oct: '10', nov: '11', dec: '12',
};

function pad(n: string | number): string {
  return String(n).padStart(2, '0');
}

function fullYear(yy: string): string {
  if (yy.length === 4) return yy;
  const n = Number(yy);
  return n <= 68 ? `20${pad(yy)}` : `19${pad(yy)}`;
}

/**
 * Parse dd-mm-yy, dd/mm/yyyy, ddMONyy, dd-Mon-yy, yyyy-mm-dd into an IsoDate.
 */
export function parseDateFlexible(text: string): IsoDate | undefined {
  // yyyy-mm-dd
  let m = /\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/.exec(text);
  if (m) return `${m[1]}-${pad(m[2]!)}-${pad(m[3]!)}`;

  // dd-Mon-yy or dd Mon yy (month name)
  m = /\b(\d{1,2})[-\s]?([A-Za-z]{3,4})[-\s]?(\d{2,4})\b/.exec(text);
  if (m) {
    const monthWord = m[2]!.toLowerCase();
    const mon = MONTHS[monthWord.slice(0, 4)] ?? MONTHS[monthWord.slice(0, 3)];
    if (mon) return `${fullYear(m[3]!)}-${mon}-${pad(m[1]!)}`;
  }

  // dd-mm-yy or dd-mm-yyyy or dd/mm/yy or dd/mm/yyyy
  m = /\b(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})\b/.exec(text);
  if (m) {
    const day = Number(m[1]!);
    const month = Number(m[2]!);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${fullYear(m[3]!)}-${pad(m[2]!)}-${pad(m[1]!)}`;
    }
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// Merchant extraction (SMS/email specific patterns live in the callers; this is
// the generic cleanup shared by both).
// ---------------------------------------------------------------------------

/** Strip common trailing noise (ref numbers, "Not you? Call...") from a merchant capture. */
export function cleanMerchantCapture(raw: string): string {
  return raw
    .replace(/\bnot you\??.*$/i, '')
    .replace(/\bref(?:erence)?\.?\s*no\.?.*$/i, '')
    .replace(/\bavl\.?\s*bal.*$/i, '')
    .replace(/[.,;:]+$/, '')
    .trim();
}
