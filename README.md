# StudyFlip

AI-powered flashcards with SM-2 spaced repetition. Upload a PDF of your notes;
we extract the text, generate flashcards with an LLM, and schedule your reviews.
See `PLAN.md` for the engineering plan.

## Features

- **Auth** — email/password sessions (argon2 hashes, httpOnly cookies)
- **Documents** — PDF upload (≤10 MB) → background text extraction (unpdf)
- **AI generation** — chunked extraction → flashcards via Groq (`openai/gpt-oss-120b`), review & save to deck
- **Decks & cards** — full CRUD, soft deletes, ownership scoping
- **Study sessions** — due-queue or per-deck, 3D flip UI, Again/Hard/Easy ratings
- **SM-2 scheduling** — ease, intervals, lapses; failed cards rejoin immediately
- **Dashboard** — decks/cards/due/reviews, recall accuracy, day streak, 30-day activity
- **Billing** — free tier (5 gens/mo) + premium ($8/mo, 200 gens/mo) via Stripe Checkout & webhooks

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

In a second terminal, run the background worker (PDF extraction + AI generation):

```bash
npm run worker -w server
```

## Environment variables (server/.env)

| Variable            | Required | Notes                                            |
| ------------------- | -------- | ------------------------------------------------ |
| `MONGO_URI`         | yes      | e.g. `mongodb://127.0.0.1:27017/studyflip`       |
| `SESSION_SECRET`    | yes      | ≥16 chars                                        |
| `CLIENT_ORIGIN`     | no       | default `http://localhost:5173` (CORS + cookies) |
| `GROQ_API_KEY`      | no       | Groq key; omit to disable AI generation (graceful) |
| `GROQ_BASE_URL`     | no       | default `https://api.groq.com/openai/v1`         |
| `GROQ_MODEL`        | no       | default `openai/gpt-oss-120b`                    |
| `STRIPE_SECRET_KEY` | no       | omit to disable billing (checkout returns 404)   |
| `STRIPE_PRICE_PREMIUM` | no    | premium price ID                                 |
| `STRIPE_WEBHOOK_SECRET` | no  | for signature-verified webhooks                  |
| `PORT`              | no       | default `4000`                                   |

## Tests

```bash
npm test
```

Server tests (49) boot an in-memory MongoDB automatically — no local database needed.

## Deployment

- **API + worker**: two processes from the same image (`node src/server.js` /
  `node src/worker.js`); point `MONGO_URI` at Atlas, set all required env vars.
- **SPA**: `npm run build` emits static files in `client/dist`; serve from any
  CDN or reverse proxy and proxy `/api` to the API (same-origin keeps cookies simple).
- Behind a reverse proxy the app already sets `trust proxy` for correct
  secure-cookie behavior (`SESSION_SECRET` must be set, `NODE_ENV=production`).
- Stripe: point a webhook at `POST /api/billing/webhook` with the signing secret
  in `STRIPE_WEBHOOK_SECRET`; the raw body is verified before any state change.
