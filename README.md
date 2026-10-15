# BookLeaf Author Support & Communication Portal

Two portals in one app: an **author portal** (books, royalties, tickets) and an **admin portal** (ticket queue with AI classification, AI priority scoring and AI-drafted replies grounded in the BookLeaf knowledge base). Tickets update live through Server-Sent Events.

**Stack:** Node.js 18+ · Express 5 · SQLite (`better-sqlite3`) · JWT auth · Zod validation · Anthropic Claude (Haiku-class) · vanilla JS SPA (no build step).

## Quick start

```bash
npm install
cp .env.example .env        # add ANTHROPIC_API_KEY (optional: the app runs without it)
npm start                   # http://localhost:3000, auto-seeds on first run
npm test                    # 8 integration tests (mock LLM server, in-memory DB)
```

`npm run reset-db` wipes and reseeds. Without an API key the app runs in **fallback mode** (rules-based triage, template drafts), so it is fully usable offline.

### Demo credentials (seeded)
| Role | Email | Password |
|---|---|---|
| Admin | `admin@bookleaf.com` (also `ops2@bookleaf.com`) | `Admin@123` |
| Author | any author email from the dataset, e.g. `priya.sharma@email.com`, `ananya.reddy@email.com`, `kavita.deshmukh@email.com` | `Author@123` |

Edge cases to try: `sneha.kulkarni@email.com` (book **in production**, no pricing/royalty), `kavita.deshmukh@email.com` (₹850 pending, below the ₹1,000 threshold, plus a book in typesetting), `ananya.reddy@email.com` (₹2,546 pending, never paid), `meera.nair@email.com` (fully paid book). Seven demo tickets are pre-created.

**Seeing real-time:** open an author in one browser and an admin in another (or a private window). Send a reply as admin; the author's ticket page updates without refresh. Submit a ticket as author; it appears in the admin queue with a toast.

## Deployment (Render / Railway)
Build: `npm install` · Start: `npm start` · Env: `NODE_ENV=production`, `JWT_SECRET=<long random>`, `ANTHROPIC_API_KEY`, optional `AI_MODEL`. SQLite lives at `DB_PATH` (default `./data/bookleaf.db`); mount a persistent disk there, or accept that the DB reseeds on restart (fine for a demo). Single-instance only (see limitations).

## Architecture

```
public/            SPA (hash router, SSE client)
src/
  app.js server.js config.js
  middleware/      auth (JWT, role guard) · validate (Zod) · errorHandler (typed AppError -> JSON)
  routes/          auth · books · tickets (author) · admin · events (SSE) · schemas (Zod)
  services/
    tickets.js     domain logic: lifecycle, filters/sort, ownership, triage orchestration
    context.js     builds compact "account facts" + payout-cycle maths (done in code, not by the LLM)
    events.js      SSE hub (admins get all events, authors only their own)
    ai/
      provider.js  LLM client: timeout, retry, circuit breaker
      classifier.js category+priority (JSON, Zod-validated)   prompts.js  all prompt text
      drafter.js   cached reply drafts                         knowledgeBase.js  KB split by topic
      rules.js     deterministic fallback + policy floor       usage.js  token/latency ledger
  db/              schema, seed
```

Key decisions
- **Layering:** routes only parse/validate and delegate; services hold business rules; `ai/` is isolated behind `classifyTicket` and `getDraft`, so swapping provider touches one file (`provider.js`).
- **SQLite:** zero-setup for reviewers, relational integrity, trivial seeding. The schema is portable to Postgres (ownership via `author_id` FKs, indexes on author and queue columns).
- **Internal notes** live in a separate table (`ticket_notes`) and author endpoints use an explicit allow-list serializer (`toAuthorView`), so notes, priority, AI reasoning and assignee can't leak by accident.
- **RBAC:** every route group uses `authenticate` + `requireRole`. Authors get **404** (not 403) for other authors' tickets/books, so ids can't be probed. Ownership is derived from the JWT, never from request input.
- **Real-time:** SSE (one-way push, auto-reconnect, no extra infra). The client refetches the affected resource on an event, so the server stays the source of truth. The admin composer is not overwritten while the admin is typing.
- **Ticket lifecycle:** Open → In Progress (on first admin reply or by choice) → Resolved/Closed. An author reply on a Resolved ticket reopens it; Closed tickets reject replies. Replying auto-assigns an unassigned ticket to that admin.
- **Urgency in the queue:** default sort is unresolved first → Critical→Low → oldest first. Tickets waiting 48h+ get a red marker and appear in a stat card.

## AI integration

**Model:** Anthropic Claude Haiku-class (`AI_MODEL`, default `claude-haiku-5-5`). Short, structured tasks (classification, 150-word grounded reply) don't need a large model; Haiku gives low latency and cost, follows format instructions reliably, and handles Indian-English queries well. Switching models is one env var.

**Flow on ticket creation**
1. Ticket is saved and returned to the author immediately, with a *rules-based* category/priority already set, so it is sortable at once.
2. In the background, one small LLM call returns `{category, priority, reasoning}` as JSON, validated with Zod (enums enforced). Valid output replaces the rules result and is tagged `AI`.
3. Admin overrides set `*_source = 'admin'`; later AI results never overwrite an override (this also handles the race where an admin overrides while triage is in flight).

**Priority:** rubric in the prompt (Critical: long-overdue money/legal/fraud; High: ISBN errors, defective prints, missing royalty; Medium; Low), plus a code-level **policy floor**: reported ISBN errors are always ≥ High, per the KB.

