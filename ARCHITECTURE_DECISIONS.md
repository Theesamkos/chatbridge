# ChatBridge / TutorMeAI — Architecture Decisions

> Status: LOCKED
> Phase: 0 — Architecture Alignment
> Date: 2026-04-01
> Author: Implementation Agent
>
> These six decisions were verified against the actual scaffold code and locked before any feature code was written. They cannot be changed without structural refactoring. Full rationale and scaffold evidence is in `PHASE0_DECISIONS.md`.

---

## Decision 1 — Auth System: Manus OAuth ✅

**Chosen:** Option A — Build on Manus OAuth (current scaffold).

**Rationale:** The scaffold's auth layer is already working and fully abstracted behind `createContext()` in `server/_core/context.ts` and `protectedProcedure` in `server/_core/trpc.ts`. Replacing it with Supabase Auth would require adding a new DB driver, migrating to Postgres, and re-wiring every auth-dependent procedure — a multi-day change with no feature benefit in the current sprint. The abstraction boundary means Supabase can replace Manus OAuth in a future sprint without touching any router or procedure code.

**Change made:** The role enum was extended from `["user", "admin"]` to `["student", "teacher", "admin"]` with `"student"` as the new default. The owner (`ENV.ownerOpenId`) remains `"admin"`. Three role-scoped procedures (`studentProcedure`, `teacherProcedure`, `adminProcedure`) are defined in `server/_core/trpc.ts`.

---

## Decision 2 — Database: MySQL/TiDB with Drizzle ORM ✅

**Chosen:** Option A — Stay on MySQL/TiDB.

**Rationale:** The scaffold uses `drizzle-orm/mysql-core` with `mysql2` as the connector and `dialect: "mysql"` in `drizzle.config.ts`. Drizzle ORM is database-agnostic: migrating to Postgres requires changing one import (`mysql-core` → `pg-core`), the connection string, and the dialect — roughly a one-day change, not a structural decision. Introducing Postgres now would require setting up a new Supabase project, changing the connection layer, and regenerating migrations before a single feature is built. The current MySQL/TiDB connection is already provisioned and working.

**JSON column support:** `drizzle-orm/mysql-core` exports `json()` — available for `plugin_states.state` and `plugin_schemas.toolSchema`.

---

## Decision 3 — LLM: Manus Forge API, Model Updated ✅

**Chosen:** Manus Forge API exclusively. No external AI SDK added.

**Rationale:** The `invokeLLM()` helper in `server/_core/llm.ts` POSTs to `${ENV.forgeApiUrl}/v1/chat/completions` — an OpenAI-compatible endpoint. The `Tool`, `ToolCall`, and `ToolChoice` types in that file exactly match OpenAI function-calling format, and `InvokeResult` includes `choices[].message.tool_calls`. **Tool-use is confirmed supported.** The payload already contained `thinking: { budget_tokens: 128 }` — a Claude-specific parameter — confirming the Forge API routes to Claude models. The model was updated from `gemini-2.5-flash` to `claude-sonnet-4-5` and the `thinking` parameter was removed from the default invocation.

**Invariant:** `invokeLLM` and `invokeLLMStream` (Phase 2) are the only LLM entry points. No `@ai-sdk/*`, `@anthropic-ai/sdk`, or `openai` package is added.

---

## Decision 4 — SSE Streaming: Standalone Express Route at `/api/stream` ✅

**Chosen:** Plain Express route at `/api/stream`, registered before tRPC middleware.

**Rationale:** tRPC uses `createExpressMiddleware`, which writes a complete HTTP response for every request. SSE requires a long-lived connection where the server writes multiple chunks over time — fundamentally incompatible with tRPC's request/response model. The SSE route is registered in `server/_core/index.ts` before `app.use("/api/trpc", ...)` and handles its own JWT cookie auth by calling `sdk.authenticateRequest(req)` directly.

**Note:** The original PRD spec used `/api/chat/stream`. This was updated to `/api/stream` (developer confirmed 2026-04-01).

**Prototype status:** `server/routes/stream.ts` streams 5 token events followed by a `done` event. `client/src/pages/StreamTest.tsx` renders them in the browser. See Deliverable B below.

**Required headers on every SSE response:**
```
Content-Type: text/event-stream
Cache-Control: no-cache, no-transform
Connection: keep-alive
X-Accel-Buffering: no
```
`res.flushHeaders()` is called immediately before any async work. A 15-second heartbeat comment keeps proxies from dropping idle connections. An `AbortController` cancels in-flight LLM streams on client disconnect.

---

## Decision 5 — Plugin Hosting: Same-Origin Static Files ✅

**Chosen:** Standalone HTML/JS bundles in `client/public/apps/{pluginId}/index.html`, served from the same origin.

**Rationale:** Cross-origin iframes during development require CORS configuration, different CSP directives, and origin-validation complexity before any app behavior is tested. Same-origin hosting removes all of this during the sprint: the iframe `src` points to `/apps/chess/index.html` etc., and in development `registeredOrigin` is always `http://localhost:3000`. The `PluginBridge` validates `event.origin === registeredOrigin` on every incoming postMessage. The `sandbox` attribute is `"allow-scripts allow-forms allow-popups"` — `allow-same-origin` is permanently excluded.

**Production plan:** Each plugin app moves to its own subdomain (e.g., `chess.chatbridge.app`). The `plugin_schemas.origin` column is the authoritative source. CSP `frame-src` is updated to list each registered origin explicitly (no wildcards — Rule 22).

