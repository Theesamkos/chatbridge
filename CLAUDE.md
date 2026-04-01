# ChatBridge / TutorMeAI — Project Context for Claude Code

> **This file is reference context, not instructions to execute.** Read it in full before responding to any prompt in this project. Every architectural decision, constraint, and naming convention documented here is locked. Do not deviate from them without explicit instruction from the developer.

---

## 1. Project Identity

**ChatBridge / TutorMeAI** is a conversational AI platform for K-12 education. It embeds sandboxed third-party learning apps (Chess, Timeline Builder, Artifact Investigation Studio) inside a chat interface and injects their live state into LLM context across conversation turns. The LLM acts as a tutor that can see and reason about what the student is doing inside the embedded app.

**Stack:** React 19 + Wouter · Express 4 · tRPC 11 · Drizzle ORM · MySQL/TiDB · Manus Forge API (LLM + streaming)

**Project path:** `/home/ubuntu/chatbridge`

---

## 2. Locked Architectural Decisions

These six decisions are final. They were evaluated and locked during Phase 0. Do not propose alternatives.

**Decision 1 — Auth: Manus OAuth (current scaffold).** Do not migrate to Supabase Auth. The auth layer is correctly abstracted behind `createContext` and `protectedProcedure`. RLS is enforced at the application layer in tRPC procedures.

**Decision 2 — Database: MySQL/TiDB with Drizzle ORM.** Do not switch to Postgres. JSON columns are used for plugin state snapshots. All queries on `plugin_states` use `conversationId + pluginId + version` — no GIN index required.

**Decision 3 — LLM: Best available model with tool-use support via Manus Forge API.** The `invokeLLM` helper in `server/_core/llm.ts` is used for non-streaming calls. A separate `invokeLLMStream` function handles SSE streaming. Do not add a new LLM client or import from any external AI SDK.

**Decision 4 — SSE streaming: Express route, not tRPC.** The streaming endpoint lives at `/api/stream` as a plain Express route registered in `server/_core/index.ts` before the tRPC middleware. It implements its own auth check using the session cookie — it does not use `protectedProcedure`. tRPC is used for all non-streaming operations.

**Decision 5 — Plugin hosting: Same-origin static files.** Plugin apps are served from `/apps/{pluginId}/index.html` on the same origin. The `PluginBridge` validates `event.origin === registeredOrigin` from the `plugin_schemas` table. In development, `registeredOrigin` is `http://localhost:3000`.

**Decision 6 — External APIs: Server-side proxy only.** The Smithsonian Open Access API and Library of Congress API are proxied through `server/routers/artifacts.ts`. No client-side code may call external APIs directly. Responses are cached with a 24-hour TTL.

---

## 3. Non-Negotiable Rules

These rules apply to every line of code written in this project. They are not style preferences — they are security and correctness invariants.

**Rule 1 — iframe sandbox attribute is a hard constraint.** The iframe sandbox attribute must always be exactly `"allow-scripts allow-forms allow-popups"`. Never add `allow-same-origin`. Any code that includes `allow-same-origin` in the sandbox attribute must be rejected.

**Rule 2 — Safety functions are never bypassed.** `inspectInput()` must be called on every user message before it reaches the context assembly engine. `moderateOutput()` must be called on every LLM response before it is rendered. There is no fast path that skips either function.

**Rule 3 — Audit logging is required for all significant events.** Every plugin lifecycle event, safety event, circuit breaker event, rate limit violation, and authentication failure must be written to `audit_logs`. The `auditLog()` helper is fire-and-forget — it never blocks the main request path.

**Rule 4 — No direct database access in route handlers.** All database operations go through helper functions in `server/db.ts`. Route handlers and tRPC procedures never import `drizzle` or `getDb` directly.

**Rule 5 — No hardcoded credentials.** API keys, secrets, and connection strings are always read from environment variables via `server/_core/env.ts`. Never hardcode them in source files.

**Rule 6 — External API calls are server-side only.** No `fetch` call in any file under `client/` may target an external API URL (Smithsonian, Library of Congress, or any third-party service). All such calls go through the server proxy.

**Rule 7 — postMessage protocol is versioned.** Every message sent through the `PluginBridge` includes a `version` field. Breaking changes to the message shape require incrementing the version and maintaining backward compatibility in `PluginBridge.ts` until all apps are updated.

