/**
 * Stage 4-5 rules: growth, tax efficiency, and the long horizon.
 *
 * These are suppressed by the foundation rules when the basics are missing, which is the
 * point — this is the advice that only makes sense once there is a buffer and no
 * expensive debt.
 */

import { ZERO, add, paise, scale, subtract, sum, type Paise } from '../../domain/money';
import type {
  AdvisorRule,
  EvidenceRef,
  FinancialSnapshot,
  Insight,
} from '../../domain/types';
import { compareStrategies, prepayVsInvest } from '../../emi';
import {
  assessGoal,
  fiNumber,
  futureValueSip,
  projectFi,
  realReturn,
  suggestAllocation,
} from '../../wealth';
import { ageOf, insightId, marginalTaxRate, pct, rupees } from '../engine';

function baseInsight(
  rule: string,
  snapshot: FinancialSnapshot,
  fields: Omit<Insight, 'id' | 'rule' | 'generatedAt'>,
): Insight {
  return { id: insightId(rule), rule, generatedAt: snapshot.asOf, ...fields };
}

/** Monthly surplus available to direct at debt or investments. */
function monthlySurplus(snapshot: FinancialSnapshot): Paise {
  const { monthlyIncome, monthlyExpenses } = snapshot.metrics;
  const surplus = subtract(monthlyIncome, monthlyExpenses);
  return surplus > 0 ? surplus : ZERO;
}

// ---------------------------------------------------------------------------
// Stage 4 - optimisation
// ---------------------------------------------------------------------------

/**
 * Prepay or invest.
 *
 * The question this app exists to answer correctly. Most tools compare the loan's
 * headline rate against expected equity returns and conclude "prepay", which is wrong for
 * exactly the loans people hold most of: a home loan at 8.6% with §24(b) relief at a 30%
 * slab really costs about 7.4%, below a realistic equity expectation. Prepaying it
 * converts a cheap, tax-subsidised, inflation-eroding liability into forgone compounding.
 *
 * So this rule runs the comparison on *effective* post-tax rates, charges capital-gains
 * tax to the investing side too, and reports "neutral" inside a 2-point band rather than
 * pretending to certainty it does not have.
 */
export const prepayVsInvestRule: AdvisorRule = {
  id: 'prepay-vs-invest',
  stage: 4,
  title: 'Prepay or invest',
  evaluate(snapshot) {
    const surplus = monthlySurplus(snapshot);
    if (surplus <= 0) return [];

    const candidates = snapshot.loans.filter(
      (l) => !l.closed && l.outstanding > 0 && l.kind !== 'credit_card_revolving',
    );
    if (candidates.length === 0) return [];

    const taxRate = marginalTaxRate(snapshot);
    // Judge the decision on a year of surplus, which is the scale at which someone
    // actually makes it — not on one month, and not on a lump sum they do not have.
    const amount = scale(surplus, 12);

    const results = candidates
      .map((loan) =>
        prepayVsInvest({
          loan,
          amount: paise(Math.min(amount, loan.outstanding)),
          expectedReturn: snapshot.profile.expectedPortfolioReturn,
          marginalTaxRate: taxRate,
        }),
      )
      .sort((a, b) => b.advantage - a.advantage);

    const top = results[0];
    if (!top) return [];
    const loan = candidates.find((l) => l.id === top.loanId);
    if (!loan) return [];

    // Below a rupee of difference there is nothing to recommend.
    if (top.advantage <= 0) return [];

    const reliefNote =
      top.effectiveLoanRate < loan.annualRate - 1e-9
        ? ` Note the gap between the headline ${pct(loan.annualRate)} and the ${pct(
            top.effectiveLoanRate,
          )} it actually costs you after ${
            loan.taxBenefit?.section === '80E' ? '§80E' : '§24(b)'
          } relief — that difference is why the naive "always prepay" answer is wrong here.`
        : '';

    return [
      baseInsight('prepay-vs-invest', snapshot, {
        severity: top.verdict === 'neutral' ? 'low' : 'medium',
        headline:
          top.verdict === 'prepay'
            ? `Put your surplus into ${loan.name}, not the market`
            : top.verdict === 'invest'
              ? `Invest your surplus rather than prepaying ${loan.name}`
              : `Prepaying ${loan.name} and investing are close to equivalent`,
        reasoning: `${top.reasoning} Over the remaining life of the loan, ${rupees(
          amount,
        )} of surplus is worth ${rupees(top.prepayValue)} if put against the loan and ${rupees(
          top.investValue,
        )} if invested and taxed at ${pct(0.125, 1)} on gains — a difference of ${rupees(
          top.advantage,
        )}.${reliefNote}`,
        impact: { amountPaise: top.advantage, horizonMonths: loan.tenureMonths },
        confidence: top.verdict === 'neutral' ? 'medium' : 'high',
        action: {
          label: 'Simulate it',
          kind: 'simulate_prepayment',
          params: { loanId: loan.id, amount },
        },
        evidence: [
          {
            kind: 'loan',
            id: loan.id,
            label: `${loan.name}: ${pct(loan.annualRate)} nominal, ${pct(
              top.effectiveLoanRate,
            )} effective`,
          },
          {
            kind: 'metric',
            id: 'surplus',
            label: `Monthly surplus ${rupees(surplus)}`,
          },
        ],
      }),
    ];
  },
};

