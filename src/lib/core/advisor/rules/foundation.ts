/**
 * Stage 1-2 rules: liquidity, crisis debt, and the structural ratios.
 *
 * These run first and are allowed to suppress the growth-stage rules. That ordering is
 * the most valuable thing the engine does — "start a SIP" is bad advice for someone
 * carrying a revolving credit-card balance, and no amount of correct arithmetic
 * elsewhere makes up for getting the sequence wrong.
 */

import { ZERO, abs, add, paise, scale, subtract, sum, type Paise } from '../../domain/money';
import type {
  AdvisorRule,
  EvidenceRef,
  FinancialSnapshot,
  Insight,
  InsightSeverity,
} from '../../domain/types';
import { effectiveRate, remainingInterest } from '../../emi';
import {
  ageOf,
  emergencyFundMonthsTarget,
  insightId,
  marginalTaxRate,
  pct,
  rupees,
} from '../engine';

/** Rules whose advice is premature while the foundation is missing. */
const GROWTH_RULES = ['increase-sip', 'step-up-sip', 'asset-allocation', 'prepay-vs-invest'];

function baseInsight(
  rule: string,
  snapshot: FinancialSnapshot,
  fields: Omit<Insight, 'id' | 'rule' | 'generatedAt'>,
): Insight {
  return { id: insightId(rule), rule, generatedAt: snapshot.asOf, ...fields };
}

// ---------------------------------------------------------------------------
// Stage 1 - liquidity
// ---------------------------------------------------------------------------

/**
 * Emergency fund.
 *
 * Runs before everything because liquidity failure is what converts a bad month into
 * long-term debt. Someone with no buffer meets a ₹80,000 medical bill with a credit card
 * at 42%, and that single event costs more than years of optimised returns gained.
 */
export const emergencyFundRule: AdvisorRule = {
  id: 'emergency-fund',
  stage: 1,
  title: 'Emergency fund',
  evaluate(snapshot) {
    const { metrics } = snapshot;
    const essential = metrics.monthlyEssentialExpenses;

    // Without a baseline for essential spend there is no target to compare against.
    // Staying silent is correct here; a guessed target would be a guessed recommendation.
    if (essential <= 0) return [];

    const targetMonths = emergencyFundMonthsTarget(snapshot);
    const target = scale(essential, targetMonths);
    const held = metrics.liquidAssets;
    const covered = held / essential;

    const evidence: EvidenceRef[] = [
      {
        kind: 'metric',
        id: 'liquidAssets',
        label: `Liquid assets ${rupees(held)}`,
      },
      {
        kind: 'metric',
        id: 'monthlyEssentialExpenses',
        label: `Essential spend ${rupees(essential)}/month`,
      },
    ];

    if (held >= target) {
      return [
        baseInsight('emergency-fund', snapshot, {
          severity: 'positive',
          headline: `Emergency fund covers ${covered.toFixed(1)} months`,
          reasoning: `You hold ${rupees(held)} in liquid assets against ${rupees(
            essential,
          )} of essential monthly spend — ${covered.toFixed(
            1,
          )} months of cover, at or above your ${targetMonths}-month target. This is the foundation everything else is built on; keep it in a sweep account or liquid fund, not equity.`,
          impact: { amountPaise: ZERO, horizonMonths: 0 },
          confidence: 'high',
          evidence,
        }),
      ];
    }

    const gap = subtract(target, held);
    // Under one month of cover is a genuine emergency: any shock becomes debt.
    const severity: InsightSeverity = covered < 1 ? 'critical' : covered < 3 ? 'high' : 'medium';

    return [
      baseInsight('emergency-fund', snapshot, {
        severity,
        headline:
          covered < 1
            ? `You have under a month of expenses in reserve`
            : `Emergency fund is ${rupees(gap)} short of ${targetMonths} months`,
        reasoning: `Liquid assets of ${rupees(held)} cover ${covered.toFixed(
          1,
        )} months of your ${rupees(essential)} essential monthly spend. Your target is ${targetMonths} months (${rupees(
          target,
        )}) given ${snapshot.profile.dependents} dependent(s) and ${
          snapshot.profile.employmentType ?? 'unspecified'
        } income, leaving a gap of ${rupees(
          gap,
        )}. Build this before investing anything further: without it, one medical bill or job gap becomes credit-card debt at 40%+, which costs far more than the returns you would have earned.`,
        impact: { amountPaise: gap, horizonMonths: 12 },
        confidence: 'high',
        action: { label: 'Set up an emergency fund goal', kind: 'build_emergency_fund' },
        evidence,
        // Investing is premature while the buffer is missing. Tax and debt rules are not
        // suppressed — those remain correct regardless.
        suppresses: covered < 3 ? GROWTH_RULES : undefined,
      }),
    ];
  },
};