**Rule 8 — Schema changes require a migration file.** Every change to `drizzle/schema.ts` must be followed by `pnpm drizzle-kit generate` to produce a migration SQL file. The migration is reviewed, then applied via `webdev_execute_sql`. Manual schema edits via the database UI are forbidden.

**Rule 9 — Tests must pass before any feature is considered complete.** `pnpm test` must pass after every change. A failing test is a blocker, not a warning.

**Rule 10 — S3 for all file storage.** File bytes are never stored in database columns. Use `storagePut()` from `server/storage.ts` for all file uploads. Store only the S3 key and URL in the database.

**Rule 11 — Tool descriptions are required and must be complete.** Every tool definition passed to the LLM must include a description that answers: (1) what the tool does, (2) when to call it, and (3) what format the input expects. Tools without complete descriptions must not be registered.

**Rule 12 — Inject only the active plugin's tools.** The context assembly engine injects ONLY the tool schemas for the currently active plugin (`conversations.activePluginId`). Never pass all plugin tool schemas to the LLM at once. If no plugin is active, the `tools` array is empty.

**Rule 13 — Maximum 3 tool invocations per turn, enforced server-side.** The SSE streaming loop in `server/_core/index.ts` must reject tool-use continuations after 3 tool calls in a single conversation turn. This is a server-side hard limit — it is not delegated to the client or LLM.

**Rule 14 — Tool call arguments must be validated with Zod before execution.** Every tool invocation relayed from the LLM (`TOOL_INVOKE` SSE event) must have its `arguments` parsed and validated against a Zod schema derived from the tool's `parameters` definition before being forwarded to the plugin. Invalid arguments are rejected with a structured error — they are never forwarded.

**Rule 15 — The assembled system prompt is never exposed to the client.** The object returned by `buildContext()` in `server/contextAssembly.ts` (including `systemPrompt`, `messages`, and `tools`) must never be logged to a client-visible surface, returned in an API response, or included in SSE events. It is server-internal only.

**Rule 16 — SSE responses require specific headers and must flush immediately.** Every SSE response must set `Content-Type: text/event-stream`, `Cache-Control: no-cache, no-transform`, `Connection: keep-alive`, and `X-Accel-Buffering: no` (prevents nginx/proxy buffering). `res.flushHeaders()` must be called immediately — before any async work — so the client receives the HTTP 200 and begins reading.

**Rule 17 — SSE connections require a 15-second heartbeat.** Every SSE handler must send a keepalive comment (`": heartbeat\n\n"`) every 15 seconds via `setInterval`. The interval must be cleared on client disconnect (`req.on('close', ...)`). Without this, proxies and load balancers silently drop idle connections.

**Rule 18 — Abort the LLM stream on client disconnect.** When the client closes the SSE connection, any in-flight LLM stream (`invokeLLMStream`) must be aborted immediately. Use an `AbortController` — pass its `signal` to the stream call and call `controller.abort()` in the `req.on('close', ...)` handler.

**Rule 19 — Every `message` event listener must validate `event.origin` first.** In `PluginBridge.ts`, the `window.addEventListener('message', handler)` callback must check `event.origin` against the registered origin for that plugin before reading any other property of `event.data`. A message from an unregistered origin is dropped and logged to `audit_logs` with `eventType: 'PROTOCOL_VIOLATION'`. No exceptions.

**Rule 20 — Plugin iframes use the `credentialless` attribute.** The `<iframe>` rendered by `PluginContainer.tsx` must include the `credentialless` attribute. This prevents the embedded app from inheriting the parent session's cookies or storage credentials, providing a second layer of isolation beyond `allow-same-origin` being absent from `sandbox`.

**Rule 21 — Plugin state is sanitized before LLM injection, truncated to 6,000 characters per field.** `sanitizePluginState()` in `server/contextAssembly.ts` must strip injection patterns (`system`, `instructions`, `prompt`, `ignore` as key names) AND truncate any string value longer than 6,000 characters. ✅ RESOLVED: 6,000 chars is the authoritative limit (developer confirmed 2026-04-01).