/**
 * Payoff order across several loans.
 *
 * Only fires with two or more loans, because with one there is no order to choose. Prices
 * snowball against avalanche rather than dictating: the arithmetically optimal plan that
 * gets abandoned in month three returns nothing.
 */
export const payoffOrderRule: AdvisorRule = {
  id: 'payoff-order',
  stage: 4,
  title: 'Debt payoff order',
  evaluate(snapshot) {
    const loans = snapshot.loans.filter((l) => !l.closed && l.outstanding > 0);
    if (loans.length < 2) return [];

    const surplus = monthlySurplus(snapshot);
    const comparison = compareStrategies(loans, surplus);
    const plan =
      comparison.recommendation === 'avalanche' ? comparison.avalanche : comparison.snowball;
    if (plan.steps.length === 0) return [];

    const first = plan.steps[0];
    if (!first) return [];

    const years = Math.floor(plan.debtFreeInMonths / 12);
    const months = plan.debtFreeInMonths % 12;

    return [
      baseInsight('payoff-order', snapshot, {
        severity: 'medium',
        headline: `Debt-free in ${years > 0 ? `${years}y ` : ''}${months}m by paying ${first.loanName} first`,
        reasoning: `${comparison.reasoning} With ${rupees(
          surplus,
        )} of monthly surplus on top of your minimums, the ${
          comparison.recommendation
        } order clears ${first.loanName} in month ${
          first.clearedInMonth
        } and everything by month ${
          plan.debtFreeInMonths
        }, paying ${rupees(
          plan.totalInterest,
        )} of interest along the way. Each loan that closes frees its EMI into the next one, so the last loans clear far faster than their schedules suggest — which is why order matters at all.`,
        impact: { amountPaise: comparison.snowballExtraCost, horizonMonths: plan.debtFreeInMonths },
        confidence: 'high',
        action: { label: 'Open the debt planner', kind: 'open_debt_planner' },
        evidence: plan.steps.map<EvidenceRef>((step) => ({
          kind: 'loan',
          id: step.loanId,
          label: `${step.loanName}: cleared month ${step.clearedInMonth}`,
        })),
      }),
    ];
  },
};

/**
 * Unused §80C / §80D / NPS headroom.
 *
 * A deduction left unclaimed is the cheapest return available — an instant saving at the
 * marginal slab rate, with no market risk. Fires only under the old regime, where these
 * deductions exist; under the new regime the rule correctly stays silent instead of
 * recommending something that would not apply.
 */
export const taxOptimisationRule: AdvisorRule = {
  id: 'tax-optimisation',
  stage: 4,
  title: 'Tax deductions',
  evaluate(snapshot) {
    if (snapshot.profile.taxRegime !== 'old') return [];

    const slab = marginalTaxRate(snapshot);
    if (slab <= 0) return [];

    const declared = snapshot.profile.taxDeclarations ?? {};
    const caps = {
      section80C: paise(150_000_00),
      section80D: paise(25_000_00),
      nps80CCD1B: paise(50_000_00),
    } as const;

    const gaps = (
      [
        ['§80C', 'section80C', caps.section80C, 'EPF, ELSS, PPF, term insurance premium, home-loan principal'],
        ['§80D', 'section80D', caps.section80D, 'health-insurance premium for you and your family'],
        ['§80CCD(1B)', 'nps80CCD1B', caps.nps80CCD1B, 'NPS, over and above the §80C limit'],
      ] as const
    )
      .map(([label, key, cap, examples]) => {
        const used = declared[key] ?? ZERO;
        return { label, gap: subtract(cap, used) > 0 ? subtract(cap, used) : ZERO, cap, used, examples };
      })
      .filter((g) => g.gap > 0);

    if (gaps.length === 0) return [];

    const totalGap = sum(gaps.map((g) => g.gap));
    const taxSaved = scale(totalGap, slab);

    return [
      baseInsight('tax-optimisation', snapshot, {
        severity: 'medium',
        headline: `${rupees(taxSaved)} of tax is avoidable this year`,
        reasoning: `At a ${pct(
          slab,
          0,
        )} marginal rate you have ${rupees(totalGap)} of unused deduction headroom: ${gaps
          .map((g) => `${g.label} — ${rupees(g.gap)} left (${g.examples})`)
          .join('; ')}. Claiming it saves ${rupees(
          taxSaved,
        )} outright, which is a certain return no investment matches. Two cautions: do not buy a product you would not otherwise want purely for the deduction — an endowment policy bought for §80C typically returns 4-5%, so the tax saved is paid back several times over in forgone returns. ELSS, NPS and your existing EPF contribution are the efficient routes. And claim it before the financial year closes in March; unused headroom does not carry forward.`,
        impact: { amountPaise: taxSaved, horizonMonths: 12 },
        confidence: 'medium',
        action: { label: 'Review deductions', kind: 'optimise_tax' },
        evidence: gaps.map<EvidenceRef>((g) => ({
          kind: 'metric',
          id: g.label,
          label: `${g.label}: ${rupees(g.used)} of ${rupees(g.cap)} used`,
        })),
      }),
    ];
  },
};

