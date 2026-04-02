# ChatBridge / TutorMeAI

ChatBridge is a conversational AI platform built for K-12 education. It embeds sandboxed third-party learning apps — Chess, Timeline Builder, and an Artifact Investigation Studio — directly inside a chat interface, then injects each app's live state into the LLM's context on every conversation turn. The result is an AI tutor that genuinely sees what the student is doing and can coach, explain, and respond to the actual board position, timeline events, or artifact annotations — not a generic approximation.

---

## What It Does

**Context-aware tutoring with sandboxed apps.** Students interact with embedded learning activities while the AI tutor maintains a running awareness of the app state. When a student asks "what should I do next?" during a chess game, the LLM receives the actual FEN string, move history, and piece positions — not a description. The AI's answer is grounded in the real game state, not a generic chess lecture.

**Three built-in learning activities.** The Chess app supports full-game play with an optional "Teach Me Mode" that adds strategic coaching overlays to every move. The Timeline Builder lets students construct historical timelines by adding, categorizing, and ordering events; the LLM can reference the actual events when offering analysis. The Artifact Investigation Studio connects to the Smithsonian Open Access collection and Library of Congress APIs, guiding students through a structured observation → evidence → claims workflow that ends with AI-generated rubric scoring.

**Safety-first architecture for K-12.** Every user message is inspected for prompt injection before the LLM is called. Output is moderated before reaching the student. Plugin state is sanitized before context injection. Sessions can be frozen by teachers. All events are audited. The iframe sandbox permanently excludes `allow-same-origin` — no plugin app can ever access the parent session.

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│  React 19 SPA (Vite)                                 │
│  Wouter router · shadcn/ui · tRPC client             │
│  ┌──────────────┐  ┌──────────────────────────────┐  │
│  │  Chat.tsx    │  │  PluginContainer.tsx          │  │
│  │  SSE client  │  │  <iframe sandbox="…">         │  │
│  └──────────────┘  │  PluginBridge postMessage     │  │
│                    └──────────────────────────────┘  │
└────────────────────────┬────────────────────────────┘
                         │ HTTP / SSE / tRPC
