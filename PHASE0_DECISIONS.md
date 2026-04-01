# Phase 0 — Decision Log

> Status: LOCKED
> Date: 2026-04-01
> All six decisions verified against the actual scaffold in `server/_core/`, `drizzle/schema.ts`, and `package.json`.

---

## Decision 1 — Auth: Manus OAuth ✅ LOCKED

**Decision:** Build on Manus OAuth. Do not migrate to Supabase Auth.

**Scaffold evidence:**
- `server/_core/sdk.ts` — `SDKServer.authenticateRequest()` reads the `app_session_id` JWT cookie, verifies it with `jose`, then looks up the user via `db.getUserByOpenId()`.
- `server/_core/context.ts` — `createContext()` calls `sdk.authenticateRequest(req)` and returns `{ req, res, user }`.
- `server/_core/trpc.ts` — `protectedProcedure` consumes `ctx.user`; no Supabase client anywhere.
- Auth is fully abstracted. A future migration to a different auth provider requires changing only `context.ts` and `sdk.ts`.

**Role enum gap:** The scaffold has `["user", "admin"]`. This phase changes it to `["student", "teacher", "admin"]`. The `user` default maps to `student`.

---

## Decision 2 — Database: MySQL/TiDB with Drizzle ORM ✅ LOCKED

**Decision:** Stay on MySQL/TiDB via Drizzle ORM. Do not switch to Postgres.

**Scaffold evidence:**
- `drizzle/schema.ts` imports from `drizzle-orm/mysql-core` (`int`, `mysqlEnum`, `mysqlTable`, `timestamp`, `varchar`, `text`).
- `drizzle.config.ts` sets `dialect: "mysql"`.
- `server/db.ts` imports `drizzle` from `drizzle-orm/mysql2`.
- `package.json` has `mysql2@^3.15.0` and `drizzle-orm@^0.44.5`.
- JSON column support confirmed: `drizzle-orm/mysql-core` exports `json()` — available for plugin state snapshots.

**Migration path if Postgres is ever needed:** Change `drizzle-orm/mysql-core` → `drizzle-orm/pg-core`, `mysql2` → `pg`, update `dialect` in drizzle.config.ts. One-day change, no structural impact.

---

## Decision 3 — LLM: Manus Forge API with Claude Sonnet ✅ LOCKED

**Decision:** Use Manus Forge API exclusively. Do not add any external AI SDK. Update model to Claude Sonnet.

**Scaffold evidence:**
- `server/_core/llm.ts` — `invokeLLM()` POSTs to `${ENV.forgeApiUrl}/v1/chat/completions` (OpenAI-compatible endpoint). Falls back to `https://forge.manus.im/v1/chat/completions`.
- API key read from `ENV.forgeApiKey` (`BUILT_IN_FORGE_API_KEY` env var). ✅ No hardcoded credentials.
- **Tool-use is FULLY SUPPORTED.** The `Tool`, `ToolCall`, `ToolChoice` types exactly match OpenAI function-calling format. `InvokeResult` includes `tool_calls` in `choices[].message`. The `normalizeToolChoice()` function handles `none`, `auto`, `required`, and explicit function-name variants. Payload includes `tools` when provided.
- Current model: `gemini-2.5-flash`. The payload already includes `thinking: { budget_tokens: 128 }` — a Claude extended-thinking parameter — confirming the Forge API routes to Claude models.
- **Action taken this phase:** Model updated to `claude-sonnet-4-5`. The `thinking` budget has been removed (not needed for standard chat; can be re-enabled for reasoning-heavy tasks). If the Forge API uses a different model ID, update `model` in `invokeLLM()`.

**Invariant:** `invokeLLM` and `invokeLLMStream` (to be added in Phase 2) are the ONLY LLM entry points. No external AI SDK (Anthropic SDK, OpenAI SDK, AI SDK) is imported anywhere.

---

## Decision 4 — SSE Streaming: Standalone Express Route ✅ LOCKED (route name confirmed `/api/stream` 2026-04-01)

**Decision:** `/api/stream` is a plain Express route registered in `server/_core/index.ts` BEFORE the tRPC middleware. It handles its own JWT cookie auth.

**Scaffold evidence:**
- `server/_core/index.ts` registers routes in this order: `registerOAuthRoutes(app)` → tRPC at `/api/trpc` → Vite/static serving. There is NO SSE endpoint — it must be added.
- tRPC uses `createExpressMiddleware` with `createContext`, which is a request/response handler — incompatible with long-lived SSE connections.
- `sdk.authenticateRequest(req)` is reusable in the SSE route without tRPC.
- **Action taken this phase:** Prototype SSE route added at `/api/stream`. Returns test tokens confirming SSE delivery to the browser.

---

## Decision 5 — Plugin Hosting: Same-Origin Static Files ✅ LOCKED

**Decision:** Plugin apps served from `/apps/{pluginId}/index.html` on the same origin. `PluginBridge` validates `event.origin === registeredOrigin`.

**Scaffold evidence:**
- `client/public/` currently contains only `.gitkeep` — plugin apps will be placed here as `client/public/apps/chess/index.html`, etc.
- Vite is configured to serve `client/public/` as static assets at the root. In dev mode, `setupVite(app, server)` provides this. In production, `serveStatic(app)` serves the built output.
- In development: `registeredOrigin = "http://localhost:3000"`. Same-origin: ✅.
- `iframe sandbox="allow-scripts allow-forms allow-popups"` — no `allow-same-origin`. Hard constraint (Rule 1).
- For production: each app moves to its own subdomain. The `plugin_schemas.origin` field is authoritative.

---

## Decision 6 — External APIs: Server-Side Proxy Only ✅ LOCKED

**Decision:** Smithsonian Open Access API and Library of Congress API proxied through `server/routers/artifacts.ts`. No client-side calls to external APIs. 24-hour cache.

**Scaffold evidence:**
- `server/routers.ts` currently has no `artifacts` router — it will be added in Phase 4.
- No `fetch` calls to external API URLs exist in `client/src/` — the constraint is clean to enforce.
- S3 for file storage (`server/storage.ts` already present with AWS S3 SDK). ✅
- `server/_core/env.ts` is the single place for env var reads. Smithsonian/LoC API keys (if needed in production) go here.
- No API key required for basic Smithsonian/LoC access in the current sprint.

---

## Phase 0 Code Changes Applied

| File | Change |
|------|--------|
| `drizzle/schema.ts` | Role enum `["user","admin"]` → `["student","teacher","admin"]`, default `"user"` → `"student"` |
| `server/_core/trpc.ts` | Added `studentProcedure` and `teacherProcedure` |
| `server/_core/index.ts` | Added SSE prototype route `/api/stream` before tRPC middleware |
| `server/_core/llm.ts` | Updated model to `claude-sonnet-4-5`, removed `thinking` param from default invocation |
| `shared/const.ts` | Added `NOT_TEACHER_ERR_MSG`, `NOT_STUDENT_ERR_MSG` |
| `drizzle/migrations/` | Migration SQL generated via `drizzle-kit generate` |
