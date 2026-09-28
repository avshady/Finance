/**
 * The advisor engine.
 *
 * Rules are pure functions of a `FinancialSnapshot`. The engine runs them in doctrine
 * order, lets earlier stages suppress later ones, and ranks what survives by the rupees
 * it is worth.
 *
 * Two properties make this trustworthy, and both are enforced here rather than left to
 * each rule's good intentions:
 *
 * 1. **Sequencing.** Advice order is not cosmetic, it is most of the value. Telling
 *    someone to start a SIP while they carry a 42% credit-card balance is actively
 *    harmful advice, and it is the single most common failure of automated finance tools.
 *    Stage 1 rules can suppress stage 4 rules, so the engine physically cannot emit
 *    "invest more" above "clear this card".
 *
 * 2. **Ranking by impact, not recency.** A ₹40,000/year interest leak outranks a ₹300
 *    subscription no matter which was noticed today.
 */

import { ZERO, type Paise } from '../domain/money';
import type { AdvisorRule, FinancialSnapshot, Insight, InsightSeverity } from '../domain/types';

/** Ordering weight for severity. Ties are then broken by rupee impact. */
const SEVERITY_WEIGHT: Record<InsightSeverity, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
  positive: 0,
};

export interface AdviceResult {
  insights: Insight[];
  /** Insights a higher-priority rule withheld, kept for transparency in the UI. */
  suppressed: Array<{ insight: Insight; suppressedBy: string }>;
  /** Total quantified opportunity across surfaced insights. */
  totalOpportunity: Paise;
  /** Rules that threw, so one bad rule cannot blank the whole advice feed. */
  errors: Array<{ rule: string; message: string }>;
}

export interface EngineOptions {
  /** Restrict to these rule ids. Used by tests and by the per-screen advice panels. */
  only?: string[];
  /** Cap the surfaced list. Unlimited when omitted. */
  limit?: number;
}

/**
 * Run the rule set over a snapshot.
 *
 * Each rule is wrapped: a rule that throws is recorded and skipped rather than taking
 * the feed down with it. An advice screen that renders nothing because one edge case
 * divided by zero is worse than one that renders nine of ten insights.
 */
export function generateAdvice(
  snapshot: FinancialSnapshot,
  rules: AdvisorRule[],
  options: EngineOptions = {},
): AdviceResult {
  const active = options.only ? rules.filter((r) => options.only!.includes(r.id)) : rules;
  const ordered = [...active].sort((a, b) => a.stage - b.stage);

  const produced: Insight[] = [];
  const errors: AdviceResult['errors'] = [];

  for (const rule of ordered) {
    try {
      produced.push(...rule.evaluate(snapshot));
    } catch (error) {
      errors.push({
        rule: rule.id,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Suppression: an insight naming a rule in `suppresses` withholds that rule's output.
  // Only rules from an earlier or equal stage may suppress, so a stage-4 rule cannot
  // silence the stage-1 warning that outranks it.
  const stageOf = new Map(rules.map((r) => [r.id, r.stage] as const));
  const suppressors = new Map<string, string>();
  for (const insight of produced) {
    const ownStage = stageOf.get(insight.rule) ?? 5;
    for (const target of insight.suppresses ?? []) {
      const targetStage = stageOf.get(target) ?? 5;
      if (ownStage <= targetStage && !suppressors.has(target)) {
        suppressors.set(target, insight.rule);
      }
    }
  }

  const surfaced: Insight[] = [];
  const suppressed: AdviceResult['suppressed'] = [];
  for (const insight of produced) {
    const by = suppressors.get(insight.rule);
    if (by && by !== insight.rule) suppressed.push({ insight, suppressedBy: by });
    else surfaced.push(insight);
  }

  surfaced.sort(compareInsights);

  const limited = options.limit === undefined ? surfaced : surfaced.slice(0, options.limit);

  return {
    insights: limited,
    suppressed,
    totalOpportunity: limited.reduce<Paise>(
      (acc, i) => (acc + (i.severity === 'positive' ? 0 : i.impact.amountPaise)) as Paise,
      ZERO,
    ),
    errors,
  };
}

/**
 * Severity first, then rupee impact.
 *
 * Severity leads rather than raw impact because a ₹50,000 credit-card balance at 42% is
 * more urgent than a ₹2,00,000 tax-planning opportunity even though the tax number is
 * bigger: one compounds against the user every month it is ignored, the other waits
 * until March. Within a severity band, money decides.
 */
function compareInsights(a: Insight, b: Insight): number {
  const bySeverity = SEVERITY_WEIGHT[b.severity] - SEVERITY_WEIGHT[a.severity];
  if (bySeverity !== 0) return bySeverity;
  return b.impact.amountPaise - a.impact.amountPaise;
}

// ---------------------------------------------------------------------------
// Helpers shared by rules
// ---------------------------------------------------------------------------

let counter = 0;

/** Deterministic-enough insight id, stable within a run. */
export function insightId(rule: string): string {
  counter += 1;
  return `${rule}#${counter}`;
}

export function resetInsightIds(): void {
  counter = 0;
}

/** Format paise as compact Indian rupees for insight prose. */
export function rupees(amount: Paise): string {
  const value = Math.abs(amount) / 100;
  const sign = amount < 0 ? '-' : '';
  if (value >= 1_00_00_000) return `${sign}₹${(value / 1_00_00_000).toFixed(2)} Cr`;
  if (value >= 1_00_000) return `${sign}₹${(value / 1_00_000).toFixed(2)} L`;
  return `${sign}₹${Math.round(value).toLocaleString('en-IN')}`;
}

export function pct(value: number, digits = 1): string {
  return `${(value * 100).toFixed(digits)}%`;
}

/** Marginal income-tax rate implied by annual income under the old regime slabs. */
export function marginalTaxRate(snapshot: FinancialSnapshot): number {
  if (snapshot.profile.taxRegime === 'new') {
    // Most interest and investment deductions do not exist under the new regime, so the
    // rules that net tax relief off a cost must be given zero here, not the slab rate.
    return 0;
  }
  const annual = snapshot.metrics.monthlyIncome * 12;
  const lakh = annual / 100 / 100_000;
  if (lakh > 15) return 0.3;
  if (lakh > 10) return 0.2;
  if (lakh > 5) return 0.05;
  return 0;
}

/** Age in years, or null when the profile has no date of birth. */
export function ageOf(snapshot: FinancialSnapshot): number | null {
  const dob = snapshot.profile.dateOfBirth;
  if (!dob) return null;
  const then = new Date(dob);
  const now = new Date(snapshot.asOf);
  let age = now.getUTCFullYear() - then.getUTCFullYear();
  const monthDelta = now.getUTCMonth() - then.getUTCMonth();
  if (monthDelta < 0 || (monthDelta === 0 && now.getUTCDate() < then.getUTCDate())) age -= 1;
  return age >= 0 && age < 120 ? age : null;
}

/**
 * Emergency-fund target in months of essential spend.
 *
 * Six months is the usual advice, but it is not one number for everyone: dependents and
 * unstable income both raise the floor. A freelancer with two dependents needs nine
 * months; a salaried person with none can defend four.
 */
export function emergencyFundMonthsTarget(snapshot: FinancialSnapshot): number {
  const { dependents, employmentType } = snapshot.profile;
  let months = 6;
  if (employmentType === 'salaried') months -= 1;
  if (employmentType === 'self_employed' || employmentType === 'freelance' || employmentType === 'business') {
    months += 2;
  }
  if (dependents >= 1) months += 1;
  if (dependents >= 3) months += 1;
  return Math.min(Math.max(months, 3), 12);
}
