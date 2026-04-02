import { beforeEach, describe, expect, it, vi } from "vitest";

// ─── Mock dependencies ────────────────────────────────────────────────────────

vi.mock("../db", () => ({
  getConversationById: vi.fn(),
  getLatestPluginState: vi.fn(),
  listPluginSchemas: vi.fn(),
  createPluginSchema: vi.fn(),
  updatePluginStatus: vi.fn(),
  updateConversationActivePlugin: vi.fn(),
  upsertPluginState: vi.fn(),
}));

vi.mock("../pluginAllowlist", () => ({
  getPluginSchema: vi.fn(),
  clearAllowlistCache: vi.fn(),
}));

vi.mock("../auditLog", () => ({
  writeAuditLog: vi.fn(),
}));

import {
  getConversationById,
  listPluginSchemas,
  updatePluginStatus,
  updateConversationActivePlugin,
  upsertPluginState,
} from "../db";
import { getPluginSchema, clearAllowlistCache } from "../pluginAllowlist";
import { pluginsRouter } from "./plugins";
import type { Conversation, PluginSchema } from "../../drizzle/schema";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeConv(overrides?: Partial<Conversation>): Conversation {
  return {
    id: "conv-1",
    userId: 42,
    title: "Test",
    activePluginId: null,
    status: "active",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makePluginSchema(overrides?: Partial<PluginSchema>): PluginSchema {
  return {
    id: "chess",
    name: "Chess",
    description: "Chess game",
    origin: "http://localhost:3000",
    iframeUrl: "/apps/chess/index.html",
    toolSchemas: [],
    manifest: {},
    status: "active",
    allowedRoles: ["student", "teacher"],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as PluginSchema;
}

function makeCaller(role: "student" | "teacher" | "admin" = "student") {
  const ctx = {
    user: { id: 42, role, openId: "u1", name: "Test", email: "t@t.com" },
    req: {} as never,
    res: {} as never,
  } as never;
  return pluginsRouter.createCaller(ctx);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

import { writeAuditLog } from "../auditLog";

describe("plugins.activate", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(writeAuditLog).mockResolvedValue(undefined);
    vi.mocked(updateConversationActivePlugin).mockResolvedValue(undefined);
  });

  // Rule 35 auth paths:

  it("activates a plugin when user owns the conversation and role is allowed", async () => {
    vi.mocked(getConversationById).mockResolvedValue(makeConv());
    vi.mocked(getPluginSchema).mockResolvedValue(makePluginSchema());

    const result = await makeCaller("student").activate({ conversationId: "conv-1", pluginId: "chess" });

    expect(result).toMatchObject({ success: true, pluginId: "chess" });
    expect(updateConversationActivePlugin).toHaveBeenCalledWith("conv-1", "chess");
  });

  it("throws NOT_FOUND when conversation belongs to another user (unauthenticated-equivalent)", async () => {
    vi.mocked(getConversationById).mockResolvedValue(makeConv({ userId: 999 }));

    await expect(
      makeCaller("student").activate({ conversationId: "conv-1", pluginId: "chess" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("throws FORBIDDEN when user role is not in allowedRoles", async () => {
    vi.mocked(getConversationById).mockResolvedValue(makeConv());
    vi.mocked(getPluginSchema).mockResolvedValue(makePluginSchema({ allowedRoles: ["teacher"] }));

    await expect(
      makeCaller("student").activate({ conversationId: "conv-1", pluginId: "chess" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("plugins.deactivate", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(writeAuditLog).mockResolvedValue(undefined);
    vi.mocked(updateConversationActivePlugin).mockResolvedValue(undefined);
  });

  it("deactivates the active plugin for the owning user", async () => {
    vi.mocked(getConversationById).mockResolvedValue(makeConv({ activePluginId: "chess" }));

    const result = await makeCaller().deactivate({ conversationId: "conv-1" });

    expect(result).toMatchObject({ success: true });
    expect(updateConversationActivePlugin).toHaveBeenCalledWith("conv-1", null);
  });

  it("throws NOT_FOUND when conversation belongs to another user", async () => {
    vi.mocked(getConversationById).mockResolvedValue(makeConv({ userId: 999 }));

    await expect(
      makeCaller().deactivate({ conversationId: "conv-1" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("plugins.updateState", () => {
  beforeEach(() => vi.resetAllMocks());

  it("persists state when plugin is active for the conversation", async () => {
    vi.mocked(getConversationById).mockResolvedValue(makeConv({ activePluginId: "chess" }));
    vi.mocked(upsertPluginState).mockResolvedValue({
      id: "ps-1",
      conversationId: "conv-1",
      pluginId: "chess",
      state: { fen: "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1", status: "active" },
      version: 2,
      createdAt: new Date(),
    });

    // Phase 6: state must pass the chess schema validator
    const result = await makeCaller().updateState({
      conversationId: "conv-1",
      pluginId: "chess",
      state: { fen: "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1", status: "active" },
    });

    expect(result).toMatchObject({ success: true, version: 2 });
  });

  it("rejects state that fails chess schema validation", async () => {
    vi.mocked(getConversationById).mockResolvedValue(makeConv({ activePluginId: "chess" }));

    await expect(
      makeCaller().updateState({
        conversationId: "conv-1",
        pluginId: "chess",
        state: { board: "not-a-fen" }, // missing required fields
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("throws BAD_REQUEST when plugin is not active for that conversation", async () => {
    vi.mocked(getConversationById).mockResolvedValue(makeConv({ activePluginId: null }));

    await expect(
      makeCaller().updateState({ conversationId: "conv-1", pluginId: "chess", state: {} }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("plugins.list", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns only active plugins visible to the user role", async () => {
    vi.mocked(listPluginSchemas).mockResolvedValue([
      makePluginSchema({ id: "chess",     status: "active",   allowedRoles: ["student", "teacher"] }),
      makePluginSchema({ id: "timeline",  status: "disabled", allowedRoles: ["student"] }),
      makePluginSchema({ id: "admin-cfg", status: "active",   allowedRoles: ["admin"] }),
    ]);

    const result = await makeCaller("student").list();
    expect(result.map(p => p.id)).toEqual(["chess"]);
  });

  it("admin sees all active plugins regardless of allowedRoles", async () => {
    vi.mocked(listPluginSchemas).mockResolvedValue([
      makePluginSchema({ id: "chess",     status: "active",   allowedRoles: ["student"] }),
      makePluginSchema({ id: "admin-cfg", status: "active",   allowedRoles: ["admin"] }),
      makePluginSchema({ id: "disabled",  status: "disabled", allowedRoles: ["admin"] }),
    ]);

    const result = await makeCaller("admin").list();
    expect(result.map(p => p.id)).toEqual(["chess", "admin-cfg"]);
  });
});

describe("plugins.enable / disable (admin only)", () => {
  beforeEach(() => vi.resetAllMocks());

  it("enable sets status to active and clears allowlist cache", async () => {
    vi.mocked(updatePluginStatus).mockResolvedValue(undefined);

    const result = await makeCaller("admin").enable({ pluginId: "chess" });

    expect(result).toMatchObject({ success: true });
    expect(updatePluginStatus).toHaveBeenCalledWith("chess", "active");
    expect(clearAllowlistCache).toHaveBeenCalled();
  });

  it("disable sets status to disabled and clears allowlist cache", async () => {
    vi.mocked(updatePluginStatus).mockResolvedValue(undefined);

    const result = await makeCaller("admin").disable({ pluginId: "chess" });

    expect(result).toMatchObject({ success: true });
    expect(updatePluginStatus).toHaveBeenCalledWith("chess", "disabled");
    expect(clearAllowlistCache).toHaveBeenCalled();
  });
});
