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
- [x] The send button in the Manus preview iframe may be blocked by the preview overlay bar (production works fine — confirmed via programmatic test)
- [x] Input-blocked messages don't freeze the conversation (user not authenticated yet at that point — by design, documented in CLAUDE.md)
- [x] freezeConversation integration covered by stream.test.ts (output block path tested)

## Phase 2 Report Gap Items (COMPLETED)

- [x] shared/pluginTypes.ts — PluginLifecycleState type union + full typed message envelope
- [x] PluginContainer — lifecycle state machine (loading→ready→active→complete→error) with StatusPill, animated overlays, Retry button
- [x] PluginPicker — full activation/deactivation UI with popover, plugin list, role gating, disabled-while-streaming guard
- [x] Chat.tsx — PluginPicker wired into header; Close button calls deactivate
- [x] Mock plugin — upgraded to Protocol Tester v2 (STATE_UPDATE, PLUGIN_COMPLETE, PLUGIN_ERROR soft/fatal, PING/PONG, auto-state, counters)
- [x] PluginBridge.test.ts — 5 new lifecycle tests (PLUGIN_COMPLETE, PLUGIN_ERROR fatal/soft, partial STATE_UPDATE, sendPing)
- [x] Test suite: 96/96 passing (up from 91)

## Phase 3: Chess App Integration (COMPLETED — checkpoint 6dad817d)

- [x] Inspect current chess app, plugin infrastructure, context assembly, and state pipeline
- [x] Rebuilt chess app: full chess engine (no external deps), structured ChessState model, FEN validation, premium UI
- [x] Implement all 5 chess tools: start_game, make_move, get_board_state, get_legal_moves, get_help
- [x] Wire chess STATE_UPDATE into plugin state persistence pipeline
- [x] Wire chess state into LLM context assembly (inject FEN + game status + grounding rules into system prompt)
- [x] Add chess-specific error handling: illegal move, malformed FEN, timeout, desync
- [x] Add chess vitest coverage: 6 new tests (grounding rules, Teach Me Mode, get_help tool, FEN injection protection)
- [x] Run full test suite — 102/102 passing (up from 96)
- [x] Save Phase 3 checkpoint (6dad817d)
- [x] Write and deliver Phase 3 implementation report

## Phase 4: Timeline Builder Plugin (COMPLETED)

- [x] Rebuilt timeline iframe: production-grade dark UI, drag-and-drop with position numbers, attempt counter, score pips, result overlay
- [x] 8 history topics with 6 events each (48 events total, all with year + description)
- [x] Deterministic validation: pure JS, no LLM, per-item correctness + score + status
- [x] All 4 tools implemented: load_timeline, validate_arrangement, get_state, reset_timeline
- [x] Full plugin lifecycle: INIT → PLUGIN_READY → STATE_UPDATE → PLUGIN_COMPLETE
- [x] State restoration on INIT (topic, orderedEventIds, submitted, attemptCount)
- [x] Seed.ts updated: timeline plugin now has all 4 tool schemas with rich descriptions
- [x] PluginPicker icon/color mapping fixed: 'timeline-builder' → 'timeline'
- [x] contextAssembly.ts: timeline system prompt + coaching instructions injected
- [x] contextAssembly.ts: completion coaching for perfect/partial/poor scores
- [x] 9 new timeline tests in contextAssembly.test.ts
- [x] Full test suite: 111/111 passing (up from 102)
- [x] Seed applied to database: timeline plugin updated with 4 tools

## Phase 5: Artifact Investigation Studio (COMPLETED)

- [x] Rebuilt artifact-studio iframe: flagship dark UI, 4-step workflow (Discover → Inspect → Investigate → Conclude)
- [x] Premium animated step progress bar, immersive artifact image presentation, structured reasoning fields
- [x] All 5 tools implemented: search_artifacts, get_artifact_detail, submit_investigation, reset_investigation, get_investigation_state
- [x] Structured state model: phase, selectedArtifact, investigation (observations/evidence/interpretation/hypothesis/evidenceTags/stepTimestamps)
- [x] Deterministic client-side validation: each reasoning field must be ≥50 characters before submission
- [x] Full plugin lifecycle: INIT → PLUGIN_READY → STATE_UPDATE → PLUGIN_COMPLETE
- [x] State restoration on INIT (phase, selectedArtifact, investigation fields)
- [x] Smithsonian API proxy already hardened: primary + LoC fallback, 24h cache, K-12 filter (no changes needed)
- [x] seed.ts updated: artifact-studio now has all 5 tool schemas with rich descriptions (reset_investigation + get_investigation_state added)
- [x] Seed applied to database: artifact-studio plugin updated with 5 tools
- [x] contextAssembly.ts: artifact-studio system prompt injected (4-step workflow, Socratic coaching, 9 mandatory behavior rules)
- [x] contextAssembly.ts: completion coaching for excellent (≥80%), partial (60-79%), low (<60%) scores + pending-score state
- [x] 11 new artifact-studio tests in contextAssembly.test.ts (context assembly + sanitizePluginState injection protection)
- [x] Full test suite: 122/122 passing (up from 111)

## Phase 6: UI Foundation + Product Polish (COMPLETED)