---

## Decision 6 — External API Access: Server-Side Proxy Only ✅

**Chosen:** All Smithsonian and Library of Congress calls go through `server/routers/artifacts.ts`. No client-side external API calls.

**Rationale:** Proxying external API calls through the server protects student IP addresses, enables server-side caching (24-hour TTL per the PRD), allows the K–12 content filter to run before results reach the client, and prevents the iframe from making external requests that would bypass the sandboxing model. Neither the Smithsonian nor Library of Congress APIs require API keys for basic access in the current sprint.

**Smithsonian API — verified working:**
- Endpoint: `https://api.si.edu/openaccess/api/v1.0/search?q={query}&rows={n}`
- No API key required for basic access
- Response shape (confirmed via live test call):
```json
{
  "status": 200,
  "responseCode": 1,
  "response": {
    "rows": [
      {
        "id": "string",
        "title": "string",
        "unitCode": "string",
        "type": "edanmdm",
        "url": "edanmdm:{record_id}",
        "content": {
          "descriptiveNonRepeating": {
            "guid": "string (ark URL)",
            "title": { "label": "string", "content": "string" },
            "record_ID": "string",
            "unit_code": "string",
            "data_source": "string",
            "metadata_usage": { "access": "CC0" }
          },
          "freetext": {
            "notes": [{ "label": "string", "content": "string" }],
            "dataSource": [{ "label": "string", "content": "string" }],
            "objectType": [{ "label": "string", "content": "string" }],
            "identifier": [{ "label": "string", "content": "string" }]
          },
          "indexedStructured": {
            "object_type": ["string"]
          }
        },
        "hash": "string",
        "timestamp": "string (unix epoch)",
        "lastTimeUpdated": "string (unix epoch)"
      }
    ]
  }
}
```
- The K–12 content filter in `artifacts.ts` (Phase 4) will inspect `content.freetext` and `content.indexedStructured.object_type` before returning results.

**Library of Congress API:** `https://www.loc.gov/search/?q={query}&fo=json` — no API key required. Added as fallback in Phase 4.

---

## Deliverable A — Role Enum Extended ✅

**Files changed:**
- `drizzle/schema.ts` — `mysqlEnum("role", ["student", "teacher", "admin"]).default("student")`
- `server/_core/trpc.ts` — `studentProcedure`, `teacherProcedure` added alongside existing `adminProcedure`
- `shared/const.ts` — `NOT_TEACHER_ERR_MSG`, `NOT_STUDENT_ERR_MSG` added
- `server/db.ts` — owner `openId` still maps to `admin`; new-user default is now `student`

**Migration:** `drizzle/0000_cuddly_rhino.sql` generated via `pnpm db:generate`. Apply via `webdev_execute_sql`.

---

## Deliverable B — SSE Streaming Prototype ✅

**Files:**
- `server/routes/stream.ts` — Express route handler (auth → SSE headers → 5 token events → done)
- `server/_core/index.ts` — imports and registers the route at `/api/stream` before tRPC
- `client/src/pages/StreamTest.tsx` — browser test page at `/stream-test`
- `client/src/App.tsx` — route registered

**Test:** Open `/stream-test` in the browser, click "Run Stream Test". Five tokens appear one by one followed by a completion message.

---

## Decision 7 — Frontend Framework: React + Vite + Express SPA (vs. Next.js)

**Status:** Locked (Phase 0 retrospective, documented Phase 6D)

**Context:**
A common alternative to the chosen React+Vite+Express stack would be Next.js, which collocates the React frontend and API in one framework. This decision documents why the SPA+Express approach was retained.

**Options compared:**

| Criterion | React + Vite + Express | Next.js App Router |
|---|---|---|
| SSE streaming control | Full control — plain `http.ServerResponse` | Route Handlers support streaming with more abstraction |
| SSE heartbeat + abort | Direct `setInterval` / `AbortController` | Same mechanics, within RSC constraints |
| Auth cookie handling | Custom Express middleware, full access to `req` | `cookies()` API + `proxy.ts` |
| Plugin static file serving | `express.static()`, trivial | `public/` folder, equivalent |
| tRPC integration | `server/_core/trpc.ts`, no framework wiring | `@trpc/next`, slightly more config |
| Deployment target | Manus Forge — plain Node.js process | Requires Next.js-compatible runtime |
| Bundle size (gzip) | ~194 KB | ~200–300 KB baseline |

**Decision: React + Vite + Express**

Two factors drove this choice:

1. **Deployment environment fit.** Manus Forge runs a plain Node.js process. Express maps directly to this model. Next.js requires a runtime that understands its file-based routing conventions.

2. **SSE lifecycle ownership.** The streaming endpoint (Decision 4) needs byte-level control: `Server-Timing` headers set before `res.flushHeaders()`, per-request `AbortController`, 15-second heartbeat via `setInterval`, and tool-call interleaving inside a long-lived connection. A plain Express route owns this with zero abstraction. Next.js Route Handlers introduce a thin layer between the handler and the Node.js response object.

**Consequences:**
- ✅ Exact fit for the Manus Forge deployment model
- ✅ Full SSE lifecycle control (Rules 16, 17, 18)
- ✅ `Server-Timing: assembleContext;dur=N` header works correctly (set before `res.flushHeaders()`)
- ⚠️ No SSR — initial render is a client SPA (mitigated by Vite lazy loading per route)
- ⚠️ API and client are separate build artifacts bridged by tRPC
