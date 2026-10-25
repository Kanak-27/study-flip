# StudyFlip — Implementation Plan

This document turns `idea.txt` into an engineering plan: what we're building, the decisions
behind it, and in what order. It is the reference for all subsequent implementation work —
if a decision changes later, it changes here first.

---

## 1. Reading of the idea

StudyFlip has one core loop that everything else exists to serve:

> Upload a PDF → generate flashcards → edit them → study → get scheduled for review → come back tomorrow and revise what's due.

Everything in `idea.txt` that isn't part of that loop (subscriptions, analytics, collab decks)
is explicitly deferred or staged behind the MVP. The plan honors that: **the first shippable
milestone is the full loop working end to end for a single user**, with payments and advanced
analytics built only after it's proven.

Two properties shape the technical design:

1. **Work that outlives a request.** PDF extraction and AI generation take seconds to minutes.
   They cannot run inside an HTTP request — this forces an async job model from day one.
2. **Per-user isolation is a hard requirement.** Every query is scoped by owner; this is a
   tenancy rule, not a UI convention.

---

## 2. Scope

### MVP (in scope)

- Email/password registration and login, session-based
- PDF upload with validation; async text extraction
- AI flashcard generation with chunking and output validation
- Review/edit/regenerate generated cards before saving to a deck
- Deck CRUD + manual card CRUD
- Study session UI with hidden answers and 3D flip animation
- SM-2 spaced repetition: review logging, scheduling, daily due queue
- Dashboard: counts, due-today queue, recall accuracy, streaks

### Explicitly out of scope for MVP

- Payments and subscription enforcement (Phase 7 — designed for, not built)
- OCR for scanned PDFs (text-layer PDFs only; scanned files fail with a clear message)
- Collaborative decks, social features, leaderboards
- Multiple AI strategies / model routing (one prompt, one structured output schema)
- Native mobile apps

The MVP is done when a user can upload a PDF, get an editable deck, study it, close the
browser, come back two days later, and see exactly the cards that are due.

---

## 3. Tech stack and rationale

The stack is **MERN** — MongoDB, Express, React, Node — kept as simple as possible: one
language across the whole app, two processes (API server, worker) plus the frontend, and one
database. No ORM abstraction, no message broker, no framework magic.

| Concern | Choice | Why |
|---|---|---|
| Runtime / language | Node.js 22 LTS, JavaScript (ESM) | One language across client, API, and worker; plain JS keeps the toolchain free of build-time type machinery — runtime validation (below) is where type safety is enforced instead |
| Database | MongoDB + Mongoose | Native fit for the MERN choice; documents nest cleanly (card + scheduling state); Mongoose gives schema validation and hooks without a separate migration tool |
| API | Express 5, plain route modules | Smallest well-understood HTTP layer; no framework conventions to learn; every endpoint is an ordinary function |
| Frontend | React 19 + Vite + React Router | Fast dev loop, plain SPA talking to the REST API; no SSR complexity to manage |
| Background jobs | Mongo-backed job queue (a `jobs` collection + worker loop) | **No Redis.** Atomic `findOneAndUpdate` claim gives safe single-worker execution; retries via `attempts`/`nextRunAt` fields. One less piece of infrastructure to run. BullMQ is the documented swap-out if throughput ever demands it |
| Validation | Zod | With no compile-time types, Zod *is* the type system: one schema language shared by the API boundary, AI output validation, env config, and Mongoose payloads; a bad payload fails loudly at the edge |
| Auth | `express-session` + `connect-mongo` (session store in Mongo) | Session cookie in httpOnly cookie; sessions live in the DB so they can be revoked; no JWT key-rotation machinery |
| PDF extraction | `unpdf` | Works in Node; text-layer extraction only for MVP |
| AI provider | Groq (OpenAI-compatible chat completions) behind a thin internal gateway | Provider stays swappable; the gateway is the only place that knows vendor types |
| Payments (Phase 7) | Stripe, webhook-driven | Industry default; entitlements change only on verified webhook events, never on client callbacks |
| Styling | Tailwind CSS + CSS transforms for the flip | No component-library lock-in; the 3D flip is ~30 lines of CSS, no animation lib needed |
| Tests | Vitest + Supertest (API/domain), Playwright (one happy-path E2E) | SM-2 and validation logic must be unit-tested; one E2E guards the core loop |
| Hosting (suggested) | Render/Railway (API + worker), MongoDB Atlas (free tier), Vercel/Netlify (static client) | Managed everything, generous free tiers to start; worker runs as its own service so long jobs don't block API requests |