**Drafting (prompt strategy)**: a static system prompt (role, tone guidelines, hard rules: use only supplied facts, never invent numbers/dates, sign-off format, length) and a per-ticket user prompt made of tagged blocks: `<policy>` (only the KB sections for this category), `<reference_reply>` (one calibration example for this category), `<account_facts>` (JSON), optional `<later_messages>`, `<ticket>`. Facts such as the next payout cycle, "below ₹1,000 threshold" and "in production, no sales" are **computed in code** and passed as flags, so the model explains rather than calculates. Drafts are editable and the sent message records whether it was AI-assisted.

**Cost awareness**
- Classification prompt contains no KB and no history; `max_tokens` 120.
- Draft prompt includes only the relevant KB section (~150-250 tokens instead of the full KB), one example, only the referenced book (or a compact one-line-per-book list for account-level tickets), and at most the last 4 thread messages (500 chars each). Description is clipped to 2,000 chars. `max_tokens` 450. Internal notes are never sent.
- Drafts are **cached per ticket** (opening a ticket repeatedly costs nothing) and regenerated only on demand, when the category is overridden, or when the author replies.
- Every call is logged to `ai_usage` (tokens, latency, success) and surfaced at `GET /api/admin/stats`.
- Further option (not enabled): prompt caching on the static system prompt once volume justifies it.

**Graceful degradation**
- Provider: 15 s timeout, one retry on 429/5xx/network (honours `Retry-After`), and a **circuit breaker** (3 consecutive failures → AI skipped for 60 s) so an outage never slows the UI.
- Triage failure → rules-based category/priority, `ai_status = fallback`, ticket unaffected.
- Draft failure → a **template draft** built from the same account facts, flagged in the UI ("AI unavailable; review before sending"). Admins can always write manually; sending never depends on AI.
- Malformed model output (non-JSON / invalid enum) is treated as a failure and falls back.

**API key security:** read only from `process.env` (`src/config.js`), used only server-side in `provider.js`, never serialised to a response, never in the frontend; `.env` is git-ignored. `/api/admin/stats` exposes only `configured: true/false` and the model name.

## API reference
Base path `/api`. Auth: `Authorization: Bearer <jwt>`. Errors: `{"error":{"code","message","details?"}}` with 400 validation (field-level `details`), 401, 403, 404, 409, 429, 500.

| Method & path | Role | Description |
|---|---|---|
| `POST /auth/login` | public (rate-limited) | `{email,password}` → `{token,user}` |
| `GET /auth/me` | any | Current user |
| `GET /books` | any | Author: own books. Admin: all, optional `?author_id=` |
| `GET /books/:id` | any | One book (404 if not yours) |
| `GET /tickets` | author | Own tickets |
| `POST /tickets` | author | `{book_id|null, subject(5-150), description(20-5000), attachments?[{name,size}]}` → 201; AI triage runs async |
| `GET /tickets/:id` | author | Ticket + public thread (no internal data) |
| `POST /tickets/:id/messages` | author | Follow-up; reopens Resolved tickets; 409 if Closed |
| `GET /admin/tickets` | admin | Filters: `status category priority assigned(me\|unassigned) from to q sort(urgency\|oldest\|newest)` |
| `GET /admin/tickets/:id` | admin | Ticket, thread, internal notes, account facts |
| `PATCH /admin/tickets/:id` | admin | `{status?, category?, priority?, assigned_to?: 'me'\|null}` (category/priority recorded as admin override) |
| `POST /admin/tickets/:id/reply` | admin | `{body, status?, ai_assisted?}` → visible to author |
| `POST /admin/tickets/:id/notes` | admin | Internal note |
| `GET /admin/tickets/:id/draft` | admin | Cached AI (or template) draft; generates if none |
| `POST /admin/tickets/:id/draft` | admin | Force regenerate |
| `GET /admin/stats` | admin | Queue counters + AI status/token usage |
| `GET /events?token=` | any | SSE: `ticket:created`, `ticket:updated`, `ticket:message` |
| `GET /health` | public | Liveness |

## Testing
`npm test` runs end-to-end tests against the real app with a **mock Anthropic server**: auth, cross-author isolation (404/403), validation, in-production book data, AI triage and caching (asserts only the relevant KB section is sent and one draft call per ticket), admin override precedence, AI-outage fallback (rules triage + template draft + manual reply), and queue ordering/filters.

## Assumptions
- "Today" for payout maths is the server date; the next payout is the current cycle's quarter end + 45 days, per KB.
- Tickets about books still in production are allowed (authors commonly ask for status); production books show on My Books with "pricing appears once published".
- Attachments are UI-only per the brief: file names are stored, files are not.

## Known limitations / next steps
- SSE hub is in-memory → single instance. Scale-out: Redis pub/sub (or Postgres LISTEN/NOTIFY).
- JWT in `localStorage` and in the SSE query string. Production: httpOnly cookies + short-lived SSE ticket; password reset; account lockout; audit log.
- Real file uploads (S3 + virus scan); email notifications to authors on reply.
- Draft staleness handled for category change and author replies; no per-edit diff tracking yet (would measure how much admins edit AI drafts, a key quality metric).
- Classification accuracy should be evaluated on a labelled set before trusting it unsupervised; add a confidence field and route low-confidence tickets to manual triage.
- Royalty facts come from the dataset as-is; in production the draft context would be fetched live from the royalty/production systems.
