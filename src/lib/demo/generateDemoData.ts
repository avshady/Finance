/**
 * Synthetic but realistic 14-month Indian household financial history, so the app
 * can be evaluated end to end with zero connectors configured (ARCHITECTURE §2/§3:
 * the app must be fully usable, and demonstrably good, before a single real
 * credential exists).
 *
 * This is not random noise — it is built to make every stage-3 "leak" doctrine in
 * `src/lib/core/advisor/rules/leaks.ts` demonstrably fire:
 *   - a raise at month 8 (with a March bonus) that the lifestyle-inflation rule
 *     should catch because discretionary spend rises right along with it;
 *   - one dormant subscription (Spotify, stopped 5+ months ago) so the
 *     dormant-subscriptions rule has a true positive;
 *   - late fees, ATM fees and card interest scattered through the year for the
 *     fees-and-penalties rule;
 *   - a one-month electronics spike for the category-spike rule.
 *
 * All money is `Paise` via `../core/domain/money` helpers — never a raw float.
 */

import { addMonths as addCalendarMonths, format as formatDate, startOfMonth } from 'date-fns';
import { add, fromRupees, scale, type Paise, ZERO } from '../core/domain/money';
import { buildSchedule, computeEmi } from '../core/emi/amortization';
import { BUILTIN_CATEGORIES } from '../core/db/seed';
import type {
  Account,
  AccountKind,
  Budget,
  ChannelId,
  Goal,
  IsoDate,
  Loan,
  RecurringItem,
  Transaction,
  TxnDirection,
  TxnKind,
  UserProfile,
} from '../core/domain/types';

const HISTORY_MONTHS = 14;
const CHANNEL: ChannelId = 'csv'; // demo history stands in for a bulk statement backfill

// ---------------------------------------------------------------------------
// Deterministic PRNG — realistic variance without flaky, unreproducible amounts.
// ---------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Jitter a rupee amount by +/- `pct` (e.g. 0.12 = up to 12%), keeping it a realistic non-round figure. */
function jitter(rng: () => number, base: number, pct: number): number {
  const delta = base * pct * (rng() * 2 - 1);
  return Math.round(base + delta);
}

// ---------------------------------------------------------------------------
// Category id existence check — every id below must exist in BUILTIN_CATEGORIES.
// ---------------------------------------------------------------------------

const KNOWN_CATEGORY_IDS = new Set(BUILTIN_CATEGORIES.map((c) => c.id));

function cid(id: string): string {
  if (!KNOWN_CATEGORY_IDS.has(id)) {
    throw new Error(`generateDemoData: categoryId "${id}" does not exist in BUILTIN_CATEGORIES`);
  }
  return id;
}

const CAT = {
  rent: cid('cat.housing.rent'),
  maintenance: cid('cat.housing.maintenance'),
  groceries: cid('cat.food.groceries'),
  restaurants: cid('cat.food.restaurants'),
  foodDelivery: cid('cat.food.food_delivery'),
  fuel: cid('cat.transport.fuel'),
  cabAuto: cid('cat.transport.cab_auto'),
  electricity: cid('cat.utilities.electricity'),
  water: cid('cat.utilities.water'),
  gas: cid('cat.utilities.gas'),
  internet: cid('cat.utilities.internet'),
  mobile: cid('cat.utilities.mobile'),
  lifeInsurance: cid('cat.insurance.life'),
  healthInsurance: cid('cat.insurance.health'),
  vehicleInsurance: cid('cat.insurance.vehicle'),
  homeLoanEmi: cid('cat.debt.home_loan_emi'),
  autoLoanEmi: cid('cat.debt.auto_loan_emi'),
  otherEmi: cid('cat.debt.other_emi'),
  creditCardPayment: cid('cat.debt.credit_card_payment'),
  sip: cid('cat.investment.sip_mutual_fund'),
  ppfEpf: cid('cat.investment.ppf_epf'),
  salary: cid('cat.income.salary'),
  interestIncome: cid('cat.income.interest'),
  streaming: cid('cat.entertainment.streaming'),
  shoppingGeneral: cid('cat.shopping.general'),
  shoppingElectronics: cid('cat.shopping.electronics'),
  lateFee: cid('cat.fees.late_penalty'),
  atmFee: cid('cat.fees.atm'),
  interestCharged: cid('cat.fees.interest_charged'),
  bankCharges: cid('cat.fees.bank_charges'),
} as const;

// ---------------------------------------------------------------------------
// Month scaffolding — 14 months ending on the current calendar month.
// ---------------------------------------------------------------------------

