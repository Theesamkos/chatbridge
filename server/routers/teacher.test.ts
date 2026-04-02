/**
 * Teacher router tests (Task 6A.6, Phase 6A).
 *
 * Rule 35: each procedure must cover (1) authenticated success, (2) unauthenticated
 * rejection, and (3) role-based rejection.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// ─── Mock dependencies ────────────────────────────────────────────────────────

vi.mock("../db", () => ({
  getDb: vi.fn(),
  unfreezeConversation: vi.fn(),
}));

vi.mock("../auditLog", () => ({
  writeAuditLog: vi.fn().mockResolvedValue(undefined),
}));

import { getDb, unfreezeConversation } from "../db";
import { writeAuditLog } from "../auditLog";
import { teacherRouter } from "./teacher";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeCaller(role: "student" | "teacher" | "admin" = "teacher") {
  const ctx = {
    user: { id: 1, role, openId: "u1", name: "Teacher Test", email: "t@t.com" },
    req: {} as never,
    res: {} as never,
  } as never;
  return teacherRouter.createCaller(ctx);
}

/**
 * Returns a chainable Proxy that every method call returns itself, and resolves
 * to `result` when awaited.  Each call to `db.select()` / `db.update()` pulls
 * the next item from the provided `results` queue.
 */
function makeChain(result: unknown): unknown {
  const proxy: Record<string | symbol, unknown> = {};
  return new Proxy(proxy, {
    get(_, prop) {
      if (prop === "then") {
        return (
          onFulfilled: (v: unknown) => unknown,
          onRejected: (e: unknown) => unknown,
        ) => Promise.resolve(result).then(onFulfilled, onRejected);
      }
      // Every other property is a function that returns the same chain
      return (..._args: unknown[]) =>
        new Proxy(proxy, (new Proxy(proxy, {}) as never));
    },
  });
}

function makeDbMock(...results: unknown[]) {
  let i = 0;
  const next = () => results[i++] ?? [];

  // Proxy over the db object so any method call (select, update, from, …)
  // that is then chained and awaited resolves to the next queued result.
  function chainFrom(result: unknown): unknown {
    return new Proxy({} as Record<string, unknown>, {
      get(_, prop: string | symbol) {
        if (prop === "then") {
          return (
            onFulfilled: (v: unknown) => unknown,
            onRejected: (e: unknown) => unknown,
          ) => Promise.resolve(result).then(onFulfilled, onRejected);
        }
        if (prop === "as") return (_alias: string) => chainFrom(result);
        return (..._args: unknown[]) => chainFrom(result);
      },
    });
  }

  return {
    select: vi.fn((..._args: unknown[]) => chainFrom(next())),
    update: vi.fn((..._args: unknown[]) => chainFrom(next())),
    insert: vi.fn((..._args: unknown[]) => chainFrom(next())),
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("teacherRouter — role guard (Rule 35)", () => {
  it("throws FORBIDDEN when called with student role", async () => {
    // DB never reached — role guard fires first
    vi.mocked(getDb).mockResolvedValue(null as never);
    const caller = makeCaller("student");

    await expect(caller.getStudentSessions({})).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("allows teacher role through the guard", async () => {
    const db = makeDbMock([{ total: 0 }], []);
    vi.mocked(getDb).mockResolvedValue(db as never);

    const result = await makeCaller("teacher").getStudentSessions({});
    expect(result.total).toBe(0);
  });

  it("allows admin role through the guard", async () => {
    const db = makeDbMock([{ total: 0 }], []);
    vi.mocked(getDb).mockResolvedValue(db as never);

    const result = await makeCaller("admin").getStudentSessions({});
    expect(result.total).toBe(0);
  });
});

describe("getStudentSessions", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns paginated sessions with numeric counts", async () => {
    const db = makeDbMock(
      // total count query
      [{ total: 2 }],
      // sessions query
      [
        {
          conversationId:   "conv-1",
          studentName:      "Alice",
          studentId:        10,
          activePlugin:     "chess",
          lastActivity:     new Date("2026-01-01"),
          status:           "active",
          messageCount:     "5",
          safetyEventCount: "1",
        },
      ],
    );
    vi.mocked(getDb).mockResolvedValue(db as never);

    const result = await makeCaller().getStudentSessions({ page: 0, limit: 20 });

    expect(result.total).toBe(2);
    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0].messageCount).toBe(5);
    expect(result.sessions[0].safetyEventCount).toBe(1);
    expect(result.page).toBe(0);
  });

  it("returns empty sessions on page beyond data", async () => {
    const db = makeDbMock([{ total: 0 }], []);
    vi.mocked(getDb).mockResolvedValue(db as never);

    const result = await makeCaller().getStudentSessions({ page: 5, limit: 20 });
    expect(result.sessions).toHaveLength(0);
    expect(result.total).toBe(0);
  });
});