/**
 * Asset allocation.
 *
 * Deliberately low-severity: allocation matters, but far less than the savings rate, and
 * this rule cannot see holdings in detail. It suggests a target and explains the
 * reasoning rather than claiming the current split is wrong.
 */
export const assetAllocationRule: AdvisorRule = {
  id: 'asset-allocation',
  stage: 4,
  title: 'Asset allocation',
  evaluate(snapshot) {
    const age = ageOf(snapshot);
    if (age === null) {
      return [
        baseInsight('asset-allocation', snapshot, {
          severity: 'low',
          headline: 'Add your date of birth for allocation and retirement advice',
          reasoning:
            'Asset allocation, the emergency-fund target and every retirement projection depend on your age and time horizon. Without a date of birth this app cannot offer any of them, and it would rather say nothing than guess.',
          impact: { amountPaise: ZERO, horizonMonths: 0 },
          confidence: 'high',
          action: { label: 'Complete your profile', kind: 'update_profile' },
          evidence: [{ kind: 'metric', id: 'dateOfBirth', label: 'Date of birth not set' }],
        }),
      ];
    }

    const target = suggestAllocation(age, snapshot.profile.riskProfile);
    const investable = sum(
      snapshot.accounts
        .filter((a) => !a.archived && ['brokerage', 'mutual_fund', 'nps', 'epf', 'ppf'].includes(a.kind))
        .map((a) => a.balance),
    );

    return [
      baseInsight('asset-allocation', snapshot, {
        severity: 'low',
        headline: `Target allocation at ${age}: ${target.equity}% equity, ${target.debt}% debt, ${target.gold}% gold`,
        reasoning: `On a ${
          snapshot.profile.riskProfile
        } risk profile at ${age}, a reasonable target is ${target.equity}% equity, ${
          target.debt
        }% debt and ${target.gold}% gold, against ${rupees(
          investable,
        )} currently in long-term accounts. The equity share comes from a "110 minus age" anchor adjusted for risk appetite and capped at 85% — not because more equity would not have a higher expected return, but because a portfolio you abandon during a 30% drawdown returns nothing. Rebalance once a year rather than reacting to markets; the debt and gold portions exist precisely so you have something to sell that has not fallen.`,
        impact: { amountPaise: ZERO, horizonMonths: 0 },
        confidence: 'medium',
        evidence: [
          { kind: 'metric', id: 'investableAssets', label: `Long-term assets ${rupees(investable)}` },
        ],
      }),
    ];
  },
};

/**
 * Step up the SIP as income grows.
 *
 * A fixed SIP silently shrinks in real terms every year. Stepping it up by 10% annually
 * roughly doubles the terminal corpus over 25 years, and it is the highest-leverage
 * single change available to someone who already has the basics in place — which is why
 * it is suppressed until they do.
 */
