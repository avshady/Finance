/**
 * Stage 3 rules: leaks — money quietly draining that the user would stop the moment
 * they actually saw it. None of this is urgent the way stage-1 debt is; all of it is
 * pure waste, which is a different kind of urgency. A ₹499/month forgotten
 * subscription is not a crisis, but it is ₹5,988 a year for literally nothing, and it
 * compounds with every other leak nobody has pointed out.
 *
 * Tone matters here more than in any other stage: this is spend the user chose, or
 * stopped noticing they chose. The job is to name the number and let it speak, not to
 * moralise about it.
 */

import { add, ratio, scale, subtract, sum, ZERO, type Paise } from '../../domain/money';
import type {
  AdvisorRule,
  Category,
  EvidenceRef,
  FinancialSnapshot,
  Insight,
  InsightSeverity,
  RecurringItem,
} from '../../domain/types';
import {
  annualisedCost,
  detectCategoryAnomalies,
  lifestyleInflation,
  spendingVelocity,
  topMovers,
} from '../../analytics';
import { insightId, pct, rupees } from '../engine';

function baseInsight(
  rule: string,
  snapshot: FinancialSnapshot,
  fields: Omit<Insight, 'id' | 'rule' | 'generatedAt'>,
): Insight {
  return { id: insightId(rule), rule, generatedAt: snapshot.asOf, ...fields };
}

function categoryName(categories: readonly Category[], categoryId: string): string {
  return categories.find((c) => c.id === categoryId)?.name ?? categoryId;
}

// ---------------------------------------------------------------------------
// Dormant & duplicate subscriptions
// ---------------------------------------------------------------------------

/** Substring match against `detectRecurring`'s normalized (uppercase) merchant key. */
const MUSIC_SERVICES = [
  'SPOTIFY',
  'APPLE MUSIC',
  'YOUTUBE MUSIC',
  'YOUTUBE PREMIUM',
  'JIOSAAVN',
  'GAANA',
  'AMAZON MUSIC',
  'WYNK',
];

const VIDEO_SERVICES = [
  'NETFLIX',
  'PRIME VIDEO',
  'AMAZON PRIME',
  'HOTSTAR',
  'DISNEY',
  'SONYLIV',
  'ZEE5',
  'JIOCINEMA',
  'VOOT',
  'ALTBALAJI',
  'MX PLAYER',
  'LIONSGATE',
];

function classifyService(merchant: string): 'music' | 'video' | null {
  if (MUSIC_SERVICES.some((s) => merchant.includes(s))) return 'music';
  if (VIDEO_SERVICES.some((s) => merchant.includes(s))) return 'video';
  return null;
}

/**
 * Dormant subscriptions, and duplicate/overlapping streaming services.
 *
 * Two failure modes account for most subscription waste: a service nobody cancelled
 * after they stopped using it (flagged `dormant` once no charge has landed for two full
 * intervals), and paying for two services that do the same job (two music apps, two
 * video apps) because a trial or a household member's pick never got consolidated.
 * Both are 100%-recoverable money — cancelling costs the user nothing they were using.
 */
