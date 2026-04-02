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
    allowedRoles: ["student", "teacher", "admin"],
    toolSchemas: [
      {
        name: "make_move",
        description:
          "Make a chess move on the board. Call this when the student asks to move a piece or when coaching a specific move. Input must be UCI notation (e.g. 'e2e4' to move from e2 to e4, 'e1g1' for kingside castling).",
        parameters: {
          type: "object",
          properties: {
            move: {
              type: "string",
              description:
                "Move in UCI notation, e.g. 'e2e4', 'g1f3', 'e1g1' (kingside castle). Do NOT use SAN format.",
            },
          },
          required: ["move"],
        },
      },
      {
        name: "get_board_state",
        description:
          "Get the current board position as a FEN string. Call this before giving tactical or positional coaching so you know what the student is seeing.",
        parameters: {
          type: "object",
          properties: {},
          required: [],
        },
      },
      {
        name: "get_legal_moves",
        description:
          "Get all legal moves available in the current position. Call this when the student asks what they can play, or to evaluate threats and tactics. Optionally filter to moves from a specific square.",
        parameters: {
          type: "object",
          properties: {
            square: {
              type: "string",
              description:
                "Optional: filter to moves originating from this square, e.g. 'e2'. Omit to get every legal move.",
            },
          },
          required: [],
        },
      },
      {
        name: "start_game",
        description:
          "Start a new chess game, resetting the board. Call this when the student wants to begin a fresh game or study a specific position. Optionally provide a FEN string to set a custom starting position.",
        parameters: {
          type: "object",
          properties: {
            fen: {
              type: "string",
              description:
                "Optional FEN string for a custom starting position. Omit to start from the standard initial position.",
            },
          },
          required: [],
        },
      },
      {
        name: "get_help",
        description:
          "Get the full structured game state including all legal moves, captured pieces, and move history for position-aware coaching. Call this when the student asks for help, hints, or coaching advice — it gives you everything you need to provide accurate, grounded guidance without hallucinating moves.",
        parameters: {
          type: "object",
          properties: {},
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
    description: "Drag-and-drop historical event ordering activity with deterministic validation",
    origin: "http://localhost:3000",
    iframeUrl: "/apps/timeline/index.html",
    status: "active",
    allowedRoles: ["student", "teacher", "admin"],
    toolSchemas: [
      {
        name: "load_timeline",
        description:
          "Load a set of historical events into the Timeline Builder for the student to arrange in chronological order. Call this when the student wants to practice a history topic. Available topics: 'American Civil War', 'American Revolution', 'Ancient Rome', 'World War II', 'Space Race', 'French Revolution', 'Cold War', 'Industrial Revolution'. The app shuffles the events so the student must figure out the correct order.",
        parameters: {
          type: "object",
          properties: {
            topic: {
              type: "string",
              description:
                "Exact topic name to load, e.g. 'American Civil War', 'Space Race', 'French Revolution'. Must match one of the available topics exactly.",
            },
          },
          required: ["topic"],
        },
      },
      {
        name: "validate_arrangement",
        description:
          "Trigger deterministic validation of the student's current event arrangement. Call this when the student says they are done arranging, asks for feedback, or wants to check their answer. The app compares the student's order against the correct chronological order and returns a structured result with per-item correctness, score, and completion status. This does NOT use the LLM — it is pure application logic.",
        parameters: {
          type: "object",
          properties: {},
          required: [],
        },
      },
      {
        name: "get_state",
        description:
          "Get the current state of the Timeline Builder activity. Call this to check what topic is loaded, how many events the student has arranged, whether they have submitted, and their current score. Use this before giving coaching advice so you have accurate context.",
        parameters: {
          type: "object",
          properties: {},
          required: [],
        },
      },
      {
        name: "reset_timeline",
        description:
          "Reset the current timeline activity to a new shuffled order, clearing any previous submission and score. Call this when the student wants to try the same topic again from scratch, or when you want to give them another attempt after a poor score.",
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
    id: "artifact-studio",
    name: "Artifact Investigation Studio",
    description: "Guided artifact-based historical inquiry",
    origin: "http://localhost:3000",
    iframeUrl: "/apps/artifact-studio/index.html",
    status: "active",
    allowedRoles: ["student", "teacher", "admin"],
    toolSchemas: [
      {
        name: "search_artifacts",
        description:
          "Search the Smithsonian Open Access collection (with Library of Congress fallback) for artifacts matching a query. Call this when the student wants to find objects to investigate. Optionally filter by date range or cultural context. Results are paginated — pass page to load more.",
        parameters: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "Search terms, e.g. 'Civil War uniform', 'ancient Rome pottery'.",
            },
            dateRange: {
              type: "string",
              description: "Optional date range filter, e.g. '1860-1870'.",
            },
            culturalContext: {
              type: "string",
              description:
                "Optional cultural context filter, e.g. 'Native American', 'Victorian England'.",
            },
            page: {
              type: "integer",
              minimum: 0,
              description: "Zero-based page index for pagination. Defaults to 0.",
            },
          },
          required: ["query"],
        },
      },
      {
        name: "get_artifact_detail",
        description:
          "Retrieve full metadata and images for a specific artifact by its id and source. Call this after the student selects an item from search results to load it into the investigation view. Requires the id and source ('smithsonian' or 'loc') returned by search_artifacts.",
        parameters: {
          type: "object",
          properties: {
            id: {
              type: "string",
              description: "Artifact id as returned by search_artifacts.",
            },
            source: {
              type: "string",
              enum: ["smithsonian", "loc"],
              description: "API source the artifact came from.",
            },
          },
          required: ["id", "source"],
        },
      },
      {
        name: "submit_investigation",
        description:
          "Submit the student's completed artifact investigation for tutor review. Call this when the student indicates they are finished annotating and ready to submit their reasoning chain. The app validates internally that the required fields are present — no arguments are required from the LLM.",
        parameters: {
          type: "object",
          properties: {},
          required: [],
        },
      },
    ],
    manifest: {
      lifecycleType: "guided_completion",
      systemPromptAppend:
        "Evaluate the quality of the student's reasoning chain. Focus on: (1) whether their observations are specific and grounded in what they described seeing, (2) whether their evidence logically follows from their observations, (3) whether their claims are supported by their evidence. Do NOT evaluate whether their historical conclusion is factually correct — evaluate the quality of their reasoning process.",
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
