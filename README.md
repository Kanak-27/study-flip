# StudyFlip

AI-powered flashcards with SM-2 spaced repetition. Upload a PDF of your notes;
we extract the text, generate flashcards with an LLM, and schedule your reviews.
See `PLAN.md` for the engineering plan.

## Features

- **Auth** — email/password sessions (argon2 hashes, httpOnly cookies), two-step email-code signup, OTP password reset, optional TOTP two-factor with one-time recovery codes
- **Profile** — editable name/phone/bio, profile picture, password change, 2FA, sign-out, account deletion
- **Admin panel** — overview metrics, user search/detail/suspend/roles/2FA reset/delete, AI run and job queue retries, runtime quotas/switches/announcement, audit trail
- **Documents** — PDF upload (≤10 MB) → background text extraction (unpdf)
- **AI generation** — chunked extraction → flashcards via Groq (`openai/gpt-oss-120b`), review & save to deck
- **Decks & cards** — full CRUD, soft deletes, ownership scoping
- **Study sessions** — due-queue or per-deck, 3D flip UI, Again/Hard/Easy ratings
- **SM-2 scheduling** — ease, intervals, lapses; failed cards rejoin immediately
- **Dashboard** — decks/cards/due/reviews, recall accuracy, day streak, 30-day activity
- **Billing** — free tier (5 gens/mo) + premium (₹699/mo, 200 gens/mo) via Cashfree Subscriptions (UPI/card mandates)

## Prerequisites

- Node.js 22+
- MongoDB running locally (or a connection string to one)

## Getting started

```bash
npm install
cp server/.env.example server/.env   # then edit values
npm run dev:server                   # API on http://localhost:4000
npm run dev:client                   # SPA on http://localhost:5173
```

`npm run dev:server` starts both the API and the background worker (via
`server/scripts/with-worker.js`). For production, `npm start` runs the same two
processes under one supervisor.

## Environment variables (server/.env)

| Variable            | Required | Notes                                            |
| ------------------- | -------- | ------------------------------------------------ |
| `MONGO_URI`         | yes      | e.g. `mongodb://127.0.0.1:27017/studyflip`       |
| `SESSION_SECRET`    | yes      | ≥16 chars                                        |
| `CLIENT_ORIGIN`     | no       | default `http://localhost:5173` (CORS + cookies) |
| `SMTP_HOST`         | prod     | SMTP server for OTP + notices; dev logs codes instead |
| `SMTP_PORT`         | no       | default `587`                                    |
| `SMTP_SECURE`       | no       | `true` for implicit TLS (usually port 465)       |
| `SMTP_USER` / `SMTP_PASS` | no | SMTP credentials                                |
| `MAIL_FROM`         | no       | default `StudyFlip <no-reply@studyflip.local>`   |
| `OTP_TTL_MINUTES`   | no       | default `10`                                     |
| `OTP_MAX_ATTEMPTS`  | no       | default `5`                                      |
| `OTP_RESEND_SECONDS`| no       | default `60`                                     |
| `OTP_MAX_SENDS`     | no       | default `5`                                      |
| `ADMIN_EMAILS`      | no       | comma-separated addresses promoted to admin      |
| `GROQ_API_KEY`      | no       | Groq key; omit to disable AI generation (graceful) |
| `GROQ_BASE_URL`     | no       | default `https://api.groq.com/openai/v1`         |
| `GROQ_MODEL`        | no       | default `openai/gpt-oss-120b`                    |
| `CASHFREE_CLIENT_ID` | no      | Cashfree app id; omit to disable billing (404)   |
| `CASHFREE_CLIENT_SECRET` | no  | Cashfree secret key (also signs webhooks)        |
| `CASHFREE_ENV`      | no       | `sandbox` (default) or `production`              |
| `CASHFREE_PLAN_ID`  | no       | plan id; created automatically when empty        |
| `CASHFREE_PLAN_AMOUNT` | no    | monthly premium price in INR, default `699`      |
| `PORT`              | no       | default `4000`                                   |

## Tests

```bash
npm test
```

Server tests (107) boot an in-memory MongoDB automatically — no local database needed.
`server/tests/setup-env.js` pins the test environment (no SMTP, no billing
credentials) before any module reads `server/.env`.

## Admin

Promote the first administrator in one of three ways:

```bash
# 1. email allowlist (applied on signup/sign-in, and on /api/auth/me)
ADMIN_EMAILS=you@example.com

# 2. promote an existing local account
npm run make-admin -w server -- you@example.com

# 3. an existing admin can change roles from the Users tab
```

The `/admin` panel covers overview metrics, user search and drill-down (role,
suspend/lift, verify email, reset 2FA, delete), failed AI runs and queue jobs,
runtime quotas (`generationsPerMonth`), kill switches (`signupsEnabled`,
`generationEnabled`), the app-wide `announcement`, and an audit trail of every
admin mutation. Prices and provider credentials intentionally stay in env, not
the database.

In production, configure SMTP: without it, signup and password-reset requests
return `503 mail_unconfigured` rather than silently failing. In development,
the API logs the six-digit code and returns it as `devCode` so you can test the
full flow without a mail server.

Check the credentials without creating an account:

```bash
npm run mail:test -w server -- you@example.com
```

For Gmail, use a 16-character App Password (2-Step Verification is required),
not the normal account password. Pasting it with the usual spaces is fine; the
mailer strips whitespace for `smtp.gmail.com`.

## Deployment

- **API + worker**: `npm start` runs both under `scripts/with-worker.js`; they
  can also be run separately with `node src/server.js` / `node src/worker.js`.
  Point `MONGO_URI` at Atlas and set all required env vars.
- **SPA**: `npm run build` emits static files in `client/dist`; serve from any
  CDN or reverse proxy and proxy `/api` to the API (same-origin keeps cookies simple).
- Behind a reverse proxy the app already sets `trust proxy` for correct
  secure-cookie behavior (`SESSION_SECRET` must be set, `NODE_ENV=production`).
- Cashfree: add a webhook endpoint pointing at `POST /api/billing/webhook` and
  subscribe to the subscription events (`SUBSCRIPTION_STATUS_CHANGED`,
  `SUBSCRIPTION_AUTH_STATUS`, `SUBSCRIPTION_PAYMENT_SUCCESS`/`FAILED`). The
  signature (`x-webhook-signature`) is verified against the raw body before any
  state change. Cashfree's documented algorithm signs with the client secret;
  a separate dashboard webhook secret is also accepted if one is configured.
- Cashfree subscriptions use a hosted checkout (`subscriptionsCheckout` from
  `sdk.cashfree.com`), not a redirect URL — the API returns a session id and
  the SPA opens the window. `CASHFREE_ENV` controls sandbox vs production.
- Cashfree returns the browser to `return_url` with a **POST** (form data), so
  that URL points at the API (`/api/billing/return`), which replies `303` to
  `/plans?upgraded=1`. Sending the POST at the static SPA host returns nginx
  `405 Not Allowed`.
- Webhooks are the fast path, not the only one: when the client asks for its
  subscription and we still think it is not premium, the API re-checks Cashfree
  (`GET /subscriptions/:id`) and syncs the result. A missed or misconfigured
  webhook therefore self-heals on the next page load, and the redirect payload
  is never trusted on its own.