**Rule 22 — CSP `frame-src` must explicitly list each allowed plugin origin.** The Express server must set a `Content-Security-Policy` header that includes a `frame-src` directive listing every origin registered in `plugin_schemas.origin`. A wildcard (`*`) is never permitted. This header is added in `server/_core/index.ts` as middleware before the SSE route and tRPC.

**Rule 23 — No inline object/array/date literals as query inputs.** In React components, objects, arrays, and Date instances used as tRPC query inputs or hook dependencies must be defined with `useState` or `useMemo` — never created inline in the render function. Inline literals create new references every render, causing infinite query loops with `@tanstack/react-query`.

**Rule 24 — Use `useTransition` for plugin state and conversation history updates.** Any state update that triggers re-rendering of the plugin container or conversation history list must be wrapped with `startTransition` from `useTransition`. This keeps the chat input and SSE token rendering responsive while the heavier UI updates are deferred.

**Rule 25 — Use `useOptimistic` for chat message submission.** When the user submits a message, the UI must display it immediately via `useOptimistic` before the SSE response begins. The optimistic entry is replaced by the persisted message once the `done` event is received. Do not wait for the server round-trip before showing the user's own message.

**Rule 26 — Each plugin has its own Suspense boundary and ErrorBoundary.** `PluginContainer.tsx` must be wrapped in both a `<Suspense>` boundary (with a loading skeleton fallback) and an `<ErrorBoundary>` (using `client/src/components/ErrorBoundary.tsx`). A plugin crash must never unmount the chat interface. The ErrorBoundary catches iframe load failures and PluginBridge errors and renders an inline error state within the plugin pane only.

**Rule 27 — Rate limit the SSE stream endpoint.** The `/api/stream` route must enforce a sliding-window rate limit of **10 LLM requests per minute per authenticated user**, implemented in `server/rateLimiter.ts`. ✅ RESOLVED: 10/min/user is the authoritative limit (developer confirmed 2026-04-01). Rejected requests return an SSE `{ type: "error", code: "RATE_LIMITED" }` event, never a plain HTTP 429 (the connection is already open).

**Rule 28 — Audit log every LLM request; never log raw content.** Every call through the SSE stream must write to `audit_logs` via `auditLog()`. The `payload` JSON must include: `{ conversationId, tokenCount: { prompt, completion }, toolNames: string[], safetyFlags: { inputBlocked, outputFlagged } }`. Raw user message content and raw LLM response text must NEVER appear in `audit_logs.payload`. This is in addition to Rule 3 (which covers safety events and plugin lifecycle events).

**Rule 29 — Every FK column and every WHERE-clause column must have an explicit Drizzle index.** When adding tables to `drizzle/schema.ts`, every foreign key column and every column used in a `.where()` clause must have an explicit `.index()` defined in the table declaration. Indexes are not auto-generated by Drizzle for FK columns. Missing indexes on high-traffic query paths (e.g., `messages.conversationId`, `plugin_states.conversationId`) will cause full-table scans.

**Rule 30 — Never use `drizzle-kit push` or `drizzle-kit migrate` to apply schema changes.** The only permitted workflow is: (1) edit `drizzle/schema.ts`, (2) run `pnpm db:generate` to produce a migration SQL file, (3) review the SQL, (4) apply via `webdev_execute_sql`. The `drizzle-kit migrate` command bypasses the review step and must not be run. The `db:push` script in `package.json` has been renamed to `db:generate` to enforce this. This extends Rule 8.

**Rule 31 — Verify ownership before returning any row.** Every tRPC procedure that queries user-scoped data must check `row.userId === ctx.user.id || ctx.user.role === 'admin'` before returning the result. This check is performed in the application layer (not the database layer) because RLS is not enforced at the DB level (Decision 1). A procedure that skips this check and returns another user's data is a critical security defect.

**Rule 32 — Every new server function must have a Vitest unit test before its phase is marked complete.** A server function without a test is not done. `pnpm test` must pass at the end of every phase. This extends Rule 9.

**Rule 33 — Safety inspector tests must cover four cases.** Tests for `inspectInput()` and `moderateOutput()` in `server/safety.ts` must include: (1) clean input that passes, (2) a prompt injection attempt that is blocked, (3) a jailbreak attempt that is blocked, and (4) input at the maximum allowed length that passes. All four cases are required — a test file missing any of them is incomplete.