export const dormantSubscriptionsRule: AdvisorRule = {
  id: 'dormant-subscriptions',
  stage: 3,
  title: 'Dormant & duplicate subscriptions',
  evaluate(snapshot) {
    const active = snapshot.recurring.filter((r) => !r.cancelled);
    if (active.length === 0) return [];

    const dormant = active.filter((r) => r.dormant);

    // Group active, non-dormant-only-but-still-charging services by kind. Within a
    // group of 2+, the cheapest is assumed to be the one worth keeping (or the one
    // most likely already in use) and the rest are the recoverable duplicates.
    const byKind = new Map<'music' | 'video', RecurringItem[]>();
    for (const item of active) {
      const kind = classifyService(item.merchant);
      if (!kind) continue;
      const arr = byKind.get(kind);
      if (arr) arr.push(item);
      else byKind.set(kind, [item]);
    }

    const duplicateExtras: RecurringItem[] = [];
    for (const group of byKind.values()) {
      if (group.length < 2) continue;
      const sorted = [...group].sort((a, b) => annualisedCost(a) - annualisedCost(b));
      duplicateExtras.push(...sorted.slice(1));
    }

    // Union by id: a dormant item that also happens to be a duplicate extra is only
    // counted, and only named, once.
    const combined = new Map<string, { item: RecurringItem; reasons: string[] }>();
    for (const item of dormant) {
      combined.set(item.id, { item, reasons: ['no charge in over two intervals'] });
    }
    for (const item of duplicateExtras) {
      const existing = combined.get(item.id);
      if (existing) existing.reasons.push('duplicates another active subscription');
      else combined.set(item.id, { item, reasons: ['duplicates another active subscription'] });
    }

    if (combined.size === 0) return [];

    const items = [...combined.values()];
    const totalAnnual = sum(items.map(({ item }) => annualisedCost(item)));
    if (totalAnnual <= 0) return [];

    const evidence: EvidenceRef[] = items.map<EvidenceRef>(({ item, reasons }) => ({
      kind: 'recurring',
      id: item.id,
      label: `${item.merchant}: ${rupees(annualisedCost(item))}/year (${reasons.join(', ')})`,
    }));

    const namedList = items
      .map(({ item, reasons }) => `${item.merchant} at ${rupees(annualisedCost(item))}/year (${reasons.join('; ')})`)
      .join('; ');

    return [
      baseInsight('dormant-subscriptions', snapshot, {
        severity: totalAnnual > 12_000_00 ? 'medium' : 'low',
        headline: `${rupees(totalAnnual)}/year going to subscriptions you're not using`,
        reasoning: `${namedList}. None of this requires cutting anything you actually use: cancelling a forgotten ${rupees(
          items[0]!.item.amount,
        )}/${items[0]!.item.interval === 'monthly' ? 'month' : items[0]!.item.interval} service is pure recovery at zero sacrifice. Together these ${
          items.length === 1 ? 'this subscription is' : `${items.length} subscriptions are`
        } worth ${rupees(totalAnnual)} a year if left running to term.`,
        impact: { amountPaise: totalAnnual, horizonMonths: 12 },
        confidence: 'high',
        action: { label: 'Review subscriptions', kind: 'review_subscription' },
        evidence,
      }),
    ];
  },
};

// ---------------------------------------------------------------------------
// Fees & penalties
// ---------------------------------------------------------------------------

type FeeAvoidance = 'process' | 'negotiation' | 'other';

/** How a fee category is typically avoided, from its name. Best-effort, not exhaustive. */
function classifyFeeAvoidance(name: string): FeeAvoidance {
  const n = name.toLowerCase();
  if (/late|penal|bounce|auto.?debit|minimum balance|\bamb\b|atm/.test(n)) return 'process';
  if (/annual|joining|renewal|membership/.test(n)) return 'negotiation';
  return 'other';
}

/**
 * Fees and penalties: the most galling category of spend because it buys nothing.
 *
 * Every rupee here is either avoidable by process (an autopay mandate kills late fees
 * before they happen; planning cash withdrawals at your own bank's ATM kills the ATM
 * fee) or avoidable by asking (many annual card fees waive on request, or on hitting a
 * spend threshold the bank never volunteers). Splitting the two matters: telling
 * someone to "negotiate" a late fee wastes their time, and telling them to "automate"
 * a card's annual fee is nonsense.
 */