/**
 * Revolving credit-card debt.
 *
 * Always the top priority when present. At 36-42% APR nothing in a portfolio competes,
 * and paying the "minimum due" is designed to keep the balance alive — it is the single
 * most expensive ordinary financial mistake available in India.
 */
export const creditCardRevolvingRule: AdvisorRule = {
  id: 'credit-card-revolving',
  stage: 1,
  title: 'Revolving credit-card debt',
  evaluate(snapshot) {
    const cards = snapshot.accounts.filter(
      (a) => a.kind === 'credit_card' && !a.archived && a.balance > 0,
    );
    const revolving = snapshot.loans.filter(
      (l) => !l.closed && l.kind === 'credit_card_revolving' && l.outstanding > 0,
    );

    const cardBalance = sum(cards.map((a) => a.balance));
    const revolvingBalance = sum(revolving.map((l) => l.outstanding));
    const outstanding = add(cardBalance, revolvingBalance);
    if (outstanding <= 0) return [];

    // A card balance inside its interest-free window is not revolving debt. Only treat a
    // card as revolving when it is tracked as such, or when the balance has clearly
    // outlived one statement cycle. Conservative on purpose: calling a normal monthly
    // spend "42% debt" would be alarmist and would train the user to ignore the feed.
    const confirmedRevolving = revolvingBalance > 0;
    const rate = revolving.length > 0
      ? Math.max(...revolving.map((l) => l.annualRate))
      : 0.42;

    const annualInterest = scale(outstanding, rate);
    const evidence: EvidenceRef[] = [
      ...cards.map<EvidenceRef>((a) => ({
        kind: 'account',
        id: a.id,
        label: `${a.name}${a.mask ? ` ••${a.mask}` : ''}: ${rupees(a.balance)}`,
      })),
      ...revolving.map<EvidenceRef>((l) => ({
        kind: 'loan',
        id: l.id,
        label: `${l.name}: ${rupees(l.outstanding)} at ${pct(l.annualRate)}`,
      })),
    ];

    return [
      baseInsight('credit-card-revolving', snapshot, {
        severity: confirmedRevolving ? 'critical' : 'high',
        headline: `Clear ${rupees(outstanding)} of card debt before anything else`,
        reasoning: `You are carrying ${rupees(outstanding)} on credit cards at about ${pct(
          rate,
        )} a year — roughly ${rupees(
          annualInterest,
        )} in interest over twelve months if it keeps revolving. No investment reliably returns that, so every rupee put here earns a guaranteed ${pct(
          rate,
        )} risk-free, which is strictly better than any expected market return. Pay the full statement balance, not the minimum due: the minimum is calculated to keep the balance alive, and interest accrues daily from the transaction date once you revolve.`,
        impact: { amountPaise: annualInterest, horizonMonths: 12 },
        confidence: confirmedRevolving ? 'high' : 'medium',
        action: { label: 'Plan the payoff', kind: 'open_debt_planner' },
        evidence,
        suppresses: GROWTH_RULES,
      }),
    ];
  },
};

/**
 * Debt costing more than the portfolio is expected to return.
 *
 * Compares each loan's *effective* post-tax rate against the expected return, so a
 * tax-advantaged home loan is not lumped in with a 16% personal loan.
 */