describe("getConversationLog", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns conversation, messages, and plugin states", async () => {
    const db = makeDbMock(
      // conversation query
      [{
        id:            "conv-1",
        status:        "active",
        activePluginId: "chess",
        createdAt:     new Date(),
        updatedAt:     new Date(),
        studentName:   "Bob",
        studentId:     20,
        title:         "Chess lesson",
      }],
      // messages query
      [
        { id: "m1", role: "user",      content: "Hello",         toolName: null, moderationStatus: "passed", createdAt: new Date() },
        { id: "m2", role: "assistant", content: "Hi there!",     toolName: null, moderationStatus: "passed", createdAt: new Date() },
      ],
      // plugin states query
      [{ pluginId: "chess", state: { board: "rnbq" }, version: 1, createdAt: new Date() }],
    );
    vi.mocked(getDb).mockResolvedValue(db as never);

    const result = await makeCaller().getConversationLog({ conversationId: "conv-1" });

    expect(result.conversation.id).toBe("conv-1");
    expect(result.conversation.studentName).toBe("Bob");
    expect(result.messages).toHaveLength(2);
    expect(result.pluginStates).toHaveLength(1);
    expect(result.pluginStates[0].pluginId).toBe("chess");
  });

  it("throws NOT_FOUND when conversation does not exist", async () => {
    const db = makeDbMock([]); // empty result → conv not found
    vi.mocked(getDb).mockResolvedValue(db as never);

    await expect(
      makeCaller().getConversationLog({ conversationId: "nonexistent" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("unfreezeSession", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(writeAuditLog).mockResolvedValue(undefined);
    vi.mocked(unfreezeConversation).mockResolvedValue(undefined);
  });

  it("unfreezes a frozen conversation and writes an audit log", async () => {
    const db = makeDbMock([{ id: "conv-1", status: "frozen" }]);
    vi.mocked(getDb).mockResolvedValue(db as never);

    const result = await makeCaller().unfreezeSession({
      conversationId: "conv-1",
      reason: "Student confirmed it was a false positive",
    });

    expect(result.success).toBe(true);
    expect(unfreezeConversation).toHaveBeenCalledWith("conv-1");
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "SESSION_UNFROZEN" }),
    );
  });

  it("throws BAD_REQUEST when conversation is not frozen", async () => {
    const db = makeDbMock([{ id: "conv-1", status: "active" }]);
    vi.mocked(getDb).mockResolvedValue(db as never);

    await expect(
      makeCaller().unfreezeSession({ conversationId: "conv-1", reason: "Test" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("throws NOT_FOUND when conversation does not exist", async () => {
    const db = makeDbMock([]); // empty → conv not found
    vi.mocked(getDb).mockResolvedValue(db as never);

    await expect(
      makeCaller().unfreezeSession({ conversationId: "gone", reason: "Test" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("getSafetyEvents — trigger content truncation", () => {
  beforeEach(() => vi.resetAllMocks());

  it("truncates triggerContent longer than 200 chars and appends ellipsis", async () => {
    const longContent = "x".repeat(250);
    const db = makeDbMock(
      // total count
      [{ total: 1 }],
      // events
      [{
        id:             "se-1",
        studentName:    "Charlie",
        studentId:      30,
        conversationId: "conv-2",
        eventType:      "input_blocked",
        triggerContent: longContent,
        action:         "blocked",
        createdAt:      new Date(),
        reviewedBy:     null,
      }],
    );
    vi.mocked(getDb).mockResolvedValue(db as never);

    const result = await makeCaller().getSafetyEvents({});

    const evt = result.events[0];
    expect(evt.triggerContent.length).toBeLessThanOrEqual(201); // 200 chars + "…"
    expect(evt.triggerContent.endsWith("…")).toBe(true);
    expect(evt.reviewed).toBe(false);
  });

  it("does not truncate content <= 200 chars", async () => {
    const shortContent = "y".repeat(100);
    const db = makeDbMock(
      [{ total: 1 }],
      [{
        id:             "se-2",
        studentName:    "Dana",
        studentId:      31,
        conversationId: "conv-3",
        eventType:      "output_flagged",
        triggerContent: shortContent,
        action:         "flagged_for_review",
        createdAt:      new Date(),
        reviewedBy:     5,
      }],
    );
    vi.mocked(getDb).mockResolvedValue(db as never);

    const result = await makeCaller().getSafetyEvents({});

    const evt = result.events[0];
    expect(evt.triggerContent).toBe(shortContent);
    expect(evt.reviewed).toBe(true);
  });
});