**Rule 34 — Context assembly tests must cover three invariants.** Tests for `buildContext()` / `assembleContext()` in `server/contextAssembly.ts` must cover: (1) tool filtering — only the active plugin's tools are returned, not all plugins' tools (Rule 12), (2) state sanitization — injection patterns are stripped and field length is enforced (Rule 21), and (3) token budget enforcement — when message history exceeds the threshold, summarization is triggered and the returned context fits within the budget.

**Rule 35 — tRPC procedure tests must cover three auth paths.** Every tRPC procedure under test must have cases for: (1) authenticated success with the correct role (returns expected data), (2) unauthenticated rejection (`UNAUTHORIZED`, no data returned), and (3) role-based rejection — a user with an insufficient role receives `FORBIDDEN`, not `UNAUTHORIZED`. These three cases are the minimum; additional happy-path and edge-case tests are encouraged.

**Rule 36 — Minimum 44×44px touch target on all interactive elements.** Every button, link, icon button, and form control in `client/src/` must have a minimum tap target of 44×44px. Use padding rather than fixed dimensions where the visual size should remain smaller. This applies to the chat input send button, message actions, plugin activation controls, and all toolbar items.

**Rule 37 — Streaming completion must be announced via `aria-live`.** The chat message area must contain a visually-hidden `<div aria-live="polite" aria-atomic="false">` region. When the SSE `done` event is received, post a brief announcement (e.g., "Response complete") into this region. The `polite` setting avoids interrupting the user mid-action while still notifying screen readers.

**Rule 38 — Minimum color contrast ratios.** Body text must meet 4.5:1 contrast ratio against its background. Large text (18px+ regular or 14px+ bold) and UI component boundaries (buttons, inputs, focus rings) must meet 3:1. These ratios apply in both light and dark modes. Do not override with hard-coded hex values — use the design token system (CSS variables from shadcn/ui) which is already calibrated for contrast.

**Rule 39 — Every plugin iframe must have a descriptive `title` attribute.** The `<iframe>` rendered by `PluginContainer.tsx` must have a `title` attribute that names the embedded application, e.g., `title="Chess learning activity"`. This is the primary identifier for screen readers navigating by landmark.

**Rule 40 — Only animate `transform` and `opacity`.** CSS transitions and animations in this project must only target `transform` and `opacity`. Never animate `width`, `height`, `top`, `left`, `right`, `bottom`, `padding`, or `margin`. Layout-triggering animations cause jank and layout thrashing. Use `transform: translateX/Y/scale` for position and size changes.

**Rule 41 — Respect `prefers-reduced-motion`.** Every component that uses animation or transition must check the `prefers-reduced-motion` media query and set duration to `0ms` when it is active. Use the Tailwind `motion-reduce:` variant or a `useReducedMotion` hook. No animation, transition, or timed visual effect is exempt from this rule.

**Rule 42 — The streaming cursor must be a pure CSS animation.** The blinking cursor shown while SSE tokens are streaming must be implemented with a CSS `@keyframes` animation on a `::after` pseudo-element or a dedicated `<span>`. Do not use `setInterval`, `setTimeout`, or `requestAnimationFrame` to drive cursor blinking. JavaScript timers fight React's rendering cycle and are not paused by `prefers-reduced-motion`.

---

## 4. Database Schema Reference

Eight tables. All timestamps are UTC milliseconds (Unix epoch). All IDs are auto-increment integers unless noted.

