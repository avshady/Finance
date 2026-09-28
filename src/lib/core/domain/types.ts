/**
 * Domain model. This file is the contract every other module builds against.
 * Pure types + invariants; no I/O, no React, no Dexie.
 */

import type { Paise } from './money';

/** ISO-8601 date, day precision: "2026-09-28". */
export type IsoDate = string;
/** ISO-8601 instant: "2026-09-28T10:32:00.000Z". */
export type IsoInstant = string;
/** Calendar month key: "2026-09". */
export type MonthKey = string;

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

export type AccountKind =
  | 'savings'
  | 'current'
  | 'credit_card'
  | 'wallet'          // Paytm/PhonePe balance, prepaid instruments
  | 'cash'
  | 'brokerage'
  | 'mutual_fund'
  | 'epf'             // Employees' Provident Fund
  | 'ppf'             // Public Provident Fund
  | 'nps'
  | 'fixed_deposit'
  | 'recurring_deposit'
  | 'loan'            // liability mirror of a Loan record
  | 'other';

/** Accounts whose balance is a liability, not an asset. */
export const LIABILITY_KINDS: readonly AccountKind[] = ['credit_card', 'loan'];

export interface Account {
  id: string;
  name: string;
  kind: AccountKind;
  institution?: string;
  /** Last 4 digits only. Never store a full account or card number. */
  mask?: string;
  currency: string;
  /** Current balance. For liabilities this is the outstanding amount, stored positive. */
  balance: Paise;
  /** Credit cards only: sanctioned limit, for utilisation ratio. */
  creditLimit?: Paise;
  /** Credit cards only: day of month the statement is generated. */
  statementDay?: number;
  /** Credit cards only: day of month payment is due. */
  paymentDueDay?: number;
  /** Which ingest channel owns this account's truth. */
  sourceChannel?: ChannelId;
  archived?: boolean;
  createdAt: IsoInstant;
  updatedAt: IsoInstant;
}

// ---------------------------------------------------------------------------
// Transactions
// ---------------------------------------------------------------------------

export type TxnDirection = 'debit' | 'credit';

export type TxnKind =
  | 'expense'
  | 'income'
  | 'transfer'        // between the user's own accounts — must not count as either
  | 'investment'      // outflow that becomes an asset
  | 'emi_payment'
  | 'refund'
  | 'fee'             // bank charges, penalties, interest levied
  | 'unknown';

export type PaymentMethod =
  | 'upi'
  | 'card_debit'
  | 'card_credit'
  | 'netbanking'
  | 'imps'
  | 'neft'
  | 'rtgs'
  | 'ach_mandate'     // SIP / EMI auto-debit
  | 'cash'
  | 'wallet'
  | 'cheque'
  | 'unknown';