export const feesAndPenaltiesRule: AdvisorRule = {
  id: 'fees-penalties',
  stage: 3,
  title: 'Fees & penalties',
  evaluate(snapshot) {
    const feeCategories = snapshot.categories.filter((c) => c.group === 'fees');
    if (feeCategories.length === 0) return [];
    const feeCategoryIds = new Set(feeCategories.map((c) => c.id));

    const feeTxns = snapshot.transactions.filter(
      (t) => !t.excluded && t.direction === 'debit' && t.kind !== 'transfer' && feeCategoryIds.has(t.categoryId),
    );
    if (feeTxns.length === 0) return [];

    const totalFees = sum(feeTxns.map((t) => t.amount));
    if (totalFees <= 0) return [];

    // Annualise off the observed window rather than assuming 12 months of history:
    // a snapshot with 3 months of data that already shows ₹1,500 of fees is not a
    // ₹1,500/year problem, it is a ₹6,000/year problem.
    const monthsObserved = Object.keys(snapshot.metrics.spendByMonth).length;
    if (monthsObserved === 0) return [];
    const annualFees = scale(totalFees, 12 / monthsObserved);

    const byCategory = new Map<string, Paise>();
    for (const t of feeTxns) {
      byCategory.set(t.categoryId, add(byCategory.get(t.categoryId) ?? ZERO, t.amount));
    }

    const processCats: string[] = [];
    const negotiationCats: string[] = [];
    const otherCats: string[] = [];
    for (const [categoryId, spend] of byCategory) {
      const name = categoryName(snapshot.categories, categoryId);
      const line = `${name} (${rupees(spend)} observed)`;
      const bucket = classifyFeeAvoidance(name);
      if (bucket === 'process') processCats.push(line);
      else if (bucket === 'negotiation') negotiationCats.push(line);
      else otherCats.push(line);
    }

    const annualIncome = scale(snapshot.metrics.monthlyIncome, 12);
    const feeShareOfIncome = ratio(annualFees, annualIncome);
    const severity: InsightSeverity =
      feeShareOfIncome !== null && feeShareOfIncome > 0.01 ? 'high' : 'medium';

    const evidence: EvidenceRef[] = [...byCategory.entries()].map<EvidenceRef>(([categoryId, spend]) => ({
      kind: 'metric',
      id: categoryId,
      label: `${categoryName(snapshot.categories, categoryId)}: ${rupees(spend)} observed`,
    }));

    const processLine =
      processCats.length > 0
        ? ` Fixed by process, not willpower: ${processCats.join(
            ', ',
          )} — a due-date autopay mandate kills late fees before they happen, and planning withdrawals at your own bank's ATM kills the ATM charge.`
        : '';
    const negotiationLine =
      negotiationCats.length > 0
        ? ` Worth a phone call: ${negotiationCats.join(
            ', ',
          )} are commonly waived on request, or automatically once you cross the bank's annual spend threshold — most people never ask.`
        : '';
    const otherLine = otherCats.length > 0 ? ` Also present: ${otherCats.join(', ')}.` : '';

    return [
      baseInsight('fees-penalties', snapshot, {
        severity,
        headline: `${rupees(annualFees)}/year in fees and penalties that buy you nothing`,
        reasoning: `${rupees(totalFees)} in fee/penalty charges across ${monthsObserved} month(s) of history, which is ${rupees(
          annualFees,
        )} on a 12-month basis.${processLine}${negotiationLine}${otherLine}`,
        impact: { amountPaise: annualFees, horizonMonths: 12 },
        confidence: 'high',
        action: { label: 'Review recurring fees', kind: 'review_transaction' },
        evidence,
      }),
    ];
  },
};

// ---------------------------------------------------------------------------
// Lifestyle inflation
// ---------------------------------------------------------------------------

/**
 * Lifestyle inflation: income rose, the savings rate did not — the quiet wealth
 * killer, because nothing about it looks like a mistake in any single month. The
 * entire raise gets absorbed a little at a time until, a year later, the person earns
 * meaningfully more and has nothing extra to show for it.
 *
 * Fires only when `lifestyleInflation()` calls it (>=10% income growth, savings-rate
 * delta at or below +2pp). Confidence is capped at `medium`: this is an inference from
 * a short trailing window, not a certainty, and a genuine one-off (a bonus quarter, a
 * relocation) can produce the same signature.
 */