```
users
  id, openId (unique), name, email, loginMethod
  role: ENUM('student', 'teacher', 'admin') DEFAULT 'student'
  createdAt, updatedAt, lastSignedIn

conversations
  id, userId (FK → users.id)
  title, status: ENUM('active', 'frozen') DEFAULT 'active'
  activePluginId (FK → plugin_schemas.id, nullable)
  tokenCount INT DEFAULT 0
  createdAt, updatedAt

messages
  id, conversationId (FK → conversations.id)
  role: ENUM('user', 'assistant', 'system', 'tool')
  content TEXT
  toolName (nullable), toolCallId (nullable)
  moderationFlag BOOLEAN DEFAULT false
  createdAt

plugin_schemas
  id, pluginId VARCHAR(64) UNIQUE
  name, description
  toolSchema JSON        -- OpenAI-compatible function definitions array
  iframeUrl VARCHAR(512) -- where the app is hosted
  origin VARCHAR(256)    -- validated against postMessage event.origin
  allowedRoles JSON      -- array of role strings
  enabled BOOLEAN DEFAULT true
  version INT DEFAULT 1
  createdAt, updatedAt

plugin_states
  id, conversationId (FK → conversations.id)
  pluginId VARCHAR(64)
  state JSON             -- full serialized app state snapshot
  version INT DEFAULT 1  -- incremented on every update
  createdAt, updatedAt
  UNIQUE(conversationId, pluginId)

audit_logs
  id, userId (FK → users.id, nullable)
  eventType VARCHAR(64)  -- PLUGIN_READY | TOOL_INVOKE | TOOL_RESULT | STATE_UPDATE |
                         --   PLUGIN_COMPLETE | PLUGIN_ERROR | INPUT_BLOCKED |
                         --   OUTPUT_FLAGGED | INJECTION_DETECTED | CIRCUIT_OPEN |
                         --   RATE_LIMITED | AUTH_FAILURE
  payload JSON
  createdAt

safety_events
  id, userId (FK → users.id)
  conversationId (FK → conversations.id)
  eventType: ENUM('input_blocked', 'output_flagged', 'injection_detected')
  content TEXT, reason TEXT
  createdAt

plugin_failures
  id, conversationId (FK → conversations.id)
  pluginId VARCHAR(64)
  failureType: ENUM('timeout', 'crash', 'protocol_error', 'state_invalid')
  errorMessage TEXT
  circuitBreakerTripped BOOLEAN DEFAULT false
  createdAt
```

---

## 5. Role-Based Procedure Map

```typescript
// server/_core/trpc.ts
publicProcedure      // no auth required
protectedProcedure   // any authenticated user (student, teacher, admin)
studentProcedure     // role: student OR admin
teacherProcedure     // role: teacher OR admin
adminProcedure       // role: admin only
```

Role check pattern (copy exactly):
```typescript
export const teacherProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (ctx.user.role !== 'teacher' && ctx.user.role !== 'admin') {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Teacher or admin role required' });
  }
  return next({ ctx });
});
```

---

## 6. postMessage Protocol — Full Type Contract

Every message between the platform and a plugin app uses this envelope. This contract is immutable within a protocol version.

```typescript
// Outbound: Platform → Plugin (sent via PluginBridge)
type PlatformMessage =
  | { type: 'INIT';             version: 1; sessionId: string; pluginId: string; conversationId: number; restoredState: unknown | null }
  | { type: 'TOOL_INVOKE';      version: 1; sessionId: string; pluginId: string; toolName: string; toolCallId: string; arguments: Record<string, unknown> }
  | { type: 'PING';             version: 1; sessionId: string; pluginId: string }

// Inbound: Plugin → Platform (received and validated by PluginBridge)
type PluginMessage =
  | { type: 'PLUGIN_READY';     version: 1; sessionId: string; pluginId: string }
  | { type: 'TOOL_RESULT';      version: 1; sessionId: string; pluginId: string; toolCallId: string; result: unknown; isError: boolean }
  | { type: 'STATE_UPDATE';     version: 1; sessionId: string; pluginId: string; state: unknown; partial: boolean }
  | { type: 'PLUGIN_COMPLETE';  version: 1; sessionId: string; pluginId: string; finalState: unknown; summary: string }
  | { type: 'PLUGIN_ERROR';     version: 1; sessionId: string; pluginId: string; error: string; fatal: boolean }
  | { type: 'PONG';             version: 1; sessionId: string; pluginId: string }
```

**Validation rules in `PluginBridge.ts`:**
- Reject any message where `event.origin !== registeredOrigin`
- Reject any message where `message.sessionId !== this.sessionId`
- Reject any message where `message.pluginId !== this.pluginId`
- Reject any message where `message.version !== 1` (or current protocol version)
- All rejected messages are logged to `audit_logs` with `eventType: 'PROTOCOL_VIOLATION'`

---

## 7. SSE Streaming Protocol

The `/api/stream` endpoint sends newline-delimited JSON events. The client reads them with a `ReadableStream` consumer.