export interface Transaction {
  id: string;
  accountId: string;
  /** Always positive. `direction` carries the sign. */
  amount: Paise;
  direction: TxnDirection;
  currency: string;
  date: IsoDate;
  /** When the channel reported it — used for real-time ordering and dedupe. */
  observedAt: IsoInstant;
  /** Raw description as the bank sent it. Never overwritten; it is the audit trail. */
  rawDescription: string;
  /** Normalized merchant, e.g. "SWIGGY" from "UPI/P2M/41234/SWIGGY LIMITED BANGA". */
  merchant?: string;
  categoryId: string;
  /** True when categoryId came from the rules engine rather than the user. */
  categoryAuto: boolean;
  kind: TxnKind;
  method: PaymentMethod;
  /** Bank reference / UTR / RRN. The strongest dedupe key when present. */
  reference?: string;
  /** Balance the bank reported after this txn — lets us reconcile and detect gaps. */
  balanceAfter?: Paise;
  channel: ChannelId;
  /** Set when this txn is one leg of a transfer; points at the other leg. */
  transferPairId?: string;
  /** Set when this txn is an instalment of a tracked loan. */
  loanId?: string;
  notes?: string;
  tags?: string[];
  /** Excluded from analytics and advice (duplicate, reimbursed, test data). */
  excluded?: boolean;
  createdAt: IsoInstant;
  updatedAt: IsoInstant;
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

/**
 * `essential` drives the emergency-fund target and the survivable-burn figure.
 * Getting this flag right matters more than the category label itself.
 */
export interface Category {
  id: string;
  name: string;
  parentId?: string;
  group: CategoryGroup;
  essential: boolean;
  /** Emoji or icon key, for the UI. */
  icon?: string;
  color?: string;
  builtin: boolean;
}

export type CategoryGroup =
  | 'housing'
  | 'food'
  | 'transport'
  | 'utilities'
  | 'health'
  | 'insurance'
  | 'education'
  | 'shopping'
  | 'entertainment'
  | 'travel'
  | 'personal_care'
  | 'debt'
  | 'investment'
  | 'income'
  | 'taxes'
  | 'fees'
  | 'gifts_donations'
  | 'transfer'
  | 'uncategorized';

// ---------------------------------------------------------------------------
// Loans & EMIs
// ---------------------------------------------------------------------------

export type LoanKind =
  | 'home'
  | 'auto'
  | 'personal'
  | 'education'
  | 'gold'
  | 'credit_card_revolving'   // treated as a loan because the APR demands it
  | 'consumer_durable'        // the "no cost EMI" that usually has a cost
  | 'business'
  | 'loan_against_securities'
  | 'other';

export type RateType = 'fixed' | 'floating';

export interface Loan {
  id: string;
  name: string;
  kind: LoanKind;
  lender?: string;
  /** Amount originally disbursed. */
  principal: Paise;
  /** Current outstanding principal. The number every payoff calculation starts from. */
  outstanding: Paise;
  /** Nominal annual rate as a decimal: 0.0895 for 8.95%. */
  annualRate: number;
  rateType: RateType;
  /** Original tenure in months. */
  tenureMonths: number;
  /** Instalments already paid. */
  paidInstalments: number;
  /** Contractual instalment amount. */
  emiAmount: Paise;
  /** Day of month the EMI is debited. */
  emiDay: number;
  startDate: IsoDate;
  /** Account the EMI is debited from. */
  debitAccountId?: string;
  /**
   * Tax treatment — decides prepay-vs-invest correctly.
   * Home loans get §24(b) on interest and §80C on principal; education loans get §80E
   * on interest with no cap. An advisor that ignores this gives backwards advice.
   */
  taxBenefit?: {
    section: '24b' | '80C' | '80E' | 'none';
    /** Annual deduction cap in Paise; undefined means uncapped (§80E). */
    annualCap?: Paise;
  };
  /** Prepayment penalty as a decimal of the prepaid amount. Often 0 for floating retail loans. */
  prepaymentPenaltyRate?: number;
  /** Extra payments already made, for accurate schedule reconstruction. */
  prepayments?: Array<{ date: IsoDate; amount: Paise }>;
  closed?: boolean;
  createdAt: IsoInstant;
  updatedAt: IsoInstant;
}

/** One row of an amortization schedule. */
export interface AmortizationRow {
  instalment: number;
  date: IsoDate;
  payment: Paise;
  interest: Paise;
  principal: Paise;
  /** Outstanding principal after this instalment. */
  balance: Paise;
}

export interface AmortizationSchedule {
  rows: AmortizationRow[];
  totalInterest: Paise;
  totalPaid: Paise;
  /** Month the loan closes. */
  payoffDate: IsoDate;
  months: number;
}

// ---------------------------------------------------------------------------
// Budgets, recurring items, goals
// ---------------------------------------------------------------------------

export interface Budget {
  id: string;
  categoryId: string;
  /** Limit per month. */
  limit: Paise;
  /** Rolls unspent room into next month. */
  rollover?: boolean;
  createdAt: IsoInstant;
}

export type RecurrenceInterval = 'weekly' | 'monthly' | 'quarterly' | 'half_yearly' | 'yearly';

/** A detected or declared recurring charge — subscriptions, rent, premiums, SIPs. */
export interface RecurringItem {
  id: string;
  merchant: string;
  amount: Paise;
  interval: RecurrenceInterval;
  categoryId: string;
  accountId?: string;
  firstSeen: IsoDate;
  lastSeen: IsoDate;
  nextExpected?: IsoDate;
  /** How sure the detector is, 0..1. Below ~0.6 we ask the user rather than assert. */
  confidence: number;
  /** Detected automatically vs. entered by the user. */
  detected: boolean;
  /** No charge for >2 intervals: a candidate for cancellation advice. */
  dormant?: boolean;
  cancelled?: boolean;
}

export type GoalKind =
  | 'emergency_fund'
  | 'retirement'
  | 'house'
  | 'vehicle'
  | 'education'
  | 'wedding'
  | 'travel'
  | 'debt_free'
  | 'custom';

export interface Goal {
  id: string;
  name: string;
  kind: GoalKind;
  targetAmount: Paise;
  targetDate: IsoDate;
  currentAmount: Paise;
  /** What the user is actually contributing each month. */
  monthlyContribution: Paise;
  /** Expected annual nominal return on this goal's corpus, as a decimal. */
  expectedReturn: number;
  priority: number;
  linkedAccountIds?: string[];
  createdAt: IsoInstant;
}

// ---------------------------------------------------------------------------
// Ingest channels
// ---------------------------------------------------------------------------

export type ChannelId =
  | 'manual'
  | 'csv'
  | 'sms'
  | 'email'
  | 'account_aggregator'
  | 'plaid'
  | 'webhook'
  | 'share_target';

/**
 * How honest the app is about a channel. Surfaced verbatim in the UI.
 * The app must never present `needs-credentials` or `needs-companion-app` as connected.
 */
export type ChannelStatus = 'live' | 'needs-credentials' | 'needs-companion-app';

export interface ChannelDescriptor {
  id: ChannelId;
  label: string;
  status: ChannelStatus;
  /** Realistic latency from the money moving to the app knowing. */
  latency: 'real-time' | 'minutes' | 'hours' | 'on-demand';
  /** Plain-language statement of what the user must do or supply. */
  requirement: string;
}

/** Unparsed input from a channel, before normalization. */
export interface RawEvent {
  id: string;
  channel: ChannelId;
  receivedAt: IsoInstant;
  /** The SMS body, email text, CSV row, or API payload. */
  payload: string;
  /** Sender id: SMS header ("VM-HDFCBK"), email from-address, bank code. */
  sender?: string;
  meta?: Record<string, unknown>;
}

/** Result of parsing a RawEvent. Partial because a single SMS rarely gives everything. */
export interface ParsedTransaction {
  amount: Paise;
  direction: TxnDirection;
  date?: IsoDate;
  merchant?: string;
  rawDescription: string;
  method: PaymentMethod;
  reference?: string;
  balanceAfter?: Paise;
  /** Institution code the parser recognised, e.g. "HDFC". */
  institution?: string;
  accountMask?: string;
  /** Parser confidence 0..1. Below 0.5 the txn goes to a review queue, not the ledger. */
  confidence: number;
}

export interface ChannelAdapter {
  readonly descriptor: ChannelDescriptor;
  /** True when this adapter recognises the event and should handle it. */
  canParse(event: RawEvent): boolean;
  /** Returns [] when nothing financial is present (OTPs, promos, balance-only alerts). */
  parse(event: RawEvent): ParsedTransaction[];
}

// ---------------------------------------------------------------------------
// User profile — the inputs advice cannot be given without
// ---------------------------------------------------------------------------

export type TaxRegime = 'old' | 'new';
export type RiskProfile = 'conservative' | 'moderate' | 'aggressive';

export interface UserProfile {
  currency: string;
  locale: string;
  dateOfBirth?: IsoDate;
  /** Take-home pay per month, after tax and deductions. */
  monthlyNetIncome: Paise;
  /** Number of people financially dependent on the user. Raises the emergency-fund floor. */
  dependents: number;
  taxRegime: TaxRegime;
  riskProfile: RiskProfile;
  /** Expected long-run nominal portfolio return, decimal. Default 0.11 for Indian equity-tilted. */
  expectedPortfolioReturn: number;
  /** Assumed long-run inflation, decimal. Default 0.06 for India. */
  assumedInflation: number;
  /** Target retirement age, for the FI projection. */
  retirementAge?: number;
  /** §80C, §80D, NPS amounts already committed this financial year. */
  taxDeclarations?: {
    section80C?: Paise;
    section80D?: Paise;
    nps80CCD1B?: Paise;
  };
  /** Job stability affects the emergency-fund multiplier. */
  employmentType?: 'salaried' | 'self_employed' | 'business' | 'freelance';
}

// ---------------------------------------------------------------------------
// Snapshot — the single input to the advisor engine
// ---------------------------------------------------------------------------

/**
 * Everything the advisor is allowed to see, precomputed once.
 * Rules are pure functions of this. That makes each one trivially testable against
 * a hand-built fixture, which is the only way to trust financial advice code.
 */
export interface FinancialSnapshot {
  asOf: IsoInstant;
  profile: UserProfile;
  accounts: Account[];
  /** Trailing window used by the analytics below, typically 12 months. */
  transactions: Transaction[];
  loans: Loan[];
  budgets: Budget[];
  goals: Goal[];
  recurring: RecurringItem[];
  categories: Category[];
  metrics: SnapshotMetrics;
}

export interface SnapshotMetrics {
  /** Assets minus liabilities. */
  netWorth: Paise;
  totalAssets: Paise;
  totalLiabilities: Paise;
  /** Cash reachable within a day: savings + current + wallet + cash. */
  liquidAssets: Paise;
  /** Median monthly income over the window. Median, because bonuses are not salary. */
  monthlyIncome: Paise;
  /** Median monthly total outflow. */
  monthlyExpenses: Paise;
  /** Median monthly outflow on categories flagged essential. Drives the EF target. */
  monthlyEssentialExpenses: Paise;
  /** (income - expenses) / income. Null when income is unknown. */
  savingsRate: number | null;
  /** Sum of contractual EMIs due per month. */
  totalMonthlyEmi: Paise;
  /** totalMonthlyEmi / monthlyIncome. The 40% guardrail. */
  emiToIncomeRatio: number | null;
  /** Months of essential expenses covered by liquid assets. */
  emergencyFundMonths: number | null;
  /** Credit used / credit limit, across all cards. The 30% guardrail. */
  creditUtilisation: number | null;
  /** Per-category monthly spend, keyed by categoryId. */
  spendByCategory: Record<string, Paise>;
  /** Total spend per month, keyed by MonthKey, oldest first. */
  spendByMonth: Record<MonthKey, Paise>;
  /** Total income per month. */
  incomeByMonth: Record<MonthKey, Paise>;
}

// ---------------------------------------------------------------------------
// Advisor output
// ---------------------------------------------------------------------------

export type InsightSeverity = 'critical' | 'high' | 'medium' | 'low' | 'positive';
export type Confidence = 'high' | 'medium' | 'low';

export type ActionKind =
  | 'open_debt_planner'
  | 'simulate_prepayment'
  | 'set_budget'
  | 'create_goal'
  | 'review_subscription'
  | 'increase_sip'
  | 'build_emergency_fund'
  | 'review_transaction'
  | 'update_profile'
  | 'review_insurance'
  | 'optimise_tax';

export interface EvidenceRef {
  kind: 'transaction' | 'loan' | 'account' | 'recurring' | 'goal' | 'metric';
  id: string;
  label: string;
}

/**
 * A single recommendation. `impact` is what the list is sorted by — advice is
 * ordered by what it is worth, not by when it was noticed.
 */
export interface Insight {
  id: string;
  rule: string;
  severity: InsightSeverity;
  headline: string;
  /** The arithmetic, shown. Non-negotiable: unexplained financial advice is unusable. */
  reasoning: string;
  impact: { amountPaise: Paise; horizonMonths: number };
  confidence: Confidence;
  action?: { label: string; kind: ActionKind; params?: Record<string, unknown> };
  evidence: EvidenceRef[];
  /** Rules this one supersedes — prevents telling someone to invest while suppressed. */
  suppresses?: string[];
  generatedAt: IsoInstant;
}

export interface AdvisorRule {
  id: string;
  /** Doctrine sequencing: lower runs first and may suppress later rules. */
  stage: 1 | 2 | 3 | 4 | 5;
  title: string;
  evaluate(snapshot: FinancialSnapshot): Insight[];
}
