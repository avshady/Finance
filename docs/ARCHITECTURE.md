# WealthWise — Architecture

> Decision record. Written before implementation; subagents implement against it.

## 1. What this app is

A **local-first PWA** that tracks every rupee of expenditure, models every EMI/loan
exactly, and runs a **quantified advisor engine** that ranks recommendations by the
rupees they are worth over a stated horizon — then projects the wealth delta of
following the plan versus the status quo.

## 2. The hard constraint, stated honestly

The request asks for the app to be "connected to all channels and aware in real time."
There is no path by which an app connects itself to a user's banks. The real options,
and what each actually costs:

| Path | Reality | Status here |
|---|---|---|
| **RBI Account Aggregator** (Setu / Finvu / Onemoney) | The only sanctioned real-time bank/UPI/deposit feed in India. Requires an FIU registration + a licensed AA partner + per-consent user approval. | **Adapter interface + full normalizer built; needs the user's own FIU credentials to go live.** |
| **Plaid / TrueLayer** (non-India) | Works, needs a paid client_id/secret. | Adapter built, credentials required. |
| **Transaction SMS** | Every Indian bank/card sends one within seconds of a swipe/UPI. This is the genuine real-time channel available without a license. Needs an Android companion (notification listener) or the PWA's Web Share Target. | **Parser live — 40+ bank/card templates. Share Target wired.** |
| **Transaction email** | Statements + alerts. Gmail connector or IMAP. | **Parser live.** |
| **CSV / statement import** | Universal fallback, full history backfill. | **Live, with per-bank column presets.** |
| **Manual entry** | Always works. | **Live.** |
| Screen-scraping net banking with stored credentials | Violates every bank's ToS, breaks 2FA, and is how people get their accounts frozen. | **Not built. Deliberately.** |

**Design rule: the app never fakes a connection.** Every channel declares
`status: 'live' | 'needs-credentials' | 'needs-companion-app'`, and the Connectors
screen shows exactly that. A finance app that lies about its data provenance is worse
than useless — the user would act on phantom numbers.

So: **real-time where real-time is actually possible** (SMS/push/webhook ingest, which
is sub-second), **near-real-time via AA/Plaid once credentials are supplied**, and
**honest backfill** for everything else.

## 3. Why local-first

The data here is a complete map of someone's financial life. Decisions:

- **IndexedDB (Dexie) is the source of truth.** Not a server database.
- **All computation — categorization, amortization, advice, projections — runs in the
  browser.** The advisor engine is deterministic TypeScript, not an LLM call. It works
  offline, on a plane, with no account, and it produces the same answer twice.
- **Zero-knowledge by default.** No telemetry, no analytics SDK, no third-party fonts.
- Server routes exist for exactly three things: the connector webhook receiver, the
  AA/Plaid OAuth handshake, and an *optional* LLM pass that rewrites already-computed
  insights into prose. The LLM never computes a number.

The tradeoff accepted: no cross-device sync in v1. The upgrade path is an
encrypted-blob sync (client-side AES-GCM, server stores ciphertext only), specified in
§9, not implemented in v1.

## 4. Stack

Next.js 15 (App Router) · React 19 · TypeScript strict · Tailwind · Dexie 4 ·
Recharts · Zod at every ingest boundary · Vitest.

Hand-written service worker (`public/sw.js`) rather than a plugin — the caching
strategy here is specific (app shell precache, never cache financial data responses)
and worth 60 lines of explicit code over a dependency that churns.

## 5. Layering

```
src/lib/core/            ← pure TypeScript. No React, no DOM, no I/O. 100% unit-testable.
  domain/                ← types + invariants (Money as integer paise, never float)
  ingest/                ← ChannelAdapter implementations → RawEvent → Transaction[]
  categorize/            ← merchant normalization + rules + learned user overrides
  emi/                   ← amortization, prepayment, refinance, payoff optimizer
  analytics/             ← cash flow, trends, anomalies, recurring detection
  advisor/               ← the rule engine. Ranked, quantified Insights.
  wealth/                ← projection, FI number, goal feasibility, Monte Carlo
  db/                    ← Dexie schema + repositories (the only I/O in core)
src/app/                 ← routes (dashboard, transactions, debt, insights, goals, connectors)
src/components/          ← presentation only
```

**Rule: money is `Paise` (a branded integer).** Floats are banned in the domain layer.
`0.1 + 0.2 !== 0.3` is a rounding bug in a budget app and a lawsuit in a loan
amortizer.

