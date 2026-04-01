import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PluginSchema } from "../drizzle/schema";

// ─── Mock the database layer (Rule 4: no direct DB in feature code) ───────────

vi.mock("./db", () => ({
  getDb: vi.fn(),
}));

// Import after mocking so the module picks up the mock
import { getDb } from "./db";
import { clearAllowlistCache, getPluginSchema, isPluginAllowed } from "./pluginAllowlist";

// ─── Fixture ──────────────────────────────────────────────────────────────────

function makeChessSchema(overrides?: Partial<PluginSchema>): PluginSchema {
  return {
    id: "chess",
    name: "Chess",
    description: "Interactive chess game with AI coaching",
    origin: "http://localhost:3000",
    iframeUrl: "/apps/chess/index.html",
    toolSchemas: [],
    manifest: { lifecycleType: "continuous_bidirectional" },
    status: "active",
    allowedRoles: ["student", "teacher"],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as PluginSchema;
}

// Build a minimal mock DB that resolves .select().from().where().limit()
function makeMockDb(rows: PluginSchema[]) {
  const limitMock = vi.fn().mockResolvedValue(rows);
  const whereMock = vi.fn().mockReturnValue({ limit: limitMock });
  const fromMock = vi.fn().mockReturnValue({ where: whereMock });
  const selectMock = vi.fn().mockReturnValue({ from: fromMock });
  return { select: selectMock, _limit: limitMock };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("pluginAllowlist", () => {
  beforeEach(() => {
    clearAllowlistCache();
    vi.resetAllMocks();
  });

  describe("isPluginAllowed", () => {
    it("returns true for a seeded active plugin", async () => {
      const mockDb = makeMockDb([makeChessSchema()]);
      vi.mocked(getDb).mockResolvedValue(mockDb as never);

      const allowed = await isPluginAllowed("chess");
      expect(allowed).toBe(true);
    });

    it("returns false for an unknown plugin ID", async () => {
      const mockDb = makeMockDb([]); // no rows returned
      vi.mocked(getDb).mockResolvedValue(mockDb as never);

      const allowed = await isPluginAllowed("nonexistent_plugin");
      expect(allowed).toBe(false);
    });

    it("returns false for a disabled plugin", async () => {
      const mockDb = makeMockDb([makeChessSchema({ status: "disabled" })]);
      vi.mocked(getDb).mockResolvedValue(mockDb as never);

      const allowed = await isPluginAllowed("chess");
      expect(allowed).toBe(false);
    });
  });

  describe("getPluginSchema", () => {
    it("returns the correct schema for a known active plugin", async () => {
      const chessSchema = makeChessSchema();
      const mockDb = makeMockDb([chessSchema]);
      vi.mocked(getDb).mockResolvedValue(mockDb as never);

      const result = await getPluginSchema("chess");
      expect(result).not.toBeNull();
      expect(result?.id).toBe("chess");
      expect(result?.name).toBe("Chess");
      expect(result?.status).toBe("active");
    });

    it("returns null for an unknown plugin", async () => {
      const mockDb = makeMockDb([]);
      vi.mocked(getDb).mockResolvedValue(mockDb as never);

      const result = await getPluginSchema("ghost_plugin");
      expect(result).toBeNull();
    });
  });

  describe("cache behaviour", () => {
    it("only calls the database once for repeated queries of the same plugin", async () => {
      const chessSchema = makeChessSchema();
      const mockDb = makeMockDb([chessSchema]);
      vi.mocked(getDb).mockResolvedValue(mockDb as never);

      // Two calls — cache should prevent a second DB round-trip
      await getPluginSchema("chess");
      await getPluginSchema("chess");

      // getDb is called each time, but the DB select should only execute once
      expect(mockDb.select).toHaveBeenCalledTimes(1);
    });

    it("hits the database again after the cache is cleared", async () => {
      const chessSchema = makeChessSchema();
      const mockDb = makeMockDb([chessSchema]);
      vi.mocked(getDb).mockResolvedValue(mockDb as never);

      await getPluginSchema("chess");
      clearAllowlistCache();
      await getPluginSchema("chess");

      expect(mockDb.select).toHaveBeenCalledTimes(2);
    });
  });
});