export const lifestyleInflationRule: AdvisorRule = {
  id: 'lifestyle-inflation',
  stage: 3,
  title: 'Lifestyle inflation',
  evaluate(snapshot) {
    const result = lifestyleInflation(snapshot.transactions, snapshot.asOf);
    if (!result.inflating) return [];

    const lateSavingsRate = snapshot.metrics.savingsRate;
    // Can't state a defensible rupee number without a savings-rate baseline to compare
    // the raise against.
    if (lateSavingsRate === null) return [];

    const earlySavingsRate = lateSavingsRate - result.savingsRateDelta;
    if (earlySavingsRate <= 0) return [];

    const incomeGrowthRatio = result.incomeGrowthPct / 100;
    if (incomeGrowthRatio <= 0) return [];

    const lateMonthlyIncome = snapshot.metrics.monthlyIncome;
    const earlyMonthlyIncome = scale(lateMonthlyIncome, 1 / (1 + incomeGrowthRatio));
    const raiseMonthly = subtract(lateMonthlyIncome, earlyMonthlyIncome);
    if (raiseMonthly <= 0) return [];

    // What the raise should have added to annual savings had the prior savings rate
    // held: income growth x prior savings rate x 12.
    const shouldHaveSavedAnnual = scale(raiseMonthly, earlySavingsRate * 12);
    if (shouldHaveSavedAnnual <= 0) return [];

    const movers = topMovers(snapshot.transactions, snapshot.asOf, 3)
      .filter((m) => m.change > 0)
      .map((m) => `${categoryName(snapshot.categories, m.categoryId)} (+${rupees(m.change)})`);

    const evidence: EvidenceRef[] = [
      { kind: 'metric', id: 'incomeGrowth', label: `Income growth ${pct(incomeGrowthRatio)}` },
      {
        kind: 'metric',
        id: 'savingsRateDelta',
        label: `Savings-rate change ${result.savingsRateDelta >= 0 ? '+' : ''}${(result.savingsRateDelta * 100).toFixed(1)}pp`,
      },
    ];

    return [
      baseInsight('lifestyle-inflation', snapshot, {
        severity: 'medium',
        headline: `The raise disappeared: income up ${pct(incomeGrowthRatio)}, savings rate flat`,
        reasoning: `Income grew about ${pct(
          incomeGrowthRatio,
        )} (roughly ${rupees(raiseMonthly)}/month more) but your savings rate barely moved (${
          result.savingsRateDelta >= 0 ? '+' : ''
        }${(result.savingsRateDelta * 100).toFixed(
          1,
        )}pp), against an earlier rate of about ${pct(
          earlySavingsRate,
        )}. Had the savings rate held, that raise alone should have added about ${rupees(
          raiseMonthly,
        )} x ${pct(earlySavingsRate)} x 12 months = ${rupees(
          shouldHaveSavedAnnual,
        )} a year to savings instead of spend.${
          movers.length > 0 ? ` The categories that absorbed it: ${movers.join(', ')}.` : ''
        } This is an inference from a short window, not a verdict — but it is the classic shape of lifestyle inflation, and it is worth deciding on purpose rather than by default.`,
        impact: { amountPaise: shouldHaveSavedAnnual, horizonMonths: 12 },
        confidence: 'medium',
        action: { label: 'Set category budgets', kind: 'set_budget' },
        evidence,
      }),
    ];
  },
};

// ---------------------------------------------------------------------------
// Budget overrun (mid-month pace)
// ---------------------------------------------------------------------------

function daysRemainingInMonth(asOf: string): { elapsed: number; remaining: number } {
  const asOfDate = new Date(asOf);
  const elapsed = asOfDate.getUTCDate();
  const daysInMonth = new Date(
    Date.UTC(asOfDate.getUTCFullYear(), asOfDate.getUTCMonth() + 1, 0),
  ).getUTCDate();
  return { elapsed, remaining: Math.max(daysInMonth - elapsed, 0) };
}

/**
 * Budgets on pace to be exceeded this month.
 *
 * A mid-month pace warning is only useful if it arrives in time to act on it, so this
 * states two things a warning that just says "you're over budget" doesn't: how many
 * days are left, and the daily spend from here that would still land inside the limit.
 * Silent when no budgets exist — nagging about a feature the user never configured
 * would just train them to ignore the feed.
 */