interface DemoMonth {
  index: number; // 0..13, oldest first
  date: Date; // first of the month
  key: string; // "2026-09"
  /** True from the raise month onward (index 7, i.e. month 8 of 14). */
  raised: boolean;
  isBonusMonth: boolean;
  isCurrent: boolean;
}

const RAISE_INDEX = 7; // "a raise at month 8"
const BONUS_INDEX = 7; // "a bonus in March" — placed in the same month as the raise, by design

function buildMonths(asOf: Date): DemoMonth[] {
  const anchor = startOfMonth(asOf);
  return Array.from({ length: HISTORY_MONTHS }, (_, i) => {
    const offset = i - (HISTORY_MONTHS - 1);
    const date = addCalendarMonths(anchor, offset);
    return {
      index: i,
      date,
      key: formatDate(date, 'yyyy-MM'),
      raised: i >= RAISE_INDEX,
      isBonusMonth: i === BONUS_INDEX,
      isCurrent: i === HISTORY_MONTHS - 1,
    };
  });
}

function isoDate(date: Date, day: number): IsoDate {
  const clamped = Math.min(day, 28); // stay inside every month, no Feb-30 nonsense
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), clamped));
  const iso = d.toISOString();
  return iso.slice(0, 10);
}

// ---------------------------------------------------------------------------
// Transaction builder
// ---------------------------------------------------------------------------

let txnCounter = 0;
function nextTxnId(): string {
  txnCounter += 1;
  return `demo-txn-${txnCounter}`;
}

interface MkTxnInput {
  accountId: string;
  amount: Paise;
  direction: TxnDirection;
  date: IsoDate;
  rawDescription: string;
  merchant?: string;
  categoryId: string;
  kind: TxnKind;
  method: Transaction['method'];
  reference?: string;
  balanceAfter?: Paise;
  excluded?: boolean;
  notes?: string;
  loanId?: string;
}

function mkTxn(input: MkTxnInput): Transaction {
  const observedAt = `${input.date}T${String(9 + (txnCounter % 10)).padStart(2, '0')}:15:00.000Z`;
  return {
    id: nextTxnId(),
    accountId: input.accountId,
    amount: input.amount,
    direction: input.direction,
    currency: 'INR',
    date: input.date,
    observedAt,
    rawDescription: input.rawDescription,
    merchant: input.merchant,
    categoryId: input.categoryId,
    categoryAuto: true,
    kind: input.kind,
    method: input.method,
    reference: input.reference,
    balanceAfter: input.balanceAfter,
    channel: CHANNEL,
    excluded: input.excluded,
    notes: input.notes,
    loanId: input.loanId,
    createdAt: observedAt,
    updatedAt: observedAt,
  };
}

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

let accountCounter = 0;
function nextAccountId(): string {
  accountCounter += 1;
  return `demo-acc-${accountCounter}`;
}