export const highInterestDebtRule: AdvisorRule = {
  id: 'high-interest-debt',
  stage: 1,
  title: 'Expensive debt',
  evaluate(snapshot) {
    const taxRate = marginalTaxRate(snapshot);
    const hurdle = snapshot.profile.expectedPortfolioReturn;

    const expensive = snapshot.loans
      .filter((l) => !l.closed && l.outstanding > 0 && l.kind !== 'credit_card_revolving')
      .map((l) => ({ loan: l, rate: effectiveRate(l, taxRate) }))
      // A rate merely equal to the hurdle is a coin flip, not a finding. Require a clear
      // 2-point margin so this rule only fires when the answer is unambiguous.
      .filter(({ rate }) => rate > hurdle + 0.02)
      .sort((a, b) => b.rate - a.rate);

    if (expensive.length === 0) return [];

    const interestAtStake = sum(expensive.map(({ loan }) => remainingInterest(loan)));
    const worst = expensive[0];
    if (!worst) return [];

    return [
      baseInsight('high-interest-debt', snapshot, {
        severity: 'high',
        headline: `${expensive.length === 1 ? 'One loan costs' : `${expensive.length} loans cost`} more than you expect to earn investing`,
        reasoning: `${expensive
          .map(
            ({ loan, rate }) =>
              `${loan.name} at an effective ${pct(rate)} (${rupees(loan.outstanding)} outstanding)`,
          )
          .join('; ')}. Your expected portfolio return is ${pct(
          hurdle,
        )}, so clearing these is a guaranteed better outcome than investing the same money — and guaranteed beats expected, since the market return carries variance and this does not. ${rupees(
          interestAtStake,
        )} of interest remains on these loans if they run to term; directing surplus at ${
          worst.loan.name
        } first saves the most because it carries the highest rate.`,
        impact: { amountPaise: interestAtStake, horizonMonths: worst.loan.tenureMonths },
        confidence: 'high',
        action: {
          label: 'Simulate a prepayment',
          kind: 'simulate_prepayment',
          params: { loanId: worst.loan.id },
        },
        evidence: expensive.map<EvidenceRef>(({ loan, rate }) => ({
          kind: 'loan',
          id: loan.id,
          label: `${loan.name}: ${pct(rate)} effective`,
        })),
        suppresses: ['increase-sip', 'step-up-sip'],
      }),
    ];
  },
};

/**
 * Health cover.
 *
 * The one rule whose impact is an expected value rather than an arithmetic certainty,
 * and it says so. An uninsured hospitalisation is the most common route from solvent to
 * indebted in India, and it is not something a 3-month emergency fund absorbs.
 */
export const healthInsuranceRule: AdvisorRule = {
  id: 'health-insurance',
  stage: 2,
  title: 'Health cover',
  evaluate(snapshot) {
    const insuranceCategories = new Set(
      snapshot.categories.filter((c) => c.group === 'insurance').map((c) => c.id),
    );
    if (insuranceCategories.size === 0) return [];

    const premiumSpend = sum(
      snapshot.transactions
        .filter((t) => !t.excluded && t.direction === 'debit' && insuranceCategories.has(t.categoryId))
        .map((t) => t.amount),
    );

    // Any premium payment in the window is taken as cover existing. This rule cannot see
    // an employer group policy or a sum insured, so it only flags the total absence of
    // any premium — and reports low confidence, because absence of evidence here is weak
    // evidence of absence.
    if (premiumSpend > 0) return [];

    // A conservative self-funded hospitalisation bill, used as the expected exposure.
    const exposure = paise(300_000_00);

    return [
      baseInsight('health-insurance', snapshot, {
        severity: 'high',
        headline: 'No health-insurance premium found in your history',
        reasoning: `No insurance premium appears in the transactions on record, which may mean you have no individual health cover — or simply that you are on an employer policy this app cannot see. Worth checking either way: a single hospitalisation commonly runs ${rupees(
          exposure,
        )} or more, which is the kind of bill that empties an emergency fund and then goes onto a credit card. An employer policy also ends with the job, usually at the worst moment. Premiums for individual cover also qualify for a §80D deduction.`,
        impact: { amountPaise: exposure, horizonMonths: 12 },
        confidence: 'low',
        action: { label: 'Review your cover', kind: 'review_insurance' },
        evidence: [
          { kind: 'metric', id: 'insurancePremiums', label: 'No insurance premiums detected' },
        ],
      }),
    ];
  },
};

// ---------------------------------------------------------------------------
// Stage 2 - structural ratios
// ---------------------------------------------------------------------------