**Notable trade-offs accepted:** a modular monolith over microservices (simpler ops, boundaries
still enforced by folder structure and import rules); Mongo-backed jobs over BullMQ (no Redis
to operate — we accept ~100 lines of queue code with bounded retries and a visibility timeout);
raw Express over NestJS (Nest's DI/decorator machinery is exactly the "framework ceremony"
this project doesn't need yet).

**Repository layout** — one repo, two apps:

```
studyflip/
  server/            Express API + worker (same codebase, two entrypoints)
    src/
      modules/       feature modules (see §4.2)
      platform/      db connection, job queue, config, logger, errors
      app.js         Express app assembly (middleware, routes, error handler)
      server.js      process entrypoint: config → db → app.listen
      worker.js      process entrypoint: config → db → job loop
    tests/
  client/            React SPA (Vite)
    src/
      api/           fetch client, one function per endpoint
      features/      auth, decks, study, dashboard, upload — mirrors server modules
      components/    shared UI
  package.json       workspaces: ["server", "client"]
```

---

## 4. Architecture

### 4.1 Layers

```
Presentation      React components, pages, client state
    ↓  HTTP (JSON, session cookie)
API surface       Express routes: parse/validate input, auth check, delegate, shape response
    ↓
Application       Use-case services (one function per business action)
    ↓
Domain            Pure logic: SM-2 scheduling, card validation, quota rules, plan limits
    ↓
Infrastructure    Mongoose repositories, job queue, AI gateway, PDF extractor, Stripe
```

Rules that keep this honest:

- **Domain has no imports** from Express, Mongoose, or vendor SDKs. Scheduling math is a pure
  function — `schedule(state, rating) → state`. That's what makes it testable.
- **Route handlers never talk to the database directly.** They call a use case. This is where
  ownership checks live, so they can't be forgotten in one endpoint and present in another.
- **Cross-module communication is by calling the other module's public interface** (an exported
  service function), never by reaching into its collections. Where a real async boundary exists
  (generation finishing → deck created), modules communicate via a job on the queue.

### 4.2 Feature modules

Modules follow the eight modules in `idea.txt` almost one-to-one:

```
server/src/modules/
  auth/          registration, login, session middleware, ownership guards
  documents/     upload, validation, extraction job
  generation/    AI gateway, prompt, chunking, output validation, regeneration
  decks/         deck + flashcard CRUD
  study/         study sessions, review recording, due-queue queries
  scheduling/    SM-2 domain logic (pure), scheduling state transitions
  analytics/     dashboard aggregates, streaks, accuracy
  billing/       plans, quotas, usage events, Stripe webhooks   (Phase 7)
```

Each module exposes a `service.js` (public API) and a `routes.js` (its Express router),
keeps its Mongoose models internal, and owns its Zod schemas. Import direction:
`app → modules → platform`. Cycles between modules are a bug.

### 4.3 Async pipelines

**Document processing**

```
POST /api/documents (multipart)
  → validate type/size/magic bytes
  → insert document row (status: pending)
  → enqueue job "extract" (jobs collection)
worker:  extract text → if empty/failed: status=failed + reason
         else status=extracted, store text (GridFS or local volume for MVP)
         → no further job; generation is user-triggered
```

**Flashcard generation**

```
POST /api/documents/:id/generate
  → check quota (usage event reserved first, released on failure)
  → insert generation run (status: running)
  → enqueue job "generate"
worker:  chunk text (~3k tokens, paragraph-aware overlap)
         for each chunk: prompt → JSON → Zod-validate → reject/repair bad cards
         merge chunks, dedupe near-identical Q/A pairs
         → generation run status: completed | partial | failed
client polls run status; user reviews cards, edits, then saves to a deck
```