function mkAccount(overrides: Partial<Account> & { kind: AccountKind; name: string }): Account {
  const now = new Date().toISOString();
  return {
    id: nextAccountId(),
    currency: 'INR',
    balance: ZERO,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Loans
// ---------------------------------------------------------------------------

let loanCounter = 0;
function nextLoanId(): string {
  loanCounter += 1;
  return `demo-loan-${loanCounter}`;
}

// ---------------------------------------------------------------------------
// The full bundle
// ---------------------------------------------------------------------------

export interface DemoDataBundle {
  profile: UserProfile;
  accounts: Account[];
  transactions: Transaction[];
  loans: Loan[];
  budgets: Budget[];
  goals: Goal[];
  recurring: RecurringItem[];
  categories: typeof BUILTIN_CATEGORIES;
  asOf: string;
}

export interface GenerateDemoDataOptions {
  /** Defaults to "now" — the history always ends on the current calendar month. */
  asOf?: Date;
  /** Deterministic PRNG seed, for reproducible-but-varied amounts. */
  seed?: number;
}

export function generateDemoData(options: GenerateDemoDataOptions = {}): DemoDataBundle {
  txnCounter = 0;
  accountCounter = 0;
  loanCounter = 0;

  const asOfDate = options.asOf ?? new Date();
  const rng = mulberry32(options.seed ?? 0x5eed_1234);
  const months = buildMonths(asOfDate);

  // -- Accounts --------------------------------------------------------------
  const salaryAccount = mkAccount({
    kind: 'savings',
    name: 'HDFC Bank Salary Account',
    institution: 'HDFC',
    mask: '4521',
    sourceChannel: CHANNEL,
  });
  const creditCard = mkAccount({
    kind: 'credit_card',
    name: 'ICICI Amazon Pay Credit Card',
    institution: 'ICICI',
    mask: '9087',
    creditLimit: fromRupees(3_00_000),
    statementDay: 5,
    paymentDueDay: 25,
    sourceChannel: CHANNEL,
  });
  const wallet = mkAccount({
    kind: 'wallet',
    name: 'PhonePe Wallet',
    institution: 'PHONEPE',
    sourceChannel: CHANNEL,
  });
  const mfFolio = mkAccount({
    kind: 'mutual_fund',
    name: 'Zerodha Coin — Mutual Fund Folio',
    institution: 'ZERODHA',
    sourceChannel: CHANNEL,
  });
  const epfAccount = mkAccount({
    kind: 'epf',
    name: 'EPF Account',
    institution: 'EPFO',
    sourceChannel: CHANNEL,
  });

  const accounts: Account[] = [salaryAccount, creditCard, wallet, mfFolio, epfAccount];

  // -- Loans -------------------------------------------------------------
  // Home loan: ~₹45L at 8.6%, 20-year tenure, taken 3 years before the demo
  // window starts, with one genuine part-payment during the window (§24(b) benefit).
  const homeLoanStart = addCalendarMonths(startOfMonth(asOfDate), -(HISTORY_MONTHS - 1) - 36);
  const homeLoanPrincipal = fromRupees(45_00_000);
  const homeLoanTenure = 240;
  const homeLoanRate = 0.086;
  const homeLoanEmi = computeEmi(homeLoanPrincipal, homeLoanRate, homeLoanTenure);
  // Part-payment of ₹5L applied at instalment 18 (well before this window), so the
  // schedule below reflects a genuinely part-paid loan, not just a young one.
  const homeLoanSchedule = buildSchedule({
    principal: homeLoanPrincipal,
    annualRate: homeLoanRate,
    tenureMonths: homeLoanTenure,
    startDate: formatDate(homeLoanStart, 'yyyy-MM-dd'),
    lumpSums: [{ month: 18, amount: fromRupees(5_00_000) }],
  });
  const homeLoanPaidInstalments = 36 + (HISTORY_MONTHS - 1); // 3 years pre-window + the window itself
  const homeLoanRow = homeLoanSchedule.rows[Math.min(homeLoanPaidInstalments, homeLoanSchedule.rows.length) - 1];
  const homeLoan: Loan = {
    id: nextLoanId(),
    name: 'Home Loan — HDFC',
    kind: 'home',
    lender: 'HDFC Ltd.',
    principal: homeLoanPrincipal,
    outstanding: homeLoanRow?.balance ?? scale(homeLoanPrincipal, 0.75),
    annualRate: homeLoanRate,
    rateType: 'floating',
    tenureMonths: homeLoanTenure,
    paidInstalments: homeLoanPaidInstalments,
    emiAmount: homeLoanEmi,
    emiDay: 5,
    startDate: formatDate(homeLoanStart, 'yyyy-MM-dd'),
    debitAccountId: salaryAccount.id,
    taxBenefit: { section: '24b', annualCap: fromRupees(2_00_000) },
    prepaymentPenaltyRate: 0,
    prepayments: [{ date: formatDate(addCalendarMonths(homeLoanStart, 17), 'yyyy-MM-dd'), amount: fromRupees(5_00_000) }],
    createdAt: `${formatDate(homeLoanStart, 'yyyy-MM-dd')}T00:00:00.000Z`,
    updatedAt: new Date().toISOString(),
  };

  // Car loan: ~₹8L at 9.5%, 5-year tenure, taken 1 year before the window.
  const carLoanStart = addCalendarMonths(startOfMonth(asOfDate), -(HISTORY_MONTHS - 1) - 12);
  const carLoanPrincipal = fromRupees(8_00_000);
  const carLoanTenure = 60;
  const carLoanRate = 0.095;
  const carLoanSchedule = buildSchedule({
    principal: carLoanPrincipal,
    annualRate: carLoanRate,
    tenureMonths: carLoanTenure,
    startDate: formatDate(carLoanStart, 'yyyy-MM-dd'),
  });
  const carLoanPaidInstalments = Math.min(12 + (HISTORY_MONTHS - 1), carLoanSchedule.rows.length);
  const carLoanRow = carLoanSchedule.rows[carLoanPaidInstalments - 1];
  const carLoan: Loan = {
    id: nextLoanId(),
    name: 'Car Loan — Axis Bank',
    kind: 'auto',
    lender: 'Axis Bank',
    principal: carLoanPrincipal,
    outstanding: carLoanRow?.balance ?? scale(carLoanPrincipal, 0.55),
    annualRate: carLoanRate,
    rateType: 'fixed',
    tenureMonths: carLoanTenure,
    paidInstalments: carLoanPaidInstalments,
    emiAmount: computeEmi(carLoanPrincipal, carLoanRate, carLoanTenure),
    emiDay: 7,
    startDate: formatDate(carLoanStart, 'yyyy-MM-dd'),
    debitAccountId: salaryAccount.id,
    taxBenefit: { section: 'none' },
    createdAt: `${formatDate(carLoanStart, 'yyyy-MM-dd')}T00:00:00.000Z`,
    updatedAt: new Date().toISOString(),
  };

  // Small consumer-durable "no-cost EMI" (laptop) — the effective rate is never
  // really zero; this one carries a real 14% to be honest about that. Runs out
  // partway through the window, exactly as a 10-month EMI on a purchase from
  // ~9 months before the window would.
  const durableStart = addCalendarMonths(startOfMonth(asOfDate), -(HISTORY_MONTHS - 1) - 2);
  const durablePrincipal = fromRupees(52_000);
  const durableTenure = 10;
  const durableRate = 0.14;
  const durableEmi = computeEmi(durablePrincipal, durableRate, durableTenure);
  const durableLoan: Loan = {
    id: nextLoanId(),
    name: 'Laptop EMI — Bajaj Finserv',
    kind: 'consumer_durable',
    lender: 'Bajaj Finserv',
    principal: durablePrincipal,
    outstanding: ZERO,
    annualRate: durableRate,
    rateType: 'fixed',
    tenureMonths: durableTenure,
    paidInstalments: durableTenure,
    emiAmount: durableEmi,
    emiDay: 10,
    startDate: formatDate(durableStart, 'yyyy-MM-dd'),
    debitAccountId: salaryAccount.id,
    taxBenefit: { section: 'none' },
    closed: true,
    createdAt: `${formatDate(durableStart, 'yyyy-MM-dd')}T00:00:00.000Z`,
    updatedAt: new Date().toISOString(),
  };
  // Active only for the first two months of the 14-month window.
  const durableActiveMonths = 2;

  const loans: Loan[] = [homeLoan, carLoan, durableLoan];

  // -- Recurring items (subscriptions) ----------------------------------------
  // Spotify: charged for the first 9 months of the window, then dormant — nothing
  // for 5+ months, which is well past the "no charge in 2 intervals" threshold.
  const spotifyLastChargedMonth = months[8]!;
  // Netflix and Prime Video stay active throughout — both counted as "video"
  // services by the leak-detection rule, which is deliberate: it also surfaces
  // the cheaper of the two as a consolidation candidate.
  const netflixAmount = fromRupees(649);
  const primeAmount = fromRupees(299);
  const spotifyAmount = fromRupees(119);

  const recurring: RecurringItem[] = [
    {
      id: 'demo-rec-netflix',
      merchant: 'NETFLIX',
      amount: netflixAmount,
      interval: 'monthly',
      categoryId: CAT.streaming,
      accountId: creditCard.id,
      firstSeen: isoDate(months[0]!.date, 5),
      lastSeen: isoDate(months[HISTORY_MONTHS - 1]!.date, 5),
      confidence: 0.95,
      detected: true,
      dormant: false,
    },
    {
      id: 'demo-rec-prime',
      merchant: 'PRIME VIDEO',
      amount: primeAmount,
      interval: 'monthly',
      categoryId: CAT.streaming,
      accountId: creditCard.id,
      firstSeen: isoDate(months[0]!.date, 8),
      lastSeen: isoDate(months[HISTORY_MONTHS - 1]!.date, 8),
      confidence: 0.9,
      detected: true,
      dormant: false,
    },
    {
      id: 'demo-rec-spotify',
      merchant: 'SPOTIFY',
      amount: spotifyAmount,
      interval: 'monthly',
      categoryId: CAT.streaming,
      accountId: creditCard.id,
      firstSeen: isoDate(months[0]!.date, 12),
      lastSeen: isoDate(spotifyLastChargedMonth.date, 12),
      confidence: 0.9,
      detected: true,
      // Dormant: no charge for well over two monthly intervals by the time the
      // window ends — a subscription nobody got around to cancelling.
      dormant: true,
    },
  ];

  // -- Transactions --------------------------------------------------------
  const transactions: Transaction[] = [];
  const push = (t: Transaction) => transactions.push(t);

  const baseSalary = fromRupees(1_60_000);
  const raisedSalary = fromRupees(1_85_000);
  const bonusAmount = fromRupees(1_50_000);
  const baseRent = fromRupees(38_000);
  const baseSip = fromRupees(15_000);
  const raisedSip = fromRupees(20_000);
  const epfMonthly = fromRupees(1_800);

  for (const month of months) {
    const salary = month.raised ? raisedSalary : baseSalary;

    // Income -----------------------------------------------------------------
    push(
      mkTxn({
        accountId: salaryAccount.id,
        amount: salary,
        direction: 'credit',
        date: isoDate(month.date, 1),
        rawDescription: `NEFT-ACMEWORKS SOFTWARE PVT LTD-SALARY-${month.key}`,
        merchant: 'ACME WORKS SOFTWARE',
        categoryId: CAT.salary,
        kind: 'income',
        method: 'neft',
        reference: `SAL${month.key.replace('-', '')}`,
      }),
    );
    if (month.isBonusMonth) {
      push(
        mkTxn({
          accountId: salaryAccount.id,
          amount: bonusAmount,
          direction: 'credit',
          date: isoDate(month.date, 2),
          rawDescription: `NEFT-ACMEWORKS SOFTWARE PVT LTD-ANNUAL BONUS-${month.key}`,
          merchant: 'ACME WORKS SOFTWARE',
          categoryId: CAT.salary,
          kind: 'income',
          method: 'neft',
          reference: `BON${month.key.replace('-', '')}`,
        }),
      );
    }
    // A little savings-account interest, quarterly.
    if (month.index % 3 === 0) {
      push(
        mkTxn({
          accountId: salaryAccount.id,
          amount: fromRupees(jitter(rng, 850, 0.3)),
          direction: 'credit',
          date: isoDate(month.date, 1),
          rawDescription: 'SB A/C QUARTERLY INTEREST CREDIT',
          categoryId: CAT.interestIncome,
          kind: 'income',
          method: 'unknown',
        }),
      );
    }

    // Housing ------------------------------------------------------------
    push(
      mkTxn({
        accountId: salaryAccount.id,
        amount: baseRent,
        direction: 'debit',
        date: isoDate(month.date, 3),
        rawDescription: `UPI/P2A/RENT/LANDLORD SHARMA-${month.key}`,
        merchant: 'LANDLORD SHARMA',
        categoryId: CAT.rent,
        kind: 'expense',
        method: 'upi',
      }),
    );
    push(
      mkTxn({
        accountId: salaryAccount.id,
        amount: fromRupees(jitter(rng, 2200, 0.15)),
        direction: 'debit',
        date: isoDate(month.date, 4),
        rawDescription: 'UPI/P2M/SOCIETY MAINTENANCE',
        merchant: 'SOCIETY MAINTENANCE',
        categoryId: CAT.maintenance,
        kind: 'expense',
        method: 'upi',
      }),
    );

    // Loan EMIs -----------------------------------------------------------
    push(
      mkTxn({
        accountId: salaryAccount.id,
        amount: homeLoan.emiAmount,
        direction: 'debit',
        date: isoDate(month.date, 5),
        rawDescription: 'ACH DEBIT-HDFC LTD HOME LOAN EMI',
        merchant: 'HDFC LTD',
        categoryId: CAT.homeLoanEmi,
        kind: 'emi_payment',
        method: 'ach_mandate',
        loanId: homeLoan.id,
      }),
    );
    push(
      mkTxn({
        accountId: salaryAccount.id,
        amount: carLoan.emiAmount,
        direction: 'debit',
        date: isoDate(month.date, 7),
        rawDescription: 'ACH DEBIT-AXIS BANK CAR LOAN EMI',
        merchant: 'AXIS BANK',
        categoryId: CAT.autoLoanEmi,
        kind: 'emi_payment',
        method: 'ach_mandate',
        loanId: carLoan.id,
      }),
    );
    if (month.index < durableActiveMonths) {
      push(
        mkTxn({
          accountId: salaryAccount.id,
          amount: durableEmi,
          direction: 'debit',
          date: isoDate(month.date, 10),
          rawDescription: 'ACH DEBIT-BAJAJ FINSERV EMI',
          merchant: 'BAJAJ FINSERV',
          categoryId: CAT.otherEmi,
          kind: 'emi_payment',
          method: 'ach_mandate',
          loanId: durableLoan.id,
        }),
      );
    }

    // Utilities ------------------------------------------------------------
    push(
      mkTxn({
        accountId: salaryAccount.id,
        amount: fromRupees(jitter(rng, 2600, 0.35)),
        direction: 'debit',
        date: isoDate(month.date, 9),
        rawDescription: 'BESCOM BBPS ELECTRICITY BILL',
        merchant: 'BESCOM',
        categoryId: CAT.electricity,
        kind: 'expense',
        method: 'upi',
      }),
    );
    push(
      mkTxn({
        accountId: salaryAccount.id,
        amount: fromRupees(jitter(rng, 350, 0.2)),
        direction: 'debit',
        date: isoDate(month.date, 9),
        rawDescription: 'BWSSB WATER BILL BBPS',
        merchant: 'BWSSB',
        categoryId: CAT.water,
        kind: 'expense',
        method: 'upi',
      }),
    );
    push(
      mkTxn({
        accountId: salaryAccount.id,
        amount: fromRupees(jitter(rng, 950, 0.25)),
        direction: 'debit',
        date: isoDate(month.date, 11),
        rawDescription: 'INDANE GAS CYLINDER BOOKING',
        merchant: 'INDANE',
        categoryId: CAT.gas,
        kind: 'expense',
        method: 'upi',
      }),
    );
    push(
      mkTxn({
        accountId: salaryAccount.id,
        amount: fromRupees(999),
        direction: 'debit',
        date: isoDate(month.date, 6),
        rawDescription: 'ACT FIBERNET BROADBAND AUTOPAY',
        merchant: 'ACT FIBERNET',
        categoryId: CAT.internet,
        kind: 'expense',
        method: 'ach_mandate',
      }),
    );
    push(
      mkTxn({
        accountId: salaryAccount.id,
        amount: fromRupees(499),
        direction: 'debit',
        date: isoDate(month.date, 6),
        rawDescription: 'JIO PREPAID RECHARGE',
        merchant: 'JIO',
        categoryId: CAT.mobile,
        kind: 'expense',
        method: 'upi',
      }),
    );

    // Insurance -------------------------------------------------------------
    push(
      mkTxn({
        accountId: salaryAccount.id,
        amount: fromRupees(1_650),
        direction: 'debit',
        date: isoDate(month.date, 13),
        rawDescription: 'ACH DEBIT-LIC PREMIUM',
        merchant: 'LIC',
        categoryId: CAT.lifeInsurance,
        kind: 'expense',
        method: 'ach_mandate',
      }),
    );
    if (month.index % 12 === 6) {
      push(
        mkTxn({
          accountId: salaryAccount.id,
          amount: fromRupees(18_500),
          direction: 'debit',
          date: isoDate(month.date, 14),
          rawDescription: 'STAR HEALTH INSURANCE ANNUAL PREMIUM',
          merchant: 'STAR HEALTH',
          categoryId: CAT.healthInsurance,
          kind: 'expense',
          method: 'netbanking',
        }),
      );
    }
    if (month.index % 12 === 1) {
      push(
        mkTxn({
          accountId: salaryAccount.id,
          amount: fromRupees(6_200),
          direction: 'debit',
          date: isoDate(month.date, 15),
          rawDescription: 'ICICI LOMBARD CAR INSURANCE RENEWAL',
          merchant: 'ICICI LOMBARD',
          categoryId: CAT.vehicleInsurance,
          kind: 'expense',
          method: 'netbanking',
        }),
      );
    }

    // Investments -----------------------------------------------------------
    push(
      mkTxn({
        accountId: mfFolio.id,
        amount: month.raised ? raisedSip : baseSip,
        direction: 'debit',
        date: isoDate(month.date, 2),
        rawDescription: 'ACH DEBIT-ZERODHA COIN SIP',
        merchant: 'ZERODHA',
        categoryId: CAT.sip,
        kind: 'investment',
        method: 'ach_mandate',
      }),
    );
    push(
      mkTxn({
        accountId: epfAccount.id,
        amount: epfMonthly,
        direction: 'credit',
        date: isoDate(month.date, 1),
        rawDescription: 'EPFO EMPLOYER + EMPLOYEE CONTRIBUTION',
        merchant: 'EPFO',
        categoryId: CAT.ppfEpf,
        kind: 'investment',
        method: 'unknown',
      }),
    );

    // Groceries (2-3 trips/month) --------------------------------------------
    const groceryTrips = 2 + Math.floor(rng() * 2);
    const groceryMerchants = ['DMART', 'BIGBASKET', 'ZEPTO'];
    for (let i = 0; i < groceryTrips; i += 1) {
      const merchant = groceryMerchants[i % groceryMerchants.length]!;
      push(
        mkTxn({
          accountId: salaryAccount.id,
          amount: fromRupees(jitter(rng, 1_450, 0.4)),
          direction: 'debit',
          date: isoDate(month.date, 5 + i * 7),
          rawDescription: `UPI/P2M/${merchant}`,
          merchant,
          categoryId: CAT.groceries,
          kind: 'expense',
          method: 'upi',
        }),
      );
    }

    // Food delivery / dining — rises after the raise (lifestyle inflation). --
    const deliveryCount = month.raised ? 6 + Math.floor(rng() * 3) : 3 + Math.floor(rng() * 3);
    const deliveryBase = month.raised ? 480 : 380;
    const deliveryMerchants = ['SWIGGY', 'ZOMATO'];
    for (let i = 0; i < deliveryCount; i += 1) {
      const merchant = deliveryMerchants[i % deliveryMerchants.length]!;
      push(
        mkTxn({
          accountId: creditCard.id,
          amount: fromRupees(jitter(rng, deliveryBase, 0.5)),
          direction: 'debit',
          date: isoDate(month.date, 2 + i * 3),
          rawDescription: `UPI/P2M/${merchant} LIMITED BANGALORE`,
          merchant,
          categoryId: CAT.foodDelivery,
          kind: 'expense',
          method: 'card_credit',
        }),
      );
    }

    // Cabs — also rises post-raise. -----------------------------------------
    const cabCount = month.raised ? 8 + Math.floor(rng() * 4) : 4 + Math.floor(rng() * 3);
    const cabMerchants = ['UBER', 'OLA'];
    for (let i = 0; i < cabCount; i += 1) {
      const merchant = cabMerchants[i % cabMerchants.length]!;
      push(
        mkTxn({
          accountId: creditCard.id,
          amount: fromRupees(jitter(rng, 260, 0.45)),
          direction: 'debit',
          date: isoDate(month.date, 3 + i * 2),
          rawDescription: `${merchant} TRIP CHARGE`,
          merchant,
          categoryId: CAT.cabAuto,
          kind: 'expense',
          method: 'card_credit',
        }),
      );
    }

    // Fuel -------------------------------------------------------------------
    push(
      mkTxn({
        accountId: creditCard.id,
        amount: fromRupees(jitter(rng, 3_200, 0.2)),
        direction: 'debit',
        date: isoDate(month.date, 16),
        rawDescription: 'POS BPCL PETROL PUMP',
        merchant: 'BPCL',
        categoryId: CAT.fuel,
        kind: 'expense',
        method: 'card_credit',
      }),
    );

    // Subscriptions ------------------------------------------------------
    push(
      mkTxn({
        accountId: creditCard.id,
        amount: netflixAmount,
        direction: 'debit',
        date: isoDate(month.date, 5),
        rawDescription: 'NETFLIX.COM AUTOPAY',
        merchant: 'NETFLIX',
        categoryId: CAT.streaming,
        kind: 'expense',
        method: 'card_credit',
      }),
    );
    push(
      mkTxn({
        accountId: creditCard.id,
        amount: primeAmount,
        direction: 'debit',
        date: isoDate(month.date, 8),
        rawDescription: 'AMAZON PRIME MEMBERSHIP AUTOPAY',
        merchant: 'AMAZON PRIME',
        categoryId: CAT.streaming,
        kind: 'expense',
        method: 'card_credit',
      }),
    );
    if (month.index <= 8) {
      push(
        mkTxn({
          accountId: creditCard.id,
          amount: spotifyAmount,
          direction: 'debit',
          date: isoDate(month.date, 12),
          rawDescription: 'SPOTIFY INDIA AUTOPAY',
          merchant: 'SPOTIFY',
          categoryId: CAT.streaming,
          kind: 'expense',
          method: 'card_credit',
        }),
      );
    }

    // General shopping — with a deliberate spike in month index 10. ----------
    const shoppingBase = month.index === 10 ? 46_000 : month.raised ? 3_200 : 2_000;
    push(
      mkTxn({
        accountId: creditCard.id,
        amount: fromRupees(jitter(rng, shoppingBase, 0.15)),
        direction: 'debit',
        date: isoDate(month.date, 19),
        rawDescription: month.index === 10 ? 'AMAZON.IN — LAPTOP ACCESSORIES + FESTIVE HAUL' : 'AMAZON.IN ORDER',
        merchant: 'AMAZON',
        categoryId: month.index === 10 ? CAT.shoppingElectronics : CAT.shoppingGeneral,
        kind: 'expense',
        method: 'card_credit',
      }),
    );

    // Credit card bill payment — pays off (most of) what accrued. ------------
    push(
      mkTxn({
        accountId: salaryAccount.id,
        amount: fromRupees(jitter(rng, month.raised ? 24_000 : 17_000, 0.2)),
        direction: 'debit',
        date: isoDate(month.date, 24),
        rawDescription: 'ICICI CREDIT CARD BILL PAYMENT',
        merchant: 'ICICI BANK',
        categoryId: CAT.creditCardPayment,
        kind: 'emi_payment',
        method: 'netbanking',
      }),
    );

    // Fees & penalties — sprinkled through the year, never every month. -----
    if (month.index === 2 || month.index === 9) {
      push(
        mkTxn({
          accountId: salaryAccount.id,
          amount: fromRupees(500),
          direction: 'debit',
          date: isoDate(month.date, 26),
          rawDescription: 'LATE PAYMENT CHARGES — CREDIT CARD',
          merchant: 'ICICI BANK',
          categoryId: CAT.lateFee,
          kind: 'fee',
          method: 'unknown',
        }),
      );
    }
    if (month.index === 4 || month.index === 11) {
      push(
        mkTxn({
          accountId: salaryAccount.id,
          amount: fromRupees(23),
          direction: 'debit',
          date: isoDate(month.date, 17),
          rawDescription: 'ATM WDL CHARGES — NON-HOME BANK',
          categoryId: CAT.atmFee,
          kind: 'fee',
          method: 'unknown',
        }),
      );
    }
    if (month.index === 3) {
      push(
        mkTxn({
          accountId: salaryAccount.id,
          amount: fromRupees(890),
          direction: 'debit',
          date: isoDate(month.date, 25),
          rawDescription: 'INTEREST CHARGED — REVOLVING CREDIT',
          merchant: 'ICICI BANK',
          categoryId: CAT.interestCharged,
          kind: 'fee',
          method: 'unknown',
        }),
      );
    }
    if (month.index === 6) {
      push(
        mkTxn({
          accountId: salaryAccount.id,
          amount: fromRupees(118),
          direction: 'debit',
          date: isoDate(month.date, 20),
          rawDescription: 'SMS ALERT + AMB SHORTFALL CHARGES',
          categoryId: CAT.bankCharges,
          kind: 'fee',
          method: 'unknown',
        }),
      );
    }
  }

  // -- Account balances (approximate, but positive safe integers) ------------
  salaryAccount.balance = fromRupees(2_84_500);
  creditCard.balance = fromRupees(19_400);
  wallet.balance = fromRupees(1_250);
  mfFolio.balance = fromRupees(3_45_000);
  epfAccount.balance = fromRupees(2_10_000);

  // -- Profile -----------------------------------------------------------
  const profile: UserProfile = {
    currency: 'INR',
    locale: 'en-IN',
    dateOfBirth: '1992-04-18',
    monthlyNetIncome: raisedSalary,
    dependents: 1,
    taxRegime: 'new',
    riskProfile: 'moderate',
    expectedPortfolioReturn: 0.11,
    assumedInflation: 0.06,
    retirementAge: 58,
    taxDeclarations: {
      section80C: fromRupees(1_10_000),
      section80D: fromRupees(18_500),
    },
    employmentType: 'salaried',
  };

  const goals: Goal[] = [
    {
      id: 'demo-goal-emergency',
      name: 'Emergency Fund',
      kind: 'emergency_fund',
      targetAmount: fromRupees(9_00_000),
      targetDate: formatDate(addCalendarMonths(asOfDate, 10), 'yyyy-MM-dd'),
      currentAmount: add(salaryAccount.balance, wallet.balance),
      monthlyContribution: fromRupees(10_000),
      expectedReturn: 0.06,
      priority: 1,
      linkedAccountIds: [salaryAccount.id],
      createdAt: isoDate(months[0]!.date, 1) + 'T00:00:00.000Z',
    },
    {
      id: 'demo-goal-retirement',
      name: 'Retirement Corpus',
      kind: 'retirement',
      targetAmount: fromRupees(4_00_00_000),
      targetDate: '2058-04-18',
      currentAmount: add(mfFolio.balance, epfAccount.balance),
      monthlyContribution: raisedSip,
      expectedReturn: 0.11,
      priority: 2,
      linkedAccountIds: [mfFolio.id, epfAccount.id],
      createdAt: isoDate(months[0]!.date, 1) + 'T00:00:00.000Z',
    },
  ];

  const budgets: Budget[] = [
    { id: 'demo-budget-dining', categoryId: CAT.foodDelivery, limit: fromRupees(4_000), createdAt: new Date().toISOString() },
    { id: 'demo-budget-shopping', categoryId: CAT.shoppingGeneral, limit: fromRupees(3_500), createdAt: new Date().toISOString() },
  ];

  return {
    profile,
    accounts,
    transactions,
    loans,
    budgets,
    goals,
    recurring,
    categories: BUILTIN_CATEGORIES,
    asOf: asOfDate.toISOString(),
  };
}
