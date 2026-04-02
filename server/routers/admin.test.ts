/**
 * Admin router tests (Task 6B.6, Phase 6B).
 *
 * Rule 35: authenticated success, unauthenticated/role rejection for every procedure.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// ─── Mock dependencies ────────────────────────────────────────────────────────

vi.mock("../db", () => ({
  getDb: vi.fn(),
}));

vi.mock("../auditLog", () => ({
  writeAuditLog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../circuitBreaker", () => ({
  circuitBreaker: {
    hasActiveBreaker:  vi.fn().mockReturnValue(false),
    resetAllForPlugin: vi.fn(),
    isActive:          vi.fn().mockReturnValue(false),
    recordFailure:     vi.fn().mockReturnValue(false),
    reset:             vi.fn(),
  },
}));

import { getDb } from "../db";
import { writeAuditLog } from "../auditLog";
import { circuitBreaker } from "../circuitBreaker";
import { adminRouter } from "./admin";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeCaller(role: "student" | "teacher" | "admin" = "admin") {
  const ctx = {
    user: { id: 1, role, openId: "u1", name: "Admin Test", email: "a@a.com" },
    req: {} as never,
    res: {} as never,
  } as never;
  return adminRouter.createCaller(ctx);
}

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

function makeDbMock(...results: unknown[]) {
  let i = 0;
  const next = () => results[i++] ?? [];
  return {
    select: vi.fn((..._args: unknown[]) => chainFrom(next())),
    update: vi.fn((..._args: unknown[]) => chainFrom(next())),
    insert: vi.fn((..._args: unknown[]) => chainFrom(next())),
  };
}

// ─── Role guard (Rule 35) ─────────────────────────────────────────────────────

describe("adminRouter — role guard", () => {
  it("throws FORBIDDEN for student role", async () => {
    vi.mocked(getDb).mockResolvedValue(null as never);
    await expect(makeCaller("student").getCostMetrics({})).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("throws FORBIDDEN for teacher role", async () => {
    vi.mocked(getDb).mockResolvedValue(null as never);
    await expect(makeCaller("teacher").getCostMetrics({})).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("allows admin role through", async () => {
    const db = makeDbMock(
      [{ totalInputTokens: "0", totalOutputTokens: "0", totalRequests: "0" }],
      [{ distinctUsers: "0" }],
    );
    vi.mocked(getDb).mockResolvedValue(db as never);
    const result = await makeCaller("admin").getCostMetrics({});
    expect(result.metrics.totalRequests).toBe(0);
  });
});

// ─── getCostMetrics ───────────────────────────────────────────────────────────

describe("getCostMetrics", () => {
  beforeEach(() => vi.resetAllMocks());

  it("computes estimated cost correctly from token counts", async () => {
    // 1M input tokens × $3/M = $3.00
    // 0.5M output tokens × $15/M = $7.50
    // Total = $10.50
    const db = makeDbMock(
      [{ totalInputTokens: "1000000", totalOutputTokens: "500000", totalRequests: "100" }],
      [{ distinctUsers: "10" }],
    );
    vi.mocked(getDb).mockResolvedValue(db as never);

    const result = await makeCaller().getCostMetrics({});
    const m = result.metrics;

    expect(m.totalInputTokens).toBe(1_000_000);
    expect(m.totalOutputTokens).toBe(500_000);
    expect(m.totalRequests).toBe(100);
    expect(m.estimatedCostUSD).toBeCloseTo(10.5, 2);
  });

  it("projections scale linearly from per-user average", async () => {
    // 100 requests from 10 users = 10 req/user
    const db = makeDbMock(
      [{ totalInputTokens: "200000", totalOutputTokens: "100000", totalRequests: "100" }],
      [{ distinctUsers: "10" }],
    );
    vi.mocked(getDb).mockResolvedValue(db as never);

    const result = await makeCaller().getCostMetrics({});
    const { projections } = result.metrics;

    // 100 users → 10× the per-user average (10 req/user × 100 = 1,000 requests)
    expect(projections.per100Users.requests).toBe(1_000);
    // 1,000 users → 100× (10,000 requests)
    expect(projections.per1KUsers.requests).toBe(10_000);
    // Costs scale proportionally: 10K users / 100 users = 100×
    expect(projections.per10KUsers.estimatedCostUSD).toBeCloseTo(
      projections.per100Users.estimatedCostUSD * 100,
      0,
    );
  });

  it("returns zeros when no data is present", async () => {
    const db = makeDbMock(
      [{ totalInputTokens: "0", totalOutputTokens: "0", totalRequests: "0" }],
      [{ distinctUsers: "0" }],
    );
    vi.mocked(getDb).mockResolvedValue(db as never);

    const result = await makeCaller().getCostMetrics({});
    expect(result.metrics.estimatedCostUSD).toBe(0);
    expect(result.metrics.avgTokensPerRequest).toBe(0);
  });
});

// ─── updateUserRole ───────────────────────────────────────────────────────────

describe("updateUserRole", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(writeAuditLog).mockResolvedValue(undefined);
  });

  it("throws FORBIDDEN when trying to change own role (userId === ctx.user.id)", async () => {
    // ctx.user.id is 1 (from makeCaller)
    vi.mocked(getDb).mockResolvedValue(null as never);
    await expect(
      makeCaller().updateUserRole({ userId: 1, role: "student", reason: "Test" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("updates role and writes audit log for another user", async () => {
    const db = makeDbMock(
      [{ id: 42, role: "student" }], // select user
      undefined,                      // update user
    );
    vi.mocked(getDb).mockResolvedValue(db as never);

    const result = await makeCaller().updateUserRole({
      userId: 42,
      role:   "teacher",
      reason: "Promotion approved",
    });

    expect(result.success).toBe(true);
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "user_role_changed",
        payload: expect.objectContaining({
          userId:  42,
          oldRole: "student",
          newRole: "teacher",
          reason:  "Promotion approved",
        }),
      }),
    );
  });

  it("throws NOT_FOUND when user does not exist", async () => {
    const db = makeDbMock([]); // empty → user not found
    vi.mocked(getDb).mockResolvedValue(db as never);

    await expect(
      makeCaller().updateUserRole({ userId: 99, role: "admin", reason: "Test" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

// ─── updatePluginStatus ───────────────────────────────────────────────────────

describe("updatePluginStatus", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(writeAuditLog).mockResolvedValue(undefined);
    vi.mocked(circuitBreaker.resetAllForPlugin).mockReturnValue(undefined);
  });

  it("writes audit log with correct old/new status and reason", async () => {
    const db = makeDbMock(
      [{ id: "chess", status: "active" }], // select plugin
      undefined,                            // update plugin
    );
    vi.mocked(getDb).mockResolvedValue(db as never);

    const result = await makeCaller().updatePluginStatus({
      pluginId: "chess",
      status:   "disabled",
      reason:   "Maintenance",
    });

    expect(result.success).toBe(true);
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "plugin_status_changed",
        payload: expect.objectContaining({
          pluginId:  "chess",
          oldStatus: "active",
          newStatus: "disabled",
          reason:    "Maintenance",
        }),
      }),
    );
  });

  it("calls resetAllForPlugin when status is suspended", async () => {
    const db = makeDbMock(
      [{ id: "timeline", status: "active" }],
      undefined,
    );
    vi.mocked(getDb).mockResolvedValue(db as never);

    await makeCaller().updatePluginStatus({
      pluginId: "timeline",
      status:   "suspended",
      reason:   "Safety investigation",
    });

    expect(circuitBreaker.resetAllForPlugin).toHaveBeenCalledWith("timeline");
  });

  it("does not call resetAllForPlugin when status is not suspended", async () => {
    const db = makeDbMock(
      [{ id: "chess", status: "disabled" }],
      undefined,
    );
    vi.mocked(getDb).mockResolvedValue(db as never);

    await makeCaller().updatePluginStatus({
      pluginId: "chess",
      status:   "active",
      reason:   "Re-enabling",
    });

    expect(circuitBreaker.resetAllForPlugin).not.toHaveBeenCalled();
  });

  it("throws NOT_FOUND when plugin does not exist", async () => {
    const db = makeDbMock([]);
    vi.mocked(getDb).mockResolvedValue(db as never);

    await expect(
      makeCaller().updatePluginStatus({ pluginId: "none", status: "active", reason: "Test" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

// ─── getPluginFailures ────────────────────────────────────────────────────────

describe("getPluginFailures", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns paginated failures with plugin name", async () => {
    const db = makeDbMock(
      [{ total: 1 }],
      [{
        id:             "pf-1",
        pluginId:       "chess",
        pluginName:     "Chess",
        conversationId: "conv-1",
        failureType:    "timeout",
        errorDetail:    "Tool timed out",
        resolved:       false,
        createdAt:      new Date(),
      }],
    );
    vi.mocked(getDb).mockResolvedValue(db as never);

    const result = await makeCaller().getPluginFailures({});
    expect(result.total).toBe(1);
    expect(result.failures[0].pluginName).toBe("Chess");
    expect(result.failures[0].resolved).toBe(false);
  });
});
