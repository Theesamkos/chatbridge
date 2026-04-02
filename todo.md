# ChatBridge / TutorMeAI — Project TODO

## Phase 0: Architecture & Foundation
- [x] Deep codebase inspection and architecture alignment
- [x] Phase 0 decisions locked (PHASE0_DECISIONS.md)
- [x] CLAUDE.md engineering rules documented
- [x] Database schema (9 tables) defined in drizzle/schema.ts
- [x] Database migration applied (all tables created in MySQL)
- [x] Plugin seed data applied (chess, timeline, artifact-studio)

## Phase 1: Auth, Data Model, Core Safety
- [x] RBAC: student / teacher / admin roles in users table
- [x] Manus OAuth integration (server/_core/oauth.ts)
- [x] JWT session cookie (server/_core/sdk.ts)
- [x] Audit log (server/auditLog.ts + writeAuditLog)
- [x] Safety inspection pre-LLM (server/safety.ts inspectInput)
- [x] Safety inspection post-LLM (server/safety.ts moderateWithLLM)
- [x] Plugin allowlist with cache (server/pluginAllowlist.ts)
- [x] Plugin seed (server/seed.ts — chess, timeline, artifact-studio)
- [x] freezeConversation on output block (stream.ts Rule 33)

## Phase 2: Chat Core
- [x] SSE streaming endpoint POST /api/chat/stream
- [x] Context assembly engine (server/contextAssembly.ts)
- [x] Conversation procedures (server/routers/conversations.ts)
- [x] Message procedures (server/routers/conversations.ts)
- [x] Rate limiter 10 req/min/user (server/rateLimiter.ts)
- [x] AbortController + heartbeat (Rule 17/18)
- [x] Tool invocation loop with MAX_TOOL_CALLS=3 (Rule 13)
- [x] Tool arg validation with AJV (Rule 14)
- [x] Chat UI (client/src/pages/Chat.tsx — 800+ lines)
- [x] Conversation sidebar with create/select/delete
- [x] Plugin selector in chat header

## Phase 3: Plugin Infrastructure
- [x] PluginBridge protocol (client/src/lib/PluginBridge.ts)
- [x] PluginContainer sandboxed iframe (client/src/components/PluginContainer.tsx)
- [x] PluginContainer exposes sendToolInvoke via forwardRef/useImperativeHandle
- [x] Chat.tsx wires tool_invoke events through PluginContainer ref
- [x] Tool result POST to /api/chat/tool-result
- [x] Pending tool results registry (server/routes/pendingToolResults.ts)
- [x] Mock plugin for testing (client/public/apps/mock-plugin/index.html)
- [x] CSP frame-src middleware (server/_core/index.ts)

## Phase 4: App Portfolio
- [x] Chess app (client/public/apps/chess/index.html — 800 lines)
  - [x] Full PluginBridge protocol (INIT, PLUGIN_READY, TOOL_INVOKE, TOOL_RESULT)
  - [x] Tools: start_game, make_move, get_board_state, get_legal_moves
  - [x] State restoration on INIT
  - [x] Origin validation
- [x] Timeline Builder app (client/public/apps/timeline/index.html — 735 lines)
  - [x] Full PluginBridge protocol
  - [x] Tools: load_timeline, validate_arrangement
- [x] Artifact Investigation Studio (client/public/apps/artifact-studio/index.html — 1477 lines)
  - [x] Full PluginBridge protocol
  - [x] Tools: search_artifacts, get_artifact_detail, submit_investigation, artifact_annotate
  - [x] Fixed tRPC API call format (json wrapper)
  - [x] 4-phase workflow: discover → inspect → investigate → conclude
- [x] Smithsonian API proxy (server/routers/artifacts.ts)
  - [x] K-12 content filter
  - [x] 24-hour in-memory cache
  - [x] LoC fallback

## Phase 5: Moderation, Monitoring, Resilience
- [x] Circuit breaker (server/circuitBreaker.ts)
- [x] Rate limiter (server/rateLimiter.ts)
- [x] Session freeze on output block (stream.ts)
- [x] Teacher dashboard (5 pages — TeacherDashboard, StudentSessions, ConversationLog, SafetyEvents, PluginStats)
- [x] Admin dashboard (6 pages — AdminDashboard, PluginManagement, AuditLogViewer, UserManagement, CostDashboard, PluginFailures)
- [x] Investigation portfolio (client/src/pages/InvestigationPortfolio.tsx)

## Phase 6: Testing & Hardening
- [x] 11 test files, 90 tests — all passing
- [x] safety.test.ts (injection + K-12 filter)
- [x] contextAssembly.test.ts
- [x] circuitBreaker.test.ts
- [x] rateLimiter.test.ts
- [x] pluginAllowlist.test.ts
- [x] PluginBridge.test.ts (10 tests)
- [x] stream.test.ts
- [x] conversations.test.ts
- [x] investigations.test.ts
- [x] artifacts.test.ts
- [x] auth.logout.test.ts

## Known Issues / Future Work
- [ ] The send button in the Manus preview iframe may be blocked by the preview overlay bar (production works fine)
- [ ] Input-blocked messages don't freeze the conversation (user not authenticated yet at that point — by design)
- [ ] Add vitest test for freezeConversation integration in stream route