export const stepUpSipRule: AdvisorRule = {
  id: 'step-up-sip',
  stage: 4,
  title: 'Step up your SIP',
  evaluate(snapshot) {
    const surplus = monthlySurplus(snapshot);
    if (surplus <= 0) return [];

    const age = ageOf(snapshot);
    const retirementAge = snapshot.profile.retirementAge ?? 60;
    const years = age === null ? 25 : Math.max(retirementAge - age, 1);
    const months = years * 12;

    const nominal = snapshot.profile.expectedPortfolioReturn;
    const real = realReturn(nominal, snapshot.profile.assumedInflation);

    // Flat SIP against the same SIP stepped up 10% a year, both in today's money.
    const flat = futureValueSip(surplus, real, months);
    let stepped = ZERO;
    let contribution = surplus;
    const monthlyReal = real / 12;
    for (let m = 1; m <= months; m += 1) {
      stepped = scale(add(stepped, contribution), 1 + monthlyReal);
      if (m % 12 === 0) contribution = scale(contribution, 1.1);
    }
    const gain = subtract(stepped, flat);
    if (gain <= 0) return [];

    return [
      baseInsight('step-up-sip', snapshot, {
        severity: 'medium',
        headline: `Raising your SIP 10% a year is worth ${rupees(gain)} more`,
        reasoning: `Investing your ${rupees(
          surplus,
        )} monthly surplus at a flat amount for ${years} years grows to about ${rupees(
          flat,
        )} in today's money. Increasing it by 10% each year — roughly what a normal raise allows — reaches ${rupees(
          stepped,
        )}, or ${rupees(
          gain,
        )} more, for no change in how much of your income you are giving up. Both figures are inflation-adjusted at ${pct(
          snapshot.profile.assumedInflation,
          0,
        )}, so they are comparable to what ${rupees(
          surplus,
        )} buys today; a nominal projection would have looked far larger and meant considerably less. Set the step-up as an automatic instruction so it happens without a decision each year.`,
        impact: { amountPaise: gain, horizonMonths: months },
        confidence: 'medium',
        action: { label: 'Increase your SIP', kind: 'increase_sip' },
        evidence: [
          { kind: 'metric', id: 'surplus', label: `Monthly surplus ${rupees(surplus)}` },
          { kind: 'metric', id: 'realReturn', label: `Real return ${pct(real)}` },
        ],
      }),
    ];
  },
};

// ---------------------------------------------------------------------------
// Stage 5 - the long horizon
// ---------------------------------------------------------------------------

/**
 * Goal feasibility.
 *
 * Reports the required contribution against the actual one, per goal. The value is in
 * finding out now, not in five years, that a goal is under-funded — a shortfall caught
 * early is fixed with a small monthly increase, and the same shortfall caught late cannot
 * be fixed at all.
 */
export const goalFeasibilityRule: AdvisorRule = {
  id: 'goal-feasibility',
  stage: 5,
  title: 'Goal feasibility',
  evaluate(snapshot) {
    if (snapshot.goals.length === 0) return [];
    const asOf = new Date(snapshot.asOf);

    const assessments = snapshot.goals
      .map((goal) => assessGoal(goal, asOf))
      .filter((a) => !a.onTrack && a.monthsRemaining > 0)
      .sort((a, b) => b.shortfall - a.shortfall);

    if (assessments.length === 0) return [];

    const worst = assessments[0];
    if (!worst) return [];

    const totalShortfall = sum(assessments.map((a) => a.shortfall));
    const totalExtra = sum(assessments.map((a) => a.additionalMonthly));

    return [
      baseInsight('goal-feasibility', snapshot, {
        severity: worst.successProbability < 0.4 ? 'high' : 'medium',
        headline: `${assessments.length} goal${assessments.length > 1 ? 's are' : ' is'} off track by ${rupees(totalShortfall)}`,
        reasoning: `${assessments
          .map(
            (a) =>
              `${a.goalName}: contributing ${rupees(a.currentMonthly)}/month against ${rupees(
                a.requiredMonthly,
              )} needed over ${a.monthsRemaining} months — ${rupees(
                a.additionalMonthly,
              )} short, about a ${Math.round(a.successProbability * 100)}% chance of getting there as things stand`,
          )
          .join('. ')}. Closing every gap takes ${rupees(
          totalExtra,
        )} more a month in total. If that is not available, the honest alternatives are to move a target date out or lower a target amount — stretching for an unfunded goal usually means borrowing for it later at a rate that costs more than the shortfall did. The success percentages assume return variance around your ${pct(
          snapshot.profile.expectedPortfolioReturn,
        )} expectation, so treat them as "roughly", not as precise odds.`,
        impact: { amountPaise: totalShortfall, horizonMonths: worst.monthsRemaining },
        confidence: 'medium',
        action: { label: 'Review your goals', kind: 'create_goal' },
        evidence: assessments.map<EvidenceRef>((a) => ({
          kind: 'goal',
          id: a.goalId,
          label: `${a.goalName}: ${rupees(a.additionalMonthly)}/month short`,
        })),
      }),
    ];
  },
};