**The job queue (MVP implementation).** A `jobs` collection with
`{ type, payload, status, attempts, maxAttempts, nextRunAt, lastError, createdAt }`.
The worker claims work atomically with
`findOneAndUpdate({ status: 'queued', nextRunAt: { $lte: now } }, { $set: { status: 'running' } })`,
which makes double-processing impossible even with multiple workers. Failures increment
`attempts` and set an exponential `nextRunAt`; past `maxAttempts` the job moves to `failed`
and the owning record (`document` / `generation_run`) gets a visible error message. A
`heartbeatAt` field lets the dashboard detect a dead worker. Jobs older than a visibility
timeout whose worker hasn't heartbeated are reclaimed.

Both job types use bounded retries with exponential backoff. Failures land in a visible
`failed` state with a human-readable reason — silent failure of a paid-for AI call is the
worst outcome for the user.

---

## 5. Data model

Core collections (Mongoose schemas, defined in the module that owns them):

| Collection | Key fields | Notes |
|---|---|---|
| `users` | _id, email (unique index), passwordHash, name, createdAt | Argon2id hashing |
| `sessions` | _id, userId (index), expiresAt (TTL index) | express-session / connect-mongo store |
| `documents` | _id, userId, filename, sizeBytes, status, extractedText, error, createdAt | status: pending → extracting → extracted \| failed |
| `decks` | _id, userId, documentId?, title, subject?, createdAt | documentId nullable — manual decks allowed; soft delete via `deletedAt` |
| `flashcards` | _id, deckId, userId, question, answer, sourceChunk?, state | state: new/learning/review/relearning |
| `schedulingState` | flashcardId (unique), ease, intervalDays, reps, lapses, dueAt, lastReviewAt | 1:1 with card; keeps scheduling out of the card doc |
| `reviewLogs` | _id, userId, flashcardId, rating, prevState, nextState, reviewedAt | Append-only; source of truth for analytics |
| `generationRuns` | _id, userId, documentId, status, cardCount, error, createdAt | Tracks each AI run for retry/regenerate |
| `usageEvents` | _id, userId, type, quantity, occurredAt | Quota accounting; rows, not counters, so limits are auditable |
| `subscriptions` | userId (unique), plan, status, providerSubId, currentPeriodEnd | Phase 7 |
| `jobs` | type, payload, status, attempts, nextRunAt, heartbeatAt | The queue described in §4.3 |

Design decisions worth stating:

- **`userId` denormalized onto `flashcards`, `documents`, and `reviewLogs`.** Every hot-path
  query filters by owner; requiring an aggregation join to enforce isolation is how
  cross-tenant leaks happen. A Mongoose pre-find hook plus a repository convention guarantees
  it's always present.
- **Scheduling state is separate from card content.** Editing a question must never touch
  scheduling; migrations of card text must never reset a review history.
- **`reviewLogs` is append-only.** Analytics read logs, not mutable "current state", so
  historical accuracy and streaks are correct even after cards are rescheduled or deleted.
- Deletion of a deck is a soft delete (cards retain review history for analytics); hard delete
  available as an explicit user action.

Indexes: `flashcards { userId: 1, 'scheduling.dueAt': 1 }` via the scheduling collection
lookup (`schedulingState { dueAt: 1 }` + `flashcards { userId: 1 }`),
`reviewLogs { userId: 1, reviewedAt: -1 }` for dashboard aggregates,
`documents { userId: 1, createdAt: -1 }`. Indexes are declared in schemas and created on
boot — MongoDB needs no migration files for them.

### SM-2 scheduling (domain module)

Standard SuperMemo-2: quality ratings 0–5 mapped from the UI's three-button model
(Again=1, Hard=3, Easy=5 for MVP), ease factor starting at 2.5, intervals:

- rating < 3 → reset repetitions, interval back to 1 day (learning step)
- otherwise: `interval = round(prev_interval * ease)`, first two passes 1 and 6 days
- ease updated as `ease + (0.1 − (5−q) * (0.08 + (5−q) * 0.02))`, floored at 1.3