┌────────────────────────▼────────────────────────────┐
│  Express 4 server                                    │
│  ┌──────────────────────────────────────────────┐    │
│  │  /api/stream  (SSE route, registered first)  │    │
│  │  inspectInput() → assembleContext()           │    │
│  │  invokeLLMStream() → tool loop (max 3)        │    │
│  │  moderateOutput() → SSE token events          │    │
│  └──────────────────────────────────────────────┘    │
│  ┌──────────────────────────────────────────────┐    │
│  │  /api/trpc/*  (tRPC middleware)               │    │
│  │  conversations · plugins · artifacts          │    │
│  └──────────────────────────────────────────────┘    │
│  ┌──────────────────────────────────────────────┐    │
│  │  server/_core/llm.ts                         │    │
│  │  Manus Forge API (OpenAI-compatible)         │    │
│  │  Model: claude-sonnet-4-5                    │    │
│  └──────────────────────────────────────────────┘    │
└────────────────────────┬────────────────────────────┘
                         │ Drizzle ORM
┌────────────────────────▼────────────────────────────┐
│  MySQL / TiDB Cloud                                  │
│  users · conversations · messages · plugin_schemas   │
│  plugin_states · audit_logs · safety_events          │
│  plugin_failures                                     │
└─────────────────────────────────────────────────────┘
```

**SSE streaming pipeline.** The `/api/stream` endpoint is a plain Express route registered before tRPC middleware. Auth, rate limiting, conversation loading, and context assembly all complete before `res.flushHeaders()` is called. The `Server-Timing: assembleContext;dur=N` header reports context assembly latency. A 15-second heartbeat keeps proxies alive. An `AbortController` cancels in-flight LLM streams on client disconnect.

**Plugin postMessage protocol.** Every message between the platform and an embedded app uses a versioned envelope (`version: 1`). `PluginBridge.ts` validates `event.origin`, `sessionId`, `pluginId`, and `version` on every inbound message. Rejected messages are written to `audit_logs` with `eventType: 'PROTOCOL_VIOLATION'`. The iframe sandbox is permanently `"allow-scripts allow-forms allow-popups"` — `allow-same-origin` is never present.

**Context assembly engine.** `assembleContext()` in `server/contextAssembly.ts` loads the last N messages, summarizes if the conversation exceeds 60,000 tokens, injects the active plugin's sanitized state as a system message, and returns only the active plugin's tool schemas. The assembled context is server-internal — it is never returned to the client.

**Safety inspection pipeline.** `inspectInput()` checks every user message synchronously before the SSE connection opens. If a message is blocked, the client receives a plain HTTP 400 — the LLM is never called. `moderateOutput()` runs on every LLM response token batch before the `token` SSE event is emitted. Both functions write to `safety_events` and `audit_logs` on any flag.

---

## User Roles

| Role | Capabilities |
|---|---|
| **student** | Chat with AI tutor, use all three learning apps, view own portfolio, complete artifact investigations |
| **teacher** | All student capabilities + view all student sessions, read message history, freeze/unfreeze sessions, view safety events |
| **admin** | All teacher capabilities + manage plugin schemas, enable/disable plugins, view all audit logs, manage users |

The platform owner's `openId` (set via `OWNER_OPEN_ID`) is automatically assigned `admin` on first login. All new users default to `student`.

---

## The Three Apps

### Chess (with Teach Me Mode)

The Chess app supports standard algebraic notation for moves, displays a live board, and sends full game state (FEN string, move history, captured pieces, current player) to the LLM as a `STATE_UPDATE` postMessage on every move. The LLM receives the literal board position and can answer questions like "what's my best move?" with genuine positional awareness.

**Teach Me Mode** is a teacher-facing toggle in the chess panel. When active, a coaching prompt is injected server-side on every turn, instructing the LLM to explain the strategic significance of each move, name the tactical ideas at play, and describe the opponent's best response. This is a server-side prompt injection — not a client-side display toggle.

### Timeline Builder

The Timeline Builder lets students construct visual timelines by adding events with a year, title, description, and category (political, cultural, scientific, economic, military). Events can be reordered. The LLM receives the full ordered event list as plugin state and can reference specific events, suggest missing entries, and offer historical analysis grounded in what the student has actually built.

### Artifact Investigation Studio

The Studio connects to the Smithsonian Open Access API (and Library of Congress as fallback) via a server-side proxy. Students search for real collection items, select an artifact for detailed investigation, add typed annotations (observation, question, connection, evidence), and submit an inquiry question with a conclusion. On submission, the LLM generates a `RubricCard` scoring the investigation across four dimensions: Observation Quality, Evidence Use, Historical Reasoning, and Inquiry Depth. Completed investigations appear in the student's portfolio at `/portfolio`.

---

## Security Model

**iframe sandboxing.** Plugin apps run in `<iframe sandbox="allow-scripts allow-forms allow-popups">`. The `allow-same-origin` attribute is permanently excluded — no plugin can access the parent session's cookies, localStorage, or DOM. The `credentialless` attribute adds a second isolation layer. Every plugin iframe has a descriptive `title` attribute for screen readers.

**Prompt injection detection.** `inspectInput()` checks seven injection patterns before the SSE connection opens. A blocked message returns HTTP 400 and writes to `safety_events` — the LLM is never called. Plugin state is sanitized by `sanitizePluginState()` before context injection: keys named `system`, `instructions`, `prompt`, or `ignore` are stripped; string values over 6,000 characters are truncated.

**Output moderation.** `moderateOutput()` runs on every LLM response before it reaches the client. Flagged responses are redacted and written to `safety_events`.

**Rate limiting.** A sliding-window in-memory rate limiter enforces 10 LLM requests per minute per authenticated user. Rejected requests receive an SSE `{ type: "error", code: "RATE_LIMITED" }` event (not HTTP 429) since the auth/conversation checks run before the stream opens.

**Circuit breaker.** Three plugin tool call failures within five minutes trips the circuit breaker for that `(pluginId, conversationId)` pair. Subsequent invocations return an immediate error; the LLM receives the error and generates a natural-language degradation message. The circuit resets after 15 minutes.

**Audit logging.** Every LLM request, safety event, plugin lifecycle event, circuit breaker event, rate limit violation, and authentication failure is written to `audit_logs` via the fire-and-forget `auditLog()` helper. Raw message content never appears in audit logs — only token counts, tool names, and safety flags.

---

## Local Development Setup

### Prerequisites

- Node.js 20+
- pnpm 9+
- A MySQL or TiDB Cloud database
- A Manus Forge account (for the LLM API and OAuth)

### Steps

**1. Clone the repository**

```bash
git clone https://github.com/Theesamkos/chatbridge.git
cd chatbridge
```

**2. Install dependencies**

```bash
pnpm install
```

**3. Set up environment variables**

```bash
cp .env.example .env.local
```

Open `.env.local` and fill in all values. See the [Environment Variables](#environment-variables) section below.

**4. Run database migrations**

Generate the migration SQL:

```bash
pnpm db:generate
```

Apply the generated SQL via your database panel (Manus Forge database panel or TiDB Cloud SQL editor). Do not use `drizzle-kit push` or `drizzle-kit migrate` — always review the SQL before applying.

**5. Seed the database**

```bash
pnpm seed
```

This creates three demo accounts:
- Student: `student@demo.com` / `demo123`
- Teacher: `teacher@demo.com` / `demo123`
- Admin: `admin@demo.com` / `demo123`

**6. Start the dev server**

```bash
pnpm dev
```

This starts both the Express server (port 3001) and the Vite dev server (port 3000) concurrently. Open `http://localhost:3000`.

**7. Run tests**

```bash
pnpm test
```

---

## Environment Variables

| Variable | Description |
|---|---|
| `VITE_APP_ID` | Manus Forge application ID (from the Forge dashboard) |
| `JWT_SECRET` | Secret for signing session JWTs — any random string, minimum 32 characters |
| `DATABASE_URL` | MySQL/TiDB connection string: `mysql://user:password@host:port/database` |
| `OAUTH_SERVER_URL` | Manus Forge OAuth server base URL |
| `OWNER_OPEN_ID` | The `openId` of the platform owner — this account gets `admin` role automatically |
| `BUILT_IN_FORGE_API_URL` | Manus Forge LLM API base URL |
| `BUILT_IN_FORGE_API_KEY` | Manus Forge API key for Claude Sonnet access |

All values are read through `server/_core/env.ts`. Never hardcode credentials in source files.

---

## Running Tests

Tests use **Vitest** and are organized in three layers:

**Unit tests** (`server/*.test.ts`) — test individual server functions in isolation:
- `server/safety.test.ts` — four cases: clean input passes, prompt injection blocked, jailbreak blocked, maximum-length input passes
- `server/contextAssembly.test.ts` — three invariants: tool filtering (active plugin only), state sanitization, token budget enforcement
- `server/rateLimiter.test.ts`, `server/circuitBreaker.test.ts`, `server/auditLog.test.ts`

**Integration tests** (`server/routes/*.test.ts`) — test tRPC procedures with three auth paths each: authenticated success, unauthenticated rejection (`UNAUTHORIZED`), and role-based rejection (`FORBIDDEN`).

**End-to-end scenario verification** — documented in `SCENARIO_VERIFICATION.md`. Seven scenarios covering chess context awareness, Teach Me Mode, Timeline Builder completion, full artifact investigation workflow, safety blocking, session freeze/unfreeze, and circuit breaker activation.

```bash
# Run all tests
pnpm test

# Run with coverage
pnpm test --coverage

# TypeScript type checking
pnpm check

# Production build
pnpm build
```

---

## Project Documentation

| File | Contents |
|---|---|
| `CLAUDE.md` | Full architecture decisions, locked rules, database schema, postMessage protocol |
| `ARCHITECTURE_DECISIONS.md` | Seven ADRs covering auth, database, LLM, SSE streaming, plugin hosting, external APIs, and framework choice |
| `SCENARIO_VERIFICATION.md` | End-to-end test results for all 7 scenarios |
| `SECURITY_VALIDATION.md` | Security checklist results |
| `PERFORMANCE_METRICS.md` | Measured latency and throughput metrics |
| `ACCESSIBILITY_AUDIT.md` | WCAG 2.1 AA compliance audit (14 checks, all PASS) |
| `COST_ANALYSIS.md` | Token cost projections at scale |
| `DEMO_SCRIPT.md` | Structured walkthrough for evaluators |