- [x] Premium design system: OKLCH depth tokens, type scale, spacing rhythm, motion utilities, dot-grid background, glow utilities (index.css)
- [x] Chat UI: premium message bubbles with role-specific styling, tool indicator with spinner, input composer with focus ring, plugin split divider, empty state with quick starters
- [x] Landing page: immersive hero with depth layers, stats bar, feature grid with hover cards, refined nav with K-12 badge, polished footer
- [x] DashboardLayout: brand mark in sidebar header, refined active menu items, better mobile bottom tab bar
- [x] Teacher Dashboard: elevated stat cards with color/trend indicators, quick-action row, refined activity feed with severity badges
- [x] All 122 tests passing (UI changes are frontend-only, no backend test impact)

## Color Palette: Warm Amber/Gold Theme

- [x] Update index.css: shift all OKLCH primary/secondary/accent tokens to warm amber/gold
- [x] Update index.css: shift background/card/sidebar tokens to warm deep charcoal
- [x] Update plugin iframes: chess, timeline, artifact-studio warm color accents
- [x] Verify 0 TS errors and all 122 tests pass

## Phase 6: Safety, Moderation, Monitoring & Resilience Hardening

- [x] Pre-LLM safety inspection layer (user input, plugin state, tool results, injection detection)
- [x] Post-LLM output moderation layer (policy scanner, PII detector, allow/block/sanitize, event logging)
- [x] Plugin state schema validators (chess, timeline, artifact-studio) + STATE_UPDATE/TOOL_RESULT hardening
- [x] Plugin circuit breaker + session freeze/escalation logic
- [x] Structured audit logging system (all critical safety/lifecycle events)
- [x] Rate limiting middleware (chat messages, plugin state updates, tool invocation loops)
- [x] Degraded-mode resilience (fallback chains, preserved chat continuity, safe failure messages)
- [x] Premium failure UX (polished error/degraded/freeze states in PluginContainer and Chat)
- [x] Safety/resilience tests + all 152 tests passing (30 new safety tests added)

## Phase 7: Integration, Testing, Deployment Hardening & Final Readiness

- [x] Deep system audit: trace all critical flows, identify inconsistencies
- [x] Fix all identified issues: contract gaps, state continuity, error handling, dead code
- [x] Performance optimization: re-renders, streaming, plugin load times
- [x] Final test sweep: 152/152 tests passing, 0 TS errors
- [x] Deployment hardening: build process, env vars, no secrets exposed
- [x] Final readiness report delivered

## Production Bug Fixes + Delete Chat Feature
- [x] Fix chess AI asking for clarification instead of calling make_move with the UCI string
- [x] Fix chess start_game error ("An error occurred. Please try again.")
- [x] Add delete conversation feature (backend + frontend with confirmation)

## Chess Race Condition Fix (ACTIVE)
- [x] Fix race condition: gate chat send until plugin iframe fires PLUGIN_READY
- [x] Handle tool invocations queued before iframe is ready (retry/queue pattern)
- [x] Verify chess start_game + make_move works end-to-end in production

## Chess Illegal Move + Empty Bubble Fixes
- [x] Fix illegal move handling: AI must explain the illegal move and ask for a valid one (not go silent)
- [x] Fix empty AI bubble: suppress blank/whitespace-only AI messages in the chat UI

## Production Bug: AI Silence + "1 error" Toast (Timeline + Chess)
- [x] Diagnose "1 error" toast: root cause confirmed — Zod schema rejected initial plugin states (events/fen/investigation undefined on mount)
- [x] Fix the root cause: made all initial-state fields .optional() in pluginStateSchemas.ts; injection detection still catches real attacks; 152/152 tests passing

## Artifact Studio: Replace Smithsonian/LoC with Met Museum API
- [x] Research Met Museum API endpoints (search, object detail) and data shape
- [x] Rewrite server/routers/artifacts.ts to use Met Museum API (no key required)
- [x] Update artifact-studio iframe to match Met Museum data shape (imageUrl, metadata fields)
- [x] Update Zod schema source enum (smithsonian/loc → met/cache)
- [x] Update seed.ts tool descriptions to reference Met Museum
- [x] Update contextAssembly.ts system prompt to reference Met Museum
- [x] Update/fix pluginStateSchemas.test.ts fixture for new source
- [x] 152/152 tests passing, 0 TS errors

## Chess: Click-to-Move + Legal Move Dots + Assistance Toggle
- [x] Click piece → show legal move dots → click dot to move (already implemented)
- [x] Snap-back animation when user drops piece on illegal square
- [x] Assistance mode (default ON): shows legal move dots on click
- [x] toggle_assistance tool: AI can turn assistance on/off via chat command
- [x] Add toggle_assistance to chess seed tool schemas + re-seeded DB
- [x] Update contextAssembly chess system prompt to describe assistance toggle
- [x] 152/152 tests passing, 0 TS errors

## Timeline: Wire Wikipedia On This Day API (external, free, no key)
- [x] Build server/routers/timeline.ts calling Wikipedia REST API with curated fallback
- [x] Register timelineRouter in server/routers.ts
- [x] Update timeline iframe: fetchLiveTopicEvents() fetches from server, loadTopic uses live cache
- [x] handleLoadTopic and load_timeline tool both try live first, fall back to curated
- [x] 152/152 tests passing, 0 TS errors

## Recommended Steps
- [x] Chess: auto-play Black after every White move (humanMove flag + onRequestAiMove + triggerAiMove with autoPlay flag)
- [x] Artifact Studio: fix triggerScoring to use postMessage proxy (proxyFetch with POST support) instead of blocked direct fetch