Because it's a pure function with explicit state in/state out, table-driven unit tests cover
the interesting sequences (fail after long streak, ease floor, relearning). Due-queue query:
`reviewLogs` and scheduling state are keyed by `flashcardId`, so the queue is two cheap
queries instead of an `$lookup` — fetch due `schedulingState` ids (`dueAt <= now`, sorted,
limited), then `flashcards.find({ userId, _id: { $in: ids } })`. The owner filter is applied
before anything else.

---

## 6. API surface (MVP)

Auth: session cookie; all endpoints except register/login return 401 without a valid session.
Every `:id` resource is scoped by `userId` — a valid ID belonging to someone else returns 404,
not 403 (existence itself isn't leaked). All routes are JSON under `/api`.

```
POST   /api/auth/register          POST /api/auth/login        POST /api/auth/logout
GET    /api/me

POST   /api/documents              multipart upload, returns doc row
GET    /api/documents              list own
GET    /api/documents/:id          status + extracted text preview
DELETE /api/documents/:id

POST   /api/documents/:id/generate → { runId }
GET    /api/generation-runs/:id    polling status + generated cards
POST   /api/generation-runs/:id/regenerate
POST   /api/decks/from-run         save selected cards into a deck

GET    /api/decks                  POST /api/decks
GET    /api/decks/:id              PATCH /api/decks/:id        DELETE /api/decks/:id
GET    /api/decks/:id/cards
POST   /api/cards                  PATCH /api/cards/:id        DELETE /api/cards/:id

POST   /api/study/sessions         start; body: { deckIds?, mode: due|deck }
GET    /api/study/sessions/:id     current card + progress
POST   /api/reviews                { flashcardId, rating } → new schedule
GET    /api/study/due              due-today counts by deck

GET    /api/dashboard              aggregates: counts, due, accuracy, streak, history
```

Errors: uniform `{ error: { code, message } }`; domain errors are a small set of known classes, mapped centrally
by one Express error-handler middleware, so handlers don't invent ad-hoc shapes. Mutating
endpoints take Zod-validated bodies and return the updated resource. The client has a single
fetch wrapper that attaches the session cookie and unwraps this error shape. Without compile-time types, the Zod schemas at each endpoint are the contract — every response body that crosses the wire is parsed through one.

---

## 7. Cross-cutting concerns

**Security.** Argon2id password hashing; httpOnly SameSite=Lax session cookie; CSRF via
SameSite + origin check on mutations; rate limits (`express-rate-limit`) on auth and
generation endpoints; upload validation on extension *and* file signature, 10 MB cap, stored
outside the web root with generated names; all AI output treated as untrusted (never `eval`ed,
schema-validated, HTML-escaped); secrets via env only, validated at boot; `helmet` for
baseline headers; CORS locked to the client origin with `credentials: true`.

**Observability.** Structured JSON logs (`pino`) with request/job IDs; every failed job logs
the run ID and error code; the AI gateway logs token usage per run (cost visibility from day
one). No PII — no document text, no passwords — in logs.

**Config.** A single `config.js` that reads and validates env vars with Zod at startup.
Missing config fails fast at boot, not at the first request. `.env.example` documents every key.

**Testing strategy.**
- Unit (pure domain): SM-2 sequences, quota rules, card validation — the code where a subtle
  bug silently corrupts users' schedules.
- API integration (Supertest against the Express app with a test MongoDB): ownership scoping
  covered explicitly — a card owned by user A is invisible to user B through every endpoint.
- Contract: AI gateway response parsing against recorded fixtures, including malformed output.
- E2E (Playwright, one flow): register → upload sample PDF → generate → save deck → study →
  review → due queue updates.

---

## 8. Roadmap

Phases map to `idea.txt` §8. Each ends in a working, demonstrable increment; no phase starts
until the previous milestone is verified by running the app, not just by green tests.

| Phase | Deliverable | Milestone |
|---|---|---|
| 1 — Foundation | Repo, Mongoose schemas, config, auth, empty dashboard, ownership guards | Register, log in, see own (empty) dashboard |
| 2 — Decks & study | Deck/card CRUD, study UI with flip animation, manual reviews logged | Create a deck by hand and study it |
| 3 — PDF pipeline | Upload + validation, extraction job, status tracking | Upload a PDF and read its extracted text |
| 4 — AI generation | Gateway, prompt, chunking, validation, run lifecycle, review/edit/save | PDF → editable deck in one flow |
| 5 — Spaced repetition | SM-2 module, scheduling state, due queue, rescheduling on review | Cards reappear per personal schedule |
| 6 — Dashboard | Aggregates, accuracy, streaks, history | User can see progress and today's work |
| 7 — Subscriptions | Plans, quotas, Stripe, verified webhooks, entitlement checks | Free limits enforced server-side; premium unlocked via webhook |
| 8 — Hardening & deploy | Full test pass, error/loading polish, prod env, monitoring, launch | Deployed and usable by real users |

Sequencing rationale: Phase 2 deliberately precedes any AI — the learning loop must work
without a paid external dependency. Phase 5 is isolated as pure logic so scheduling is
correct before analytics (Phase 6) builds on top of review data. Billing comes second-to-last
by design, matching the idea's own instruction to defer it.

Estimated effort if built full-time: Phases 1–2 ≈ 1 week, Phase 3 ≈ 3 days, Phase 4 ≈ 1 week,
Phase 5 ≈ 3 days, Phase 6 ≈ 4 days, Phase 7 ≈ 1 week, Phase 8 ≈ 4 days.

---

## 9. Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| AI returns malformed or off-topic cards | Broken deck, wasted tokens | Zod-validated schema, per-chunk retry then drop, user review gate before saving, token-usage logging |
| Long documents blow past model context/cost | Failed or expensive runs | Paragraph-aware chunking with overlap, per-run card-count cap, quota reservation before enqueueing |
| Scanned/image-only PDFs | "Empty document" complaints | Detect zero text layer early; return explicit "no text found — OCR coming later" instead of an empty deck |
| SM-2 bug corrupts schedules | Silent, user-visible trust damage | Pure function + table-driven tests; reviewLogs as append-only source of truth for recovery |
| Cross-user data exposure | Critical privacy failure | Ownership enforced in one layer (use cases), scoping on every query, dedicated integration tests per endpoint |
| Home-grown job queue misbehaves (lost jobs, double-runs, worker crash) | Documents stuck in `pending` | Atomic claim, visibility timeout + heartbeat reclaim, bounded retries, `failed` states surfaced in UI, queue logic covered by integration tests; BullMQ documented as the drop-in replacement if we outgrow it |
| Vendor lock-in (AI, Stripe) | Cost/migration leverage lost | Internal gateway and thin billing adapter; domain never imports vendor types |

---

## 10. Assumptions

These are my calls where the idea (or your instruction) left the question open; challenge any
of them and this document gets updated before code is written:

1. **MERN as given** — MongoDB is the single datastore, including the session store and the
   job queue. This is what keeps infrastructure to "one DB, two Node processes, one static
   host."
2. **Text-layer PDFs only** for MVP (matches the idea's own OCR deferral).
3. **Three-button rating scale** (Again / Hard / Easy) mapped onto SM-2's 0–5 — five buttons
   is a UX burden for the audience and can be added later without touching stored state.
4. **Email/password first.** OAuth providers can be added later behind the same session layer.
5. **Stripe** for payments in Phase 7, with entitlements driven exclusively by webhooks.
6. **English-only prompts/UI** initially.
7. **Plain JavaScript (ESM), no TypeScript.** The simplest possible toolchain means no `tsc`,
   no build step on the server, no type-level noise. The safety TypeScript would have given us
   is recovered where it matters most: Zod validation at every API boundary, on every AI
   response, and on env config, plus JSDoc annotations on the pure scheduling/domain functions
   (editor hints without a compiler) and plain ESLint + `eslint-plugin-jsdoc` to keep them
   honest. Runtime validation — not the compiler — is this project's safety net.