```
// Event types sent by the server
{ "type": "token",       "content": "Hello" }
{ "type": "tool_invoke", "toolName": "chess_make_move", "toolCallId": "tc_abc123", "arguments": {...} }
{ "type": "tool_wait",   "toolCallId": "tc_abc123" }
{ "type": "tool_result", "toolCallId": "tc_abc123", "result": {...} }
{ "type": "done",        "messageId": 42 }
{ "type": "error",       "code": "SAFETY_BLOCKED" | "RATE_LIMITED" | "CONTEXT_FROZEN" | "INTERNAL_ERROR", "message": "..." }
```

**Client-side tool invocation flow:**
1. Client receives `tool_invoke` event
2. Client calls `PluginBridge.invokeTool(toolName, toolCallId, arguments)`
3. Plugin processes the tool call and sends `TOOL_RESULT` via postMessage
4. `PluginBridge` receives `TOOL_RESULT` and POSTs to `/api/chat/tool-result`
5. Server resumes the SSE stream with `tool_result` event, then continues generation

---

## 8. Context Assembly Engine

File: `server/contextAssembly.ts`

The context assembly engine builds the messages array passed to the LLM on every turn. It runs in this order:

1. Load the last N messages from `messages` table (N = enough to stay under 60,000 tokens)
2. If `tokenCount > 60,000`, call `summarizeOldMessages()` and prepend a summary system message
3. Load the active plugin's current state from `plugin_states`
4. If plugin state exists, call `sanitizePluginState(state)` to strip any injected content
5. Inject plugin state as a system message: `"Current app state: {JSON.stringify(sanitizedState)}"`
6. Load the plugin's tool schema from `plugin_schemas`
7. Return `{ messages, tools, systemPrompt }`

**`sanitizePluginState(state)`** strips any string values longer than 6,000 characters and removes any keys that match injection patterns (`system`, `instructions`, `prompt`, `ignore`).

---

## 9. File Structure and Naming Conventions

```
server/
  _core/                  — Framework plumbing — do not edit unless extending infrastructure
    llm.ts                — invokeLLM() for non-streaming; add invokeLLMStream() here
    index.ts              — Register SSE routes BEFORE tRPC middleware
    trpc.ts               — Add studentProcedure, teacherProcedure here
    env.ts                — All env var access goes through this file
  routers/
    conversations.ts      — Conversation CRUD procedures
    plugins.ts            — Plugin lifecycle procedures
    artifacts.ts          — Smithsonian/LoC proxy procedures
  db.ts                   — ALL database helper functions live here
  safety.ts               — inspectInput(), moderateOutput(), moderateWithLLM()
  contextAssembly.ts      — buildContext(), summarizeOldMessages(), sanitizePluginState()
  auditLog.ts             — auditLog() fire-and-forget helper
  pluginAllowlist.ts      — isPluginAllowed(), getPluginSchema() with cache
  circuitBreaker.ts       — CircuitBreaker class
  rateLimiter.ts          — RateLimiter middleware

client/src/
  pages/
    Chat.tsx              — Main chat page; manages conversation state + SSE consumption
    Admin.tsx             — Plugin management (admin only)
    Dashboard.tsx         — Conversation history (teacher/admin)
  components/
    PluginContainer.tsx   — iframe host; renders the sandboxed app
    AIChatBox.tsx         — Message renderer (pre-built; use as controlled component)
    DashboardLayout.tsx   — Sidebar layout (pre-built; use for all authenticated pages)
  lib/
    PluginBridge.ts       — postMessage protocol manager (class, not component)

client/public/apps/
  chess/index.html                — Chess app (self-contained)
  timeline/index.html             — Timeline Builder app (self-contained)
  artifact-studio/index.html      — Artifact Investigation Studio (self-contained)
  mock-plugin/index.html          — Development test plugin
```

---

## 10. App Portfolio — Tool Schemas

### Chess App (`pluginId: "chess"`)
```json
[
  {
    "name": "chess_make_move",
    "description": "Make a chess move using standard algebraic notation",
    "parameters": {
      "type": "object",
      "properties": {
        "move": { "type": "string", "description": "Move in SAN format, e.g. 'e4', 'Nf3', 'O-O'" }
      },
      "required": ["move"]
    }
  },
  {
    "name": "chess_get_position",
    "description": "Get the current board position as FEN string",
    "parameters": { "type": "object", "properties": {}, "required": [] }
  },
  {
    "name": "chess_explain_position",
    "description": "Request the tutor to explain the current position",
    "parameters": {
      "type": "object",
      "properties": {
        "focus": { "type": "string", "description": "What aspect to explain: 'tactics', 'strategy', 'endgame', 'opening'" }
      },
      "required": ["focus"]
    }
  }
]
```