/**
 * Financial independence trajectory.
 *
 * The headline number the whole app builds toward: the corpus that makes work optional,
 * when the current plan reaches it, and what following the ranked advice is worth by then.
 *
 * Computed in real terms throughout. A nominal projection of "₹8 crore at 60" is the kind
 * of number that feels like a plan and is not one — at 6% inflation it is about ₹1.9 crore
 * of today's money, and someone who mistakes the two under-saves for thirty years.
 */
export const fiTrajectoryRule: AdvisorRule = {
  id: 'fi-trajectory',
  stage: 5,
  title: 'Financial independence',
  evaluate(snapshot) {
    const { metrics, profile } = snapshot;
    const annualEssential = scale(metrics.monthlyEssentialExpenses, 12);
    if (annualEssential <= 0) return [];

    const surplus = monthlySurplus(snapshot);
    const corpus = sum(
      snapshot.accounts
        .filter(
          (a) =>
            !a.archived &&
            ['brokerage', 'mutual_fund', 'nps', 'epf', 'ppf', 'fixed_deposit', 'recurring_deposit'].includes(
              a.kind,
            ),
        )
        .map((a) => a.balance),
    );

    const currentYear = new Date(snapshot.asOf).getUTCFullYear();
    const target = fiNumber(annualEssential);

    const current = projectFi({
      annualExpenses: annualEssential,
      currentCorpus: corpus,
      monthlyContribution: surplus,
      nominalReturn: profile.expectedPortfolioReturn,
      inflation: profile.assumedInflation,
      currentYear,
    });

    // The counterfactual: what a 10% annual step-up plus the surplus recovered from the
    // ranked advice would do. Deliberately modest — a 10% step-up is an ordinary raise,
    // not an aspirational assumption.
    const improved = projectFi({
      annualExpenses: annualEssential,
      currentCorpus: corpus,
      monthlyContribution: surplus,
      nominalReturn: profile.expectedPortfolioReturn,
      inflation: profile.assumedInflation,
      currentYear,
      contributionGrowth: 0.1,
    });

    const yearsSooner =
      current.monthsToFi !== null && improved.monthsToFi !== null
        ? Math.round((current.monthsToFi - improved.monthsToFi) / 12)
        : null;

    const reach =
      current.fiYear === null
        ? `On ${rupees(surplus)} a month this plan does not reach the target within 60 years`
        : `At ${rupees(surplus)} a month you reach it around ${current.fiYear}`;

    return [
      baseInsight('fi-trajectory', snapshot, {
        severity: current.monthsToFi === null ? 'medium' : 'positive',
        headline:
          current.fiYear === null
            ? `Financial independence needs ${rupees(target)} — the current plan does not get there`
            : `On track for financial independence around ${current.fiYear}`,
        reasoning: `Your essential spending is ${rupees(
          metrics.monthlyEssentialExpenses,
        )} a month, or ${rupees(
          annualEssential,
        )} a year. Covering that from investments at a 3.5% withdrawal rate needs a corpus of ${rupees(
          target,
        )} in today's money; you hold ${rupees(corpus)}, which is ${Math.round(
          current.progress * 100,
        )}% of the way. ${reach}, using a real return of ${pct(
          current.realRate,
        )} — that is your ${pct(
          profile.expectedPortfolioReturn,
        )} expectation discounted by ${pct(
          profile.assumedInflation,
          0,
        )} inflation, because a target stated in today's rupees has to be reached in today's rupees.${
          yearsSooner !== null && yearsSooner > 0
            ? ` Raising the contribution 10% a year — an ordinary raise, redirected rather than absorbed — brings that forward to about ${improved.fiYear}, roughly ${yearsSooner} year${yearsSooner === 1 ? '' : 's'} sooner.`
            : ''
        } A 3.5% withdrawal rate is used rather than the familiar 4%: that figure comes from US data over a 30-year retirement, and being conservative here means retiring slightly later rather than running out at 78.`,
        impact: { amountPaise: ZERO, horizonMonths: current.monthsToFi ?? 720 },
        confidence: 'medium',
        evidence: [
          { kind: 'metric', id: 'fiTarget', label: `FI target ${rupees(target)}` },
          { kind: 'metric', id: 'corpus', label: `Invested corpus ${rupees(corpus)}` },
          { kind: 'metric', id: 'surplus', label: `Monthly surplus ${rupees(surplus)}` },
        ],
      }),
    ];
  },
};

export const GROWTH_RULES: AdvisorRule[] = [
  prepayVsInvestRule,
  payoffOrderRule,
  taxOptimisationRule,
  assetAllocationRule,
  stepUpSipRule,
  goalFeasibilityRule,
  fiTrajectoryRule,
];
