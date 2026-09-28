# WealthWise

A local-first personal-finance PWA that tracks every rupee, models every EMI exactly, and
runs a **quantified advisor engine** — recommendations ranked by the rupees they are
worth, each one showing its arithmetic.

Your financial data never leaves your device.

---

## Read this first: what "connected to all channels" actually means

This app was asked to be "connected to all channels and aware in real time." That
deserves a straight answer rather than a marketing one, because the difference decides
whether you can trust the numbers.

**No app can connect itself to your banks.** The routes that exist, and what each really
costs:

| Channel | Latency | Status here | What it needs from you |
|---|---|---|---|
| **Transaction SMS** | seconds | **Works** | Share a bank SMS into the app (Android share sheet), or run the companion notification-listener app. This is the genuine real-time path. |
| **CSV / statement import** | on demand | **Works** | Download a statement from net banking. Best way to backfill history. |
| **Manual entry** | instant | **Works** | Nothing. |
| **Transaction email** | minutes | Parser works, needs a mailbox connection | Gmail OAuth credentials or IMAP details. |
| **RBI Account Aggregator** (Setu / Finvu / Onemoney) | minutes | Normalizer built, **needs credentials** | Your own FIU registration plus a licensed AA partner. This is the only sanctioned real-time bank feed in India. |
| **Plaid / TrueLayer** (outside India) | minutes | Normalizer built, **needs credentials** | A paid `client_id` and secret. |
| Screen-scraping net banking with your password | — | **Deliberately not supported** | It violates every bank's terms, breaks 2FA, and is how people get accounts frozen. |

The Connectors screen shows each channel's real state — `live`, `needs-credentials`, or
`needs-companion-app` — and never presents an unconfigured connector as connected. A
finance app that is vague about where its numbers came from is worse than no app at all,
because you would act on figures that aren't real.

**So: real-time where real-time is genuinely possible, and honest about the rest.**
See [`docs/INGEST.md`](docs/INGEST.md) for setup per channel.

---

## What makes the advice worth reading

Most finance apps tell you facts: *"you spent ₹8,400 on food, 12% more than last month."*
That is an observation, not advice. This engine emits ranked, quantified recommendations,
and enforces two things that matter more than any individual calculation:

**1. Order.** Advice sequence is most of the value. Telling someone to start a SIP while
they carry a 42% credit-card balance is actively harmful — and it is the most common
failure of automated finance tools. Rules run in stages, and earlier stages *suppress*
later ones, so the feed physically cannot rank "invest more" above "clear this card".
Withheld advice is kept and shown in a "held back for now" section, with the reason.

**2. Ranking by rupee impact.** A ₹40,000/year interest leak outranks a ₹300 subscription
regardless of which was noticed today.

The doctrine encoded, in order:

1. **Liquidity before returns.** Emergency fund = 6× *essential* monthly outflow — and
   "essential" is computed from your actual categorised spending, not guessed. The target
   scales with dependents and income stability. Investment advice stays suppressed until
   the buffer exists.
2. **Guaranteed beats expected.** Revolving card debt is always priority one; no portfolio
   reliably returns 42%.
3. **Prepay vs invest, done correctly.** Compares a loan's *effective post-tax* rate
   against a *post-capital-gains* expected return. A ₹50L home loan at 8.6% with §24(b)
   relief at a 30% slab really costs about 7.4% — below a realistic equity expectation.
   Tools that compare the headline rate tell you to prepay it, which destroys wealth.
   Differences under two percentage points are reported as *neutral* rather than dressed
   up as certainty.
4. **Payoff order, priced not preached.** Avalanche always wins arithmetically, so the
   useful output is what snowball *costs* in rupees and months — letting you choose the
   easier plan knowingly. A plan abandoned in month three saves nothing.
5. **Ratio guardrails.** EMI ≤ 40% of net income, credit utilisation ≤ 30%, savings-rate
   ladder 20% → 30% → 40%.
6. **Leak detection.** Dormant and duplicate subscriptions, fees and penalties, and
   **lifestyle inflation** — income rose while the savings rate stayed flat, meaning the
   whole raise was absorbed. That one is the quiet wealth killer.
7. **Tax efficiency.** Unused §80C/§80D/NPS headroom, valued at your marginal rate — with
   the warning that buying an endowment policy for the deduction usually costs more in
   forgone returns than the tax it saves.
