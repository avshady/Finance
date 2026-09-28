# Ingest channels

This is the honest inventory ARCHITECTURE.md §2 promises: every channel below
states, without hedging, whether it works today, what the user must supply to
turn it on, and the latency to expect. Nothing here is described as "connected"
unless it actually is. The `Connectors` screen in the app reads the same
`status`/`latency`/`requirement` fields from `src/lib/core/ingest/registry.ts` —
this document is prose, that registry is the source of truth.

| Channel | Status | Latency | What it takes |
|---|---|---|---|
| Manual entry | **Live** | On-demand | Nothing. Type a transaction in. |
| CSV / statement import | **Live** | On-demand | Export a statement CSV from net banking and upload it. |
| Web Share Target | **Live** | Real-time (seconds) | Install the PWA, share a bank SMS/notification to it from the phone's share sheet. |
| Transaction SMS (companion app) | Needs companion app | Real-time | An Android notification-listener companion app, which is not built in this repo. Until it exists, the SMS parser itself (`src/lib/core/ingest/smsParser.ts`) is fully live — it just has no automatic feed; use Share Target instead. |
| Transaction email | Needs credentials | Minutes | Gmail OAuth client credentials or an IMAP app password. |
| RBI Account Aggregator (Setu/Finvu/Onemoney) | Needs credentials | Minutes | The user's own FIU registration with RBI, a contract with a licensed AA, and per-consent approval. See below. |
| Plaid | Needs credentials | Minutes | A Plaid `client_id`/`secret` and the user linking a (non-India) bank via Plaid Link. |
| Webhook receiver (`/api/ingest`) | Needs credentials | Real-time | `INGEST_SHARED_SECRET` set, and an upstream sender configured to POST to it (e.g. a companion app or a Plaid webhook). |

## Manual entry — live, no setup

Always available. The user types the amount, direction, merchant and (optionally)
a bank reference; it goes straight through `ingestRawEvent` like every other
channel, including dedupe and classification. This is the fallback that always
works, on a plane, with zero accounts configured.

## CSV / statement import — live, no setup

Universal backfill. Most Indian banks let you export a statement as CSV from net
banking; `src/lib/core/ingest/csvImporter.ts` handles the real-world mess —
preamble rows (account name, statement period) before the header, quoted fields
with embedded commas, CRLF/BOM, and several column-header conventions banks use
for "Withdrawal Amt."/"Deposit Amt." vs. a single signed "Amount" column. No
credentials, no OAuth, nothing to configure. Latency is whatever the user's
schedule for downloading and re-uploading a statement is — this is deliberately
"on-demand," not real-time.

## Web Share Target — live, real-time

The genuinely real-time channel available today without a license or a
companion app. `public/manifest.webmanifest` declares a `share_target` that
receives a POST from the OS share sheet at `/share`; `public/sw.js` intercepts
that POST (a Next.js page can only ever answer GET) and redirects to `/share`
as a GET carrying the shared text, which the page then runs through
`parseEvent` for a preview and `ingestRawEvent` on confirmation. To use it: open
the installed PWA at least once (so the service worker registers), then
long-press a bank SMS or notification and share it to WealthWise. Nothing is
saved until the user confirms what was parsed — including anything the parser
was unsure about.

**What this is not**: it requires the user to manually share each message. It
is real-time in the sense that it takes seconds once shared, not in the sense
that it happens automatically in the background — that needs the companion app
below.

## Transaction SMS (automatic, background) — needs a companion app

Every Indian bank/card sends an SMS within seconds of a swipe or UPI payment,
and the parser for 40+ bank/card SMS templates
(`src/lib/core/ingest/smsParser.ts`) is fully built and tested. What is missing
is the thing that would read those SMS automatically: a browser cannot read a
phone's SMS inbox, so a background feed needs an Android companion app with
notification-listener permission, posting each SMS to `/api/ingest`. That
companion app is not part of this repository. Until it exists, this channel's
`status` is honestly `needs-companion-app`, and the working substitute today is
sharing each message manually via the Web Share Target above.

## Transaction email — needs credentials

Bank/card alert emails, UPI receipts, and merchant order-confirmation mail
(Amazon/Flipkart/Swiggy/Zomato/Uber) are parsed by
`src/lib/core/ingest/emailParser.ts`, reusing the same extraction logic as SMS
after stripping HTML to text. To go live, supply either:

