# ChatBridge — Cost Analysis

**Phase:** 6D
**Model:** Claude Sonnet (Manus Forge API — same pricing as Anthropic Claude Sonnet 4.5)
**Methodology:** Token cost projection based on measured context sizes and usage patterns

---

## 1. Token Pricing Reference

| Model | Input | Output |
|---|---|---|
| Claude Sonnet 4.5 | $3.00 / 1M tokens | $15.00 / 1M tokens |
| Claude Haiku 4.5 | $0.80 / 1M tokens | $4.00 / 1M tokens |

*Manus Forge API pricing mirrors Anthropic direct pricing.*

---

## 2. Per-Request Token Budget

### Context Assembly Breakdown (per turn)

| Component | Estimated Tokens | Notes |
|---|---|---|
| System prompt (base) | ~300 | Role definition, platform rules |
| Plugin state injection | ~200–500 | JSON-serialized game/timeline/artifact state |
| Teach Me Mode coaching prompt | +~150 | Only when active |
| Message history (20 messages) | ~2,000–4,000 | ~200 chars avg × 20 = ~1,000 tokens input |
| Current user message | ~50–200 | Average chat message |
| Plugin tool schemas | ~600–1,000 | 3–4 tools × ~250 tokens each |
| **Total input tokens** | **~3,150–6,150** | Average: ~4,000 |

### Output Token Estimate

| Response type | Estimated Output Tokens |
|---|---|
| Short tutoring reply | ~100–300 |
| Chess move + explanation | ~200–400 |
| Artifact analysis | ~300–600 |
| Timeline event suggestion | ~150–300 |
| Teach Me Mode analysis | ~400–700 |
| **Average output** | **~300 tokens** |

### Per-Turn Cost (average)

| Component | Tokens | Cost |
|---|---|---|
| Input (4,000 avg) | 4,000 | $0.012 |
| Output (300 avg) | 300 | $0.0045 |
| **Per-turn total** | — | **~$0.017** |

---

## 3. Tool-Calling Overhead

When a plugin tool is invoked, each turn includes:

1. Initial LLM call (with tool schemas) — average 4,000 input tokens
2. Tool result injected into context — ~200–500 tokens
3. Continuation LLM call — ~4,200–4,500 input tokens

| Tool invocations/turn | Additional cost | Total cost/turn |
|---|---|---|
| 0 (text only) | $0 | ~$0.017 |
| 1 tool call | +$0.014 | ~$0.031 |
| 2 tool calls | +$0.028 | ~$0.045 |
| 3 tool calls (max) | +$0.042 | ~$0.059 |

Maximum cost per turn (3 tool calls, full context): **~$0.06**

---

## 4. Investigation Scoring

When a student completes an artifact investigation, a separate LLM call scores the work:

| Component | Tokens | Cost |
|---|---|---|
| Scoring system prompt | ~500 | $0.0015 |
| Student investigation state (artifacts, annotations, inquiry) | ~1,000–2,000 | $0.003–0.006 |
| Score JSON output (~200 tokens) | 200 | $0.003 |
| **Per-investigation scoring** | — | **~$0.008–$0.011** |

---

## 5. Scale Projections

### Assumptions
- K-12 classroom: 30 students per teacher
- Students use the platform 3 sessions/week, 30 minutes per session
- Average 10 turns per session (messages + plugin interactions)
- 30% of turns include a tool call (average 1.5 tool calls when present)

### Per-Student Monthly Cost

| Component | Quantity | Unit Cost | Monthly Cost |
|---|---|---|---|
| Chat turns (no tools) | ~84 turns/month | $0.017 | $1.43 |
| Tool-calling turns | ~36 turns/month | $0.031 | $1.12 |
| Investigation scorings | ~4/month | $0.010 | $0.04 |
| **Per-student total** | — | — | **~$2.59/month** |

### Classroom Scale (30 students)

| Scale | Monthly Cost | Annual Cost |
|---|---|---|
| 1 classroom (30 students) | ~$77.70 | ~$932 |
| 10 classrooms (300 students) | ~$777 | ~$9,324 |
| 100 classrooms (3,000 students) | ~$7,770 | ~$93,240 |
| 1,000 classrooms (30,000 students) | ~$77,700 | ~$932,400 |

### Comparison: Premium Tutoring

| Service | Cost per student/year |
|---|---|
| Human tutor (2hrs/week) | ~$4,000–8,000 |
| Khan Academy Khanmigo | ~$44/year |
| **ChatBridge** | **~$31/year** |

ChatBridge delivers personalized AI tutoring with contextual awareness of live app state at **~0.8% of human tutoring cost**.

---

## 6. Cost Optimization Levers

### Currently implemented

| Optimization | Savings |
|---|---|
| Plugin schema cache (LRU, 5 min TTL) | Eliminates DB roundtrip on every turn — negligible LLM cost impact |
| Context summarization at 60K tokens | Prevents runaway context costs for very long sessions |
| Tool schema injection only when active | Saves ~600–1,000 tokens/turn when no plugin active (~$0.002/turn) |
| Smithsonian API 24-hour cache | No LLM cost impact, but reduces server latency |
| Max 3 tool calls/turn (Rule 13) | Caps per-turn cost at ~$0.06 |

### Potential future optimizations

| Optimization | Estimated Savings |
|---|---|
| Switch to Claude Haiku for simple queries | 73% reduction for text-only turns (~$1.00/student/month) |
| Reduce message history from 20 to 10 for light conversations | ~$0.006/turn on short history |
| Structured context compression | Reduce plugin state tokens by ~30% |

### Model tiering strategy

A tiered model strategy could significantly reduce costs:
- **Haiku** for: simple Q&A, spelling/grammar help, basic math — estimated 60% of turns
- **Sonnet** for: tool calling, investigation analysis, Teach Me Mode — 40% of turns

Blended cost estimate: `0.6 × $0.006 + 0.4 × $0.017 = $0.0104/turn` — **39% cost reduction** from current all-Sonnet approach.

---

## 7. Infrastructure Costs (Non-LLM)

| Component | Estimate | Notes |
|---|---|---|
| Manus Forge hosting | Included | Platform cost |
| TiDB Cloud (database) | ~$20–50/month | Per Serverless tier pricing |
| Smithsonian API | $0 | Free, unlimited |
| Library of Congress API | $0 | Free, unlimited |

For a 30-student classroom, non-LLM infrastructure represents < 10% of total platform cost.

---

## Summary

| Metric | Value |
|---|---|
| Average cost per turn | ~$0.017 |
| Maximum cost per turn (3 tool calls) | ~$0.06 |
| Cost per student per month | ~$2.59 |
| Cost per student per year | ~$31 |
| Cost vs. human tutor | ~0.8% |
| Breakeven for 1 classroom vs. Khanmigo | 100 classrooms |
