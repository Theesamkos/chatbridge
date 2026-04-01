/**
 * One-time seed script — inserts the three plugin manifests into plugin_schemas.
 *
 * Run with:
 *   npx tsx server/seed.ts
 *
 * This script is idempotent: it uses INSERT ... ON DUPLICATE KEY UPDATE so
 * re-running it updates the records rather than failing.
 */
import "dotenv/config";
import { pluginSchemas, type InsertPluginSchema } from "../drizzle/schema";
import { getDb } from "./db";

const plugins: InsertPluginSchema[] = [
  // ─── Chess ─────────────────────────────────────────────────────────────────
  {
    id: "chess",
    name: "Chess",
    description: "Interactive chess game with AI coaching",
    origin: "http://localhost:3000",
    iframeUrl: "/apps/chess/index.html",
    status: "active",
    allowedRoles: ["student", "teacher"],
    toolSchemas: [
      {
        name: "chess_make_move",
        description:
          "Make a chess move. Call this when the student wants to move a piece. Input must be standard algebraic notation.",
        parameters: {
          type: "object",
          properties: {
            move: {
              type: "string",
              description: "Move in SAN format, e.g. 'e4', 'Nf3', 'O-O'",
            },
          },
          required: ["move"],
        },
      },
      {
        name: "chess_get_board_state",
        description:
          "Get the current board state as a FEN string. Call this to understand what the student is seeing before giving coaching advice.",
        parameters: {
          type: "object",
          properties: {},
          required: [],
        },
      },
      {
        name: "chess_get_legal_moves",
        description:
          "Get all legal moves from the current position. Call this when the student asks what moves are available or when evaluating tactics.",
        parameters: {
          type: "object",
          properties: {
            square: {
              type: "string",
              description:
                "Optional: restrict to moves from a specific square, e.g. 'e2'. Omit to get all legal moves.",
            },
          },
          required: [],
        },
      },
      {
        name: "chess_start_game",
        description:
          "Start a new chess game, optionally with a specific position. Call this to reset the board.",
        parameters: {
          type: "object",
          properties: {
            fen: {
              type: "string",
              description:
                "Optional FEN string for starting position. Omit to start from the standard initial position.",
            },
          },
          required: [],
        },
      },
    ],
    manifest: {
      lifecycleType: "continuous_bidirectional",
    },
  },

  // ─── Timeline Builder ───────────────────────────────────────────────────────
  {
    id: "timeline",
    name: "Timeline Builder",
    description: "Historical event ordering activity",
    origin: "http://localhost:3000",
    iframeUrl: "/apps/timeline/index.html",
    status: "active",
    allowedRoles: ["student", "teacher"],
    toolSchemas: [
      {
        name: "timeline_load_timeline",
        description:
          "Load a set of historical events into the timeline app for the student to arrange. Call this to begin a new timeline activity.",
        parameters: {
          type: "object",
          properties: {
            events: {
              type: "array",
              description: "Array of events to load",
              items: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  title: { type: "string" },
                  year: { type: "integer" },
                  description: { type: "string" },
                  category: {
                    type: "string",
                    enum: ["political", "cultural", "scientific", "economic", "military"],
                  },
                },
                required: ["id", "title", "year", "description", "category"],
              },
            },
            topic: {
              type: "string",
              description: "Topic label shown to the student, e.g. 'World War II'",
            },
          },
          required: ["events", "topic"],
        },
      },
      {
        name: "timeline_validate_arrangement",
        description:
          "Check whether the student's current event arrangement is chronologically correct. Call this when the student says they are done or asks for feedback.",
        parameters: {
          type: "object",
          properties: {},
          required: [],
        },
      },
    ],
    manifest: {
      lifecycleType: "structured_completion",
    },
  },

  // ─── Artifact Investigation Studio ─────────────────────────────────────────
  {
    id: "artifact_studio",
    name: "Artifact Investigation Studio",
    description: "Guided artifact-based historical inquiry",
    origin: "http://localhost:3000",
    iframeUrl: "/apps/artifact-studio/index.html",
    status: "active",
    allowedRoles: ["student", "teacher"],
    toolSchemas: [
      {
        name: "artifact_search",
        description:
          "Search the Smithsonian Open Access collection for artifacts matching a query. Call this when the student wants to find objects to investigate.",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "Search terms, e.g. 'Civil War uniform'" },
            category: {
              type: "string",
              enum: ["art", "history", "science", "culture", "all"],
            },
            limit: { type: "integer", minimum: 1, maximum: 20, default: 10 },
          },
          required: ["query", "category"],
        },
      },
      {
        name: "artifact_get_artifact_detail",
        description:
          "Retrieve full metadata for a specific artifact. Call this after the student selects an item from search results to load it into the investigation view.",
        parameters: {
          type: "object",
          properties: {
            artifactId: { type: "string" },
            source: { type: "string", enum: ["smithsonian", "loc"] },
          },
          required: ["artifactId", "source"],
        },
      },
      {
        name: "artifact_submit_investigation",
        description:
          "Submit the student's completed inquiry for tutor review. Call this when the student has annotated the artifact and is ready to submit their findings.",
        parameters: {
          type: "object",
          properties: {
            artifactId: { type: "string" },
            inquiryQuestion: { type: "string" },
            conclusion: { type: "string" },
          },
          required: ["artifactId", "inquiryQuestion", "conclusion"],
        },
      },
    ],
    manifest: {
      lifecycleType: "guided_completion",
    },
  },
];

async function seed() {
  const db = await getDb();
  if (!db) {
    console.error("[Seed] DATABASE_URL is not set — cannot seed.");
    process.exit(1);
  }

  console.log("[Seed] Inserting plugin manifests...");

  for (const plugin of plugins) {
    await db
      .insert(pluginSchemas)
      .values(plugin)
      .onDuplicateKeyUpdate({
        set: {
          name: plugin.name,
          description: plugin.description,
          origin: plugin.origin,
          iframeUrl: plugin.iframeUrl,
          toolSchemas: plugin.toolSchemas,
          manifest: plugin.manifest,
          status: plugin.status,
          allowedRoles: plugin.allowedRoles,
        },
      });
    console.log(`[Seed]   ✓ ${plugin.id}`);
  }

  console.log("[Seed] Done.");
  process.exit(0);
}

seed().catch(err => {
  console.error("[Seed] Fatal:", err);
  process.exit(1);
});
