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

### Deploying from CI (creates the project too)

`.github/workflows/deploy.yml` provisions the Railway project *and* deploys to
it from GitHub Actions. Use this when the machine you are working from cannot
reach Railway directly — the runner has the network access, so nothing depends
on your local egress rules. It also means no dashboard clicking: the first run
creates the project, the service and the public domain.

One-time setup — a single secret:

1. Railway → **Account Settings → Tokens → Create token**. This must be an
   *account* (or team) token, not a project token: project tokens are scoped to
   a project that does not exist yet, so they cannot create one.
2. GitHub → **Settings → Secrets and variables → Actions → New repository
   secret**, named `RAILWAY_API_TOKEN`.

Then **Actions → Deploy to Railway → Run workflow**. The first run will:

- create a project (named from the `project_name` input, default `wealthwise`)
  along with its service,
- build and deploy it,
- generate a public `*.up.railway.app` domain,
- poll `/api/health` until it returns 200, and fail the job if it never does.

**After the first run, set `RAILWAY_PROJECT_ID`.** Copy the project ID from the
deploy log into a repository *variable* of that name. Without it every run takes
the create-a-new-project branch again, and you end up with a pile of duplicate
projects. The job summary repeats this reminder.

Optional repository variables:

| Variable | Use |
|---|---|
| `RAILWAY_PROJECT_ID` | Deploy into an existing project. Set this after the first run. |
| `RAILWAY_SERVICE` | Only needed once a project holds more than one service. |
| `RAILWAY_WORKSPACE` | Pick a workspace when the account has several. |

If you would rather create the project by hand in the dashboard, you can instead
set `RAILWAY_PROJECT_ID` plus a project token as `RAILWAY_TOKEN` and skip the
account token entirely — the workflow takes the link-and-deploy path.

GitHub only lists a `workflow_dispatch` workflow once the file exists on the
**default** branch, so the **Run workflow** button will not appear until this
change is merged there.

The workflow runs `typecheck`, `test` and `build` before it calls `railway up`.
Railway rebuilds from source regardless, so this is not about producing the
artifact — it is about failing in seconds on a broken commit rather than
shipping it and waiting out a healthcheck timeout.

The job targets a `production` GitHub environment, so you can attach a required
reviewer there if you want deploys gated on approval.

## Other hosts

- **Vercel** — zero config; it detects Next.js. Same env vars.
- **Render / Fly / VPS** — build with `npm ci && npm run build`, run `npm start`,
  point the healthcheck at `/api/health`.

## After deploying

Open the URL on your phone and **Add to Home Screen**. That installs it as a PWA
and registers the share target, which is what lets you long-press a bank SMS and
share it straight into the app. That flow needs HTTPS, which every host above
provides by default — it will not work over plain HTTP or from a raw IP address.