## 6. The advisor engine — what makes it "top 1%"

A mediocre finance app says "you spent ₹8,400 on food, that's 12% more than last
month." That is a fact, not advice. This engine emits **Insights** shaped like:

```ts
interface Insight {
  id: string;
  rule: string;                  // which doctrine produced it
  severity: 'critical' | 'high' | 'medium' | 'low' | 'positive';
  headline: string;
  reasoning: string;             // the arithmetic, shown
  impact: { amountPaise: Paise; horizonMonths: number };  // ← insights are RANKED by this
  confidence: 'high' | 'medium' | 'low';
  action?: { label: string; kind: ActionKind; params: Record<string, unknown> };
  evidence: EvidenceRef[];       // the exact transactions/loans it is based on
}
```

Everything is **ranked by expected rupee impact**, not by recency. The engine encodes
the actual sequencing doctrine a good fee-only planner follows:

1. **Liquidity before returns.** Emergency fund = 6× *essential* monthly outflow
   (essential is computed, not guessed: rent + EMIs + utilities + groceries +
   insurance + median medical). Until that exists, "start investing" advice is
   suppressed — this ordering is the single most valuable thing the engine does.
2. **Guaranteed return beats expected return.** Revolving credit-card debt (36–42%
   APR) is always priority #1 — no equity portfolio beats a certain 40%. Then any
   debt above the portfolio-return hurdle.
3. **Debt payoff optimizer.** Avalanche (mathematically optimal) computed against
   snowball (behaviourally easier), with the exact ₹ and month cost of choosing
   snowball stated — then the user chooses, informed.
4. **Prepay-vs-invest crossover**, done properly: compares the loan's *effective*
   post-tax rate (home loans net of §24(b) interest and §80C principal relief) against
   the real expected portfolio return. Most apps get this backwards and tell people to
   prepay a 8.4% home loan that effectively costs them ~5.9%.
5. **Ratio guardrails**: total EMI ≤ 40% of net income, housing ≤ 30%,
   savings rate ladder 20% → 30% → 40%.
6. **Leak detection**: dormant subscriptions, duplicate services, fee/penalty/interest
   charges, ATM fees, lifestyle inflation (income rose X%, savings rate flat or down —
   the silent wealth killer), and category anomalies via robust z-score.
7. **Tax efficiency**: unused 80C/80D/NPS headroom, regime comparison, LTCG
   harvesting window.
8. **Goal feasibility**: required SIP vs actual SIP per goal, with success probability.
9. **FI trajectory**: FI number at 25–33× annual expenses, projected FI date, and — the
   headline number — **the wealth delta from adopting the ranked plan versus not**,
   compounded to the FI horizon.

Each rule is a pure function `(FinancialSnapshot) => Insight[]`, registered in a
`RULES` array. Adding doctrine = adding a file. Every rule is unit-tested against
hand-computed fixtures, because advice that is confidently wrong about money is the
worst possible failure mode of this app.

## 7. Categorization

Rules + merchant normalization, **not** ML. A curated merchant→category table with
fuzzy normalization (strip UPI handles, order ids, terminal ids, city suffixes)
outperforms a small on-device model, is debuggable, and never needs training data. User
overrides are learned into a persistent map and always win.

## 8. Real-time pipeline

```
SMS / push / webhook / share-target
        │
        ▼
  POST /api/ingest  ─or─  Web Share Target  ─or─  companion app
        │
        ▼  Zod validation
   ChannelAdapter.parse() → RawEvent
        ▼
   Dedupe (channel + ref + amount + 90s window)   ← the same swipe arrives by SMS AND email
        ▼
   Categorize → persist → recompute snapshot → re-run advisor
        ▼
   Web Push notification if any Insight is severity >= high
```

Dedupe is not optional. Every real ingest pipeline double-counts without it, and a
double-counted salary credit wrecks every downstream ratio.

## 9. Deferred, with a specified path

- Encrypted multi-device sync (client-side AES-GCM; server holds ciphertext only).
- Android companion app for the notification listener (real-time SMS without sharing).
- Live AA integration (needs the user's FIU registration).
- Monte Carlo upgrade from normal-distribution sampling to bootstrapped historical returns.

## 10. Non-negotiables

- No float money. No faked connectors. No LLM-computed numbers.
- Advisor output must always show its arithmetic.
- The app must be fully usable offline with zero accounts configured.
- This is educational modelling, not SEBI-registered investment advice, and the UI says so.