- **Gmail**: `GMAIL_CLIENT_ID` / `GMAIL_CLIENT_SECRET` (OAuth) in `.env`, and the
  user completes the Google consent flow, or
- **IMAP**: `IMAP_HOST` / `IMAP_USER` / `IMAP_PASSWORD` in `.env` for direct
  mailbox access.

Neither is wired up to actually poll a mailbox in this repository yet — the
parser is real, the OAuth/IMAP polling loop that would feed it is not. Until
one of those is built, this channel is `needs-credentials`, not `live`, and the
app must not claim otherwise.

## RBI Account Aggregator (Setu / Finvu / Onemoney) — needs credentials

The only RBI-sanctioned real-time bank/UPI/deposit feed in India, and the
closest thing to "connected to your bank" this app can honestly offer.
`src/lib/core/ingest/accountAggregator.ts` normalizes an AA FI Data payload
(deposit + credit-card accounts, per the ReBIT/Sahamati spec) once a configured
integration hands it one after decrypting a consent-scoped response. It makes
no network call and fabricates no data.

**To go live, the user (or the org running this app) needs:**

1. **An FIU (Financial Information User) registration with RBI.** This is a
   regulatory registration, not a signup form — it identifies the app/business
   as authorized to *request* financial information via the AA framework. Apply
   through the RBI's published FIU registration process; a licensed AA (below)
   can point you to the current application, as the process periodically moves.
2. **A commercial contract with a licensed Account Aggregator** — Setu, Finvu,
   Onemoney, or another RBI-licensed AA — who brokers the actual consent flow
   and data pull between the FIU and the user's banks (the FIPs).
3. **Per-consent user approval.** Every data pull requires the user approving a
   scoped, time-bound consent artifact in the AA's own consent UI; there is no
   way to fetch data without it, by design.

Once those three exist, set `AA_CLIENT_ID`, `AA_CLIENT_SECRET`, and
`AA_BASE_URL` in `.env` (see `.env.example`) to point at the AA's API, and wire
the AA's OAuth/consent-callback flow to a server route that hands
`accountAggregatorAdapter.parse()` the decrypted FI Data payload it already
knows how to normalize. None of that OAuth/consent plumbing exists in this
repository yet — only the normalizer does — so the channel stays
`needs-credentials` until it is built and the FIU registration is in hand.

## Plaid — needs credentials

For non-India banks. `src/lib/core/ingest/plaidAdapter.ts` normalizes Plaid's
transaction webhook/API shape. To go live: a Plaid `client_id`/`secret`
(`PLAID_CLIENT_ID`, `PLAID_SECRET`, `PLAID_ENV` in `.env`), and the user
completing Plaid Link to authorize a specific institution. As with AA, the
normalizer is built; the Plaid Link handshake and webhook registration are not
wired up in this repository yet.

## Webhook receiver (`POST /api/ingest`) — needs credentials in production

The server-side landing point for anything above that delivers data by webhook
(a companion app, Plaid, or a future AA callback). Per ARCHITECTURE §3, this
route **holds no database** — it validates the request, parses it through the
same channel adapters the client uses, and returns `ParsedTransaction[]` for
the client to persist locally via `ingestRawEvent`. It never writes financial
data anywhere server-side.

Auth is a shared secret: set `INGEST_SHARED_SECRET` in `.env` and send it as
the `x-ingest-secret` header on every request. If that variable is unset, the
route refuses to serve in production (`503`) rather than silently becoming an
open endpoint; it is left open only in development, for local companion-app
testing. Requests are also rate-limited per IP in memory (30/minute), and every
response uses the status code you'd expect: `400` for a malformed body, `401`
for a missing/wrong secret, `429` over the rate limit, `200` with the parsed
result otherwise.

## What is deliberately not supported: screen-scraping net banking

Storing a user's net-banking username/password and driving their bank's website
programmatically is not implemented, and it will not be. It violates every
Indian bank's terms of service, breaks the moment 2FA/OTP changes (which is
often), and is one of the more common ways people get their online banking
access frozen or flagged for fraud review. The Account Aggregator framework
exists specifically so this app never has to ask for a banking password — that
is the honest, sanctioned path, and it is the one documented above.
