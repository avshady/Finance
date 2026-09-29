# Deploying WealthWise

The app is a standard Next.js server build. It runs anywhere that can run
`npm run build && npm start` — Railway, Render, Fly, a VPS, or Vercel.

## What actually gets hosted

Worth being clear about, because it changes how much the hosting choice matters:
**no financial data is stored on the server.** Accounts, transactions, loans and
goals all live in the browser's IndexedDB, and every calculation — categorisation,
amortisation, the advisor engine — runs client-side.

So the server only ever holds the application code. A public URL means anyone with
the link can open a blank copy of the app; it does not expose your ledger, and two
people visiting the same deployment see entirely separate data. The corollary is
that your data does **not** follow you between devices or survive clearing site
data — export from Settings if you want a backup.

## Railway

Railway builds from the repo with Nixpacks and needs no Dockerfile.

1. **New Project → Deploy from GitHub repo**, pick `avshady/Finance`.
2. Set the branch to `claude/personal-finance-pwa-v3phel` (or merge to `main` first).
3. Deploy. `railway.json` supplies the build command, start command and healthcheck.
4. **Settings → Networking → Generate Domain** to get a public URL.

`next start` reads Railway's injected `PORT` automatically, so no port config is
needed. `engines.node` pins Node 20+; without it Nixpacks picks its own default,
which has historically lagged behind what this codebase targets.

### Environment variables

Everything is optional except where noted.

| Variable | Effect if unset |
|---|---|
| `INGEST_SHARED_SECRET` | **`/api/ingest` returns 503 in production.** This is deliberate — see below. |
| `NEXT_TELEMETRY_DISABLED` | Next's build-time CLI telemetry stays on. Set to `1`. |

**On `INGEST_SHARED_SECRET`:** the webhook ingest endpoint refuses to run in
production unless a secret is configured. It does not quietly default to open.
An unauthenticated endpoint that accepts transaction payloads is an invitation to
have junk written into someone's financial history, and the failure would be silent
— so the endpoint declines to exist rather than run unprotected.

If you are not using webhook ingest (the SMS share target, CSV import and manual
entry all work without it), leave the variable unset and ignore the 503. If you are,
set it to a long random string and send it as the `x-ingest-secret` header:

```bash
openssl rand -hex 32
```

## Other hosts

- **Vercel** — zero config; it detects Next.js. Same env vars.
- **Render / Fly / VPS** — build with `npm ci && npm run build`, run `npm start`,
  point the healthcheck at `/api/health`.

## After deploying

Open the URL on your phone and **Add to Home Screen**. That installs it as a PWA
and registers the share target, which is what lets you long-press a bank SMS and
share it straight into the app. That flow needs HTTPS, which every host above
provides by default — it will not work over plain HTTP or from a raw IP address.