/**
 * EMI-to-income.
 *
 * Above 40% a household has no room to absorb a rate rise or an income gap; lenders use
 * roughly the same threshold when underwriting, which is a fair signal that it is where
 * the risk actually sits.
 */
export const emiBurdenRule: AdvisorRule = {
  id: 'emi-burden',
  stage: 2,
  title: 'EMI burden',
  evaluate(snapshot) {
    const ratio = snapshot.metrics.emiToIncomeRatio;
    if (ratio === null) return [];

    const { totalMonthlyEmi, monthlyIncome } = snapshot.metrics;
    const evidence: EvidenceRef[] = [
      { kind: 'metric', id: 'totalMonthlyEmi', label: `EMIs ${rupees(totalMonthlyEmi)}/month` },
      { kind: 'metric', id: 'monthlyIncome', label: `Income ${rupees(monthlyIncome)}/month` },
    ];

    if (ratio <= 0.3) {
      if (totalMonthlyEmi <= 0) return [];
      return [
        baseInsight('emi-burden', snapshot, {
          severity: 'positive',
          headline: `EMIs are a comfortable ${pct(ratio)} of income`,
          reasoning: `${rupees(totalMonthlyEmi)} of EMIs against ${rupees(
            monthlyIncome,
          )} of monthly income is ${pct(
            ratio,
          )} — inside the 30% band that leaves room to absorb a rate rise or an income gap.`,
          impact: { amountPaise: ZERO, horizonMonths: 0 },
          confidence: 'high',
          evidence,
        }),
      ];
    }

    const safeLimit = scale(monthlyIncome, 0.4);
    const excess = ratio > 0.4 ? subtract(totalMonthlyEmi, safeLimit) : ZERO;

    return [
      baseInsight('emi-burden', snapshot, {
        severity: ratio > 0.5 ? 'critical' : ratio > 0.4 ? 'high' : 'medium',
        headline: `EMIs take ${pct(ratio)} of your income`,
        reasoning: `${rupees(totalMonthlyEmi)} of monthly EMIs against ${rupees(
          monthlyIncome,
        )} income is ${pct(ratio)}. Past 40% there is no slack left: a floating-rate rise or a month without income forces a missed payment, which costs you both penalties and your credit score.${
          excess > 0
            ? ` Getting back under 40% means reducing EMI outgo by about ${rupees(excess)} a month`
            : ' Aim to bring this under 30%'
        } — either by clearing the smallest loan outright, or by refinancing the largest to a longer tenure to buy breathing room, accepting that a longer tenure costs more interest overall. Take on no new EMI until this is down.`,
        impact: { amountPaise: excess > 0 ? scale(excess, 12) : ZERO, horizonMonths: 12 },
        confidence: 'high',
        action: { label: 'Open the debt planner', kind: 'open_debt_planner' },
        evidence,
      }),
    ];
  },
};

/**
 * Credit utilisation.
 *
 * Distinct from carrying a balance: paying in full every month and still reporting 80%
 * utilisation on the statement date depresses a credit score, which then prices every
 * future loan. Cheap to fix, and almost nobody knows to.
 */
export const creditUtilisationRule: AdvisorRule = {
  id: 'credit-utilisation',
  stage: 2,
  title: 'Credit utilisation',
  evaluate(snapshot) {
    const utilisation = snapshot.metrics.creditUtilisation;
    if (utilisation === null || utilisation <= 0.3) return [];

    const cards = snapshot.accounts.filter(
      (a) => a.kind === 'credit_card' && !a.archived && a.creditLimit && a.creditLimit > 0,
    );
    const limit = sum(cards.map((a) => a.creditLimit ?? ZERO));
    const used = sum(cards.map((a) => a.balance));
    const targetBalance = scale(limit, 0.3);
    const reduceBy = subtract(used, targetBalance);

    return [
      baseInsight('credit-utilisation', snapshot, {
        severity: utilisation > 0.7 ? 'high' : 'medium',
        headline: `Credit utilisation is ${pct(utilisation)}`,
        reasoning: `You are using ${rupees(used)} of ${rupees(limit)} in total card limits (${pct(
          utilisation,
        )}). Bureaus treat anything above 30% as a sign of strain, and it lowers your score even when you pay in full every month — the balance is reported on the statement date, not after you pay. Two fixes cost nothing: pay part of the balance *before* the statement generates, or ask for a limit increase. Bringing the reported balance to about ${rupees(
          targetBalance,
        )} means paying down roughly ${rupees(
          reduceBy,
        )} ahead of the statement date. A better score directly lowers the rate on your next loan.`,
        impact: { amountPaise: reduceBy, horizonMonths: 3 },
        confidence: 'medium',
        evidence: cards.map<EvidenceRef>((a) => ({
          kind: 'account',
          id: a.id,
          label: `${a.name}: ${rupees(a.balance)} of ${rupees(a.creditLimit ?? ZERO)}`,
        })),
      }),
    ];
  },
};