### Timeline Builder App (`pluginId: "timeline"`)
```json
[
  {
    "name": "timeline_add_event",
    "description": "Add an event to the timeline",
    "parameters": {
      "type": "object",
      "properties": {
        "year": { "type": "integer" },
        "title": { "type": "string" },
        "description": { "type": "string" },
        "category": { "type": "string", "enum": ["political", "cultural", "scientific", "economic", "military"] }
      },
      "required": ["year", "title", "description", "category"]
    }
  },
  {
    "name": "timeline_reorder",
    "description": "Reorder events on the timeline",
    "parameters": {
      "type": "object",
      "properties": {
        "orderedIds": { "type": "array", "items": { "type": "string" } }
      },
      "required": ["orderedIds"]
    }
  },
  {
    "name": "timeline_complete",
    "description": "Signal that the timeline is complete and ready for review",
    "parameters": {
      "type": "object",
      "properties": {
        "summary": { "type": "string", "description": "Student's summary of what the timeline shows" }
      },
      "required": ["summary"]
    }
  }
]
```

### Artifact Investigation Studio (`pluginId: "artifact-studio"`)
```json
[
  {
    "name": "artifact_search",
    "description": "Search the Smithsonian Open Access collection",
    "parameters": {
      "type": "object",
      "properties": {
        "query": { "type": "string" },
        "category": { "type": "string", "enum": ["art", "history", "science", "culture", "all"] },
        "limit": { "type": "integer", "minimum": 1, "maximum": 20, "default": 10 }
      },
      "required": ["query", "category"]
    }
  },
  {
    "name": "artifact_select",
    "description": "Select an artifact for detailed investigation",
    "parameters": {
      "type": "object",
      "properties": {
        "artifactId": { "type": "string" },
        "source": { "type": "string", "enum": ["smithsonian", "loc"] }
      },
      "required": ["artifactId", "source"]
    }
  },
  {
    "name": "artifact_annotate",
    "description": "Add a student annotation to the selected artifact",
    "parameters": {
      "type": "object",
      "properties": {
        "artifactId": { "type": "string" },
        "annotation": { "type": "string" },
        "annotationType": { "type": "string", "enum": ["observation", "question", "connection", "evidence"] }
      },
      "required": ["artifactId", "annotation", "annotationType"]
    }
  },
  {
    "name": "artifact_submit_inquiry",
    "description": "Submit the completed inquiry with all annotations for tutor review",
    "parameters": {
      "type": "object",
      "properties": {
        "artifactId": { "type": "string" },
        "inquiryQuestion": { "type": "string" },
        "conclusion": { "type": "string" }
      },
      "required": ["artifactId", "inquiryQuestion", "conclusion"]
    }
  }
]
```

---

## 11. Performance and Safety Targets

| Metric | Target |
|---|---|
| First SSE token | < 500ms |
| Tool invocation → UI render | < 1.5s at p95 |
| State update throughput | 60 updates/min/session |
| Context summarization threshold | 60,000 tokens |
| Tool invocation timeout | 10 seconds |
| Circuit breaker threshold | 3 failures in 5 minutes |
| Circuit breaker reset | 15 minutes |
| Rate limit: chat messages | 10/min/user |
| Rate limit: state updates | 60/min/session |
| Smithsonian API cache TTL | 24 hours |

---

## 12. Current Build Phase

**Phase 0 — Architecture Alignment** is the starting point. The Pre-Build Checklist (in `chatbridge_build_order_and_phase0.md`) must be completed before Phase 1 begins.

When the developer gives you a phase execution prompt, execute it completely and verify all exit conditions before declaring the phase done. Do not begin the next phase until the developer confirms the current phase is complete.

---

## 13. What This File Is Not

This file does not tell you to build anything. It does not auto-execute. It is the briefing document you read before the developer hands you a specific task. When you receive a task prompt, use this file to ensure your implementation is consistent with the architecture, naming conventions, data model, and invariants documented here.