8. **Goals and independence.** Required vs actual contribution per goal, success
   probability, the FI corpus at a 3.5% withdrawal rate, and your projected FI year.

Every projection is **inflation-adjusted**. "₹8 crore at 60" is about ₹1.9 crore of
today's money at 6% inflation, and conflating the two is how retirement plans quietly
fail.

---

## Design decisions

**Local-first.** IndexedDB is the source of truth; all computation runs in your browser.
Works offline, with no account. The shipped app reports nothing anywhere: no analytics
SDK, no third-party fonts, no phoning home. (Next.js's own build-time CLI telemetry is
disabled via `NEXT_TELEMETRY_DISABLED` in `.env.example` and CI.)
Server routes exist only for connector handshakes and webhook parsing — and the ingest
endpoint parses without persisting, because a server that stores this data would break
the point of the app.

**Money is an integer.** All amounts are `Paise`, a branded integer. Floats are banned in
the domain layer: `0.1 + 0.2 !== 0.3` is cosmetic in a budget screen and compounds into
real error across a 240-month amortization schedule.

**The advisor is deterministic TypeScript, not an LLM.** It works offline, gives the same
answer twice, and shows its arithmetic. An optional LLM pass can rewrite already-computed
insights into prose; it never computes a number.

**Amortization is iterated, not closed-form.** Lenders round the EMI to the rupee and
absorb the drift in the final instalment. A closed form assumes an unrounded instalment
and over 240 months disagrees by thousands of rupees on total interest — the exact figure
a prepayment decision turns on.

Full rationale in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

---

## Getting started

```bash
npm install
npm run dev          # http://localhost:3000
```

Then either **load the demo dataset** from Settings (14 months of realistic Indian
financial history, with findable problems planted so you can see the advisor work), or
start adding your own data via CSV import, SMS paste, or manual entry.

Fill in **Settings** before judging the advice: income, date of birth, dependents,
employment type and tax regime all feed the rules. Rules that lack an input stay silent
rather than guessing.

```bash
npm test             # engine test suite
npm run typecheck
npm run build
```

### Installing as an app

Open it in a mobile browser and choose "Add to Home Screen". On Android you then get the
share target: long-press a bank SMS → Share → WealthWise, and it becomes a categorised
transaction in seconds.

---

## Project layout

```
src/lib/core/            pure TypeScript, no React, no DOM — fully unit-tested
  domain/                types + Paise money
  ingest/                channel adapters, parsers, dedupe
  categorize/            merchant normalization + rules + learned overrides
  emi/                   amortization, prepayment, refinance, payoff optimiser
  analytics/             cash flow, trends, anomalies, recurring detection
  advisor/               the rule engine and the rules themselves
  wealth/                projections, FI, goal feasibility
  db/                    Dexie schema and repositories
src/app/                 routes
src/components/          presentation
```

Adding financial doctrine means adding a rule file and registering it. Stage ordering
handles the rest.

---

## Limitations, stated plainly

- **No cross-device sync.** The upgrade path (client-side AES-GCM, server holds only
  ciphertext) is specified in `docs/ARCHITECTURE.md` §9 but not built.
- **The AA and Plaid connectors need credentials that only you can obtain.** They are
  real normalizers against the real payload shapes, not stubs — but nothing happens until
  those are configured.
- **Real-time SMS ingest on Android needs either the share sheet or a companion app.** A
  browser cannot read your SMS inbox, and any app claiming otherwise is doing something
  you should not permit.
- **Goal success probabilities are a lognormal approximation**, not a 10,000-path Monte
  Carlo. Deliberate: it is instant on a phone and deterministic, and at this precision the
  honest answer is "about 70%", not "71.4%".
- **Tax logic targets India** (§24(b), §80C, §80D, §80E, §80CCD(1B), old vs new regime).
  Currency and locale are configurable; the tax rules are not yet.

## This is not investment advice

WealthWise is an educational modelling tool. It is not SEBI-registered investment advice,
and it does not know your full circumstances. The arithmetic is tested and shown to you
precisely so you can check it and decide for yourself. For decisions that matter, talk to
a fee-only financial planner — one paid for advice, not on commission for products sold.