export const budgetOverrunRule: AdvisorRule = {
  id: 'budget-overrun',
  stage: 3,
  title: 'Budget pace',
  evaluate(snapshot) {
    if (snapshot.budgets.length === 0) return [];

    const statuses = spendingVelocity(snapshot.transactions, snapshot.budgets, snapshot.asOf).filter(
      (s) => s.willExceed,
    );
    if (statuses.length === 0) return [];

    const { remaining } = daysRemainingInMonth(snapshot.asOf);

    const totalOvershoot = sum(statuses.map((s) => subtract(s.projectedMonthEnd, s.limit)));
    if (totalOvershoot <= 0) return [];

    const maxPaceRatio = Math.max(...statuses.map((s) => s.paceRatio));
    const severity: InsightSeverity = maxPaceRatio >= 1.5 ? 'high' : maxPaceRatio >= 1.2 ? 'medium' : 'low';

    const lines = statuses.map((s) => {
      const remainingRoom = subtract(s.limit, s.spentSoFar);
      const dailyAllowance = remainingRoom > 0 && remaining > 0 ? scale(remainingRoom, 1 / remaining) : ZERO;
      const name = categoryName(snapshot.categories, s.categoryId);
      return remainingRoom > 0 && remaining > 0
        ? `${name}: on pace for ${rupees(s.projectedMonthEnd)} against a ${rupees(
            s.limit,
          )} limit (${pct(s.paceRatio, 0)} of budget) — stay under ${rupees(dailyAllowance)}/day for the ${remaining} day(s) left to land inside it`
        : `${name}: already at ${rupees(s.spentSoFar)} against a ${rupees(s.limit)} limit with ${remaining} day(s) left — no daily rate gets this back under budget this month`;
    });

    const evidence: EvidenceRef[] = statuses.map<EvidenceRef>((s) => ({
      kind: 'metric',
      id: s.categoryId,
      label: `${categoryName(snapshot.categories, s.categoryId)}: projected ${rupees(
        s.projectedMonthEnd,
      )} vs limit ${rupees(s.limit)}`,
    }));

    return [
      baseInsight('budget-overrun', snapshot, {
        severity,
        headline: `${statuses.length === 1 ? 'One budget is' : `${statuses.length} budgets are`} on pace to overshoot by ${rupees(
          totalOvershoot,
        )}`,
        reasoning: `${lines.join('; ')}. Projected overshoot across ${
          statuses.length === 1 ? 'this budget' : 'these budgets'
        } is ${rupees(totalOvershoot)} if the current pace holds to month end.`,
        impact: { amountPaise: totalOvershoot, horizonMonths: 1 },
        confidence: 'high',
        action: { label: 'Review budgets', kind: 'set_budget' },
        evidence,
      }),
    ];
  },
};

// ---------------------------------------------------------------------------
// Category spend spikes
// ---------------------------------------------------------------------------

/** How many of the highest-deviation spikes to name in one insight. */
const MAX_SPIKES_NAMED = 3;

/**
 * Category spend spikes: this month's spend in a category is a robust statistical
 * outlier against its own history (median + MAD z-score, computed in `detectCategoryAnomalies`).
 *
 * Deliberately conservative: a spike is very often a genuine one-off — an annual
 * insurance premium, a flight booked for a wedding — not a behaviour to correct. So
 * this is phrased as something to confirm, not a reprimand, confidence is capped at
 * `medium`, and only the highest-`deviationScore` few are named rather than every
 * category that moved. `'drop'` anomalies never fire here — spending less is not a leak.
 */
export const categorySpikeRule: AdvisorRule = {
  id: 'category-spike',
  stage: 3,
  title: 'Category spend spikes',
  evaluate(snapshot) {
    const spikes = detectCategoryAnomalies(snapshot.transactions, snapshot.categories, snapshot.asOf)
      .filter((a) => a.direction === 'spike')
      .slice(0, MAX_SPIKES_NAMED);
    if (spikes.length === 0) return [];

    const totalExcess = sum(spikes.map((a) => a.excessAmount));
    if (totalExcess <= 0) return [];

    const lines = spikes.map((a) => {
      const name = categoryName(snapshot.categories, a.categoryId);
      return `${name}: ${rupees(a.currentMonth)} this month against a typical ${rupees(
        a.baseline,
      )} (${rupees(a.excessAmount)} above normal)`;
    });

    const evidence: EvidenceRef[] = spikes.map<EvidenceRef>((a) => ({
      kind: 'metric',
      id: a.categoryId,
      label: `${categoryName(snapshot.categories, a.categoryId)}: ${rupees(a.currentMonth)} vs ${rupees(a.baseline)} typical`,
    }));

    return [
      baseInsight('category-spike', snapshot, {
        severity: 'medium',
        headline: `Worth a look: ${spikes.length === 1 ? 'one category is' : `${spikes.length} categories are`} well above its usual spend this month`,
        reasoning: `${lines.join(
          '; ',
        )}. This is a statistical flag, not an accusation — it could be a genuine one-off (an annual premium, a one-time booking) rather than a pattern. Worth a quick check against what actually happened; if it is a one-off there is nothing to fix, and if it isn't, catching it this month beats catching it in three.`,
        impact: { amountPaise: totalExcess, horizonMonths: 1 },
        confidence: 'medium',
        action: { label: 'Review these transactions', kind: 'review_transaction' },
        evidence,
      }),
    ];
  },
};

export const LEAK_RULES: AdvisorRule[] = [
  dormantSubscriptionsRule,
  feesAndPenaltiesRule,
  lifestyleInflationRule,
  budgetOverrunRule,
  categorySpikeRule,
];