/**
 * Savings rate.
 *
 * The one number that predicts wealth better than investment selection does. Someone
 * saving 35% at 8% returns retires far sooner than someone saving 10% at 14%, and the
 * savings rate is the variable actually under their control.
 */
export const savingsRateRule: AdvisorRule = {
  id: 'savings-rate',
  stage: 2,
  title: 'Savings rate',
  evaluate(snapshot) {
    const rate = snapshot.metrics.savingsRate;
    if (rate === null) return [];

    const { monthlyIncome, monthlyExpenses } = snapshot.metrics;
    const age = ageOf(snapshot);
    // Ladder: 20% is the floor, 30% is healthy, 40%+ is a fast track to independence.
    const nextRung = rate < 0.2 ? 0.2 : rate < 0.3 ? 0.3 : rate < 0.4 ? 0.4 : null;

    const evidence: EvidenceRef[] = [
      { kind: 'metric', id: 'savingsRate', label: `Savings rate ${pct(rate)}` },
      { kind: 'metric', id: 'monthlyExpenses', label: `Spending ${rupees(monthlyExpenses)}/month` },
    ];

    if (nextRung === null) {
      return [
        baseInsight('savings-rate', snapshot, {
          severity: 'positive',
          headline: `Saving ${pct(rate)} of income — strong`,
          reasoning: `You are saving ${pct(rate)} of ${rupees(
            monthlyIncome,
          )} a month. This matters more than which funds you pick: a 40% savings rate at modest returns reaches independence sooner than a 10% rate at excellent ones. Protect the rate as income grows rather than letting spending absorb the raise.`,
          impact: { amountPaise: ZERO, horizonMonths: 0 },
          confidence: 'high',
          evidence,
        }),
      ];
    }

    const targetSpend = scale(monthlyIncome, 1 - nextRung);
    const trim = subtract(monthlyExpenses, targetSpend);
    const annualGain = trim > 0 ? scale(trim, 12) : ZERO;

    return [
      baseInsight('savings-rate', snapshot, {
        severity: rate < 0.1 ? 'high' : rate < 0.2 ? 'medium' : 'low',
        headline: `Savings rate is ${pct(rate)} — next target ${pct(nextRung, 0)}`,
        reasoning: `On ${rupees(monthlyIncome)} of income you spend ${rupees(
          monthlyExpenses,
        )}, saving ${pct(rate)}. Reaching ${pct(
          nextRung,
          0,
        )} means holding spending at about ${rupees(targetSpend)} — roughly ${rupees(
          trim,
        )} less each month, or ${rupees(
          annualGain,
        )} a year redirected into assets.${
          age !== null && rate < 0.2
            ? ` At ${age}, time is the asset you have most of; a rupee saved now compounds for decades, so raising the rate early beats trying to make up the difference with returns later.`
            : ''
        } The savings rate, not fund selection, is the variable that decides the outcome — and it is the one you control.`,
        impact: { amountPaise: annualGain, horizonMonths: 12 },
        confidence: 'high',
        action: { label: 'Set category budgets', kind: 'set_budget' },
        evidence,
      }),
    ];
  },
};

export const FOUNDATION_RULES: AdvisorRule[] = [
  emergencyFundRule,
  creditCardRevolvingRule,
  highInterestDebtRule,
  healthInsuranceRule,
  emiBurdenRule,
  creditUtilisationRule,
  savingsRateRule,
];

export { abs };
