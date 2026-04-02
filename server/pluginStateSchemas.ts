/**
 * Per-plugin state schema validators (Phase 6 — Safety Hardening).
 *
 * Every STATE_UPDATE and TOOL_RESULT that arrives from a plugin iframe is
 * untrusted input.  Before any state is persisted to the database or injected
 * into the LLM context it MUST pass the corresponding schema here.
 *
 * Rules enforced:
 *  - No extra keys that could carry injection payloads (strict mode where practical)
 *  - String fields have a maximum length to prevent oversized payloads
 *  - Numeric fields are bounded to valid game ranges
 *  - Enum fields are constrained to their known value sets
 */

import { z } from "zod";

// ─── Chess ────────────────────────────────────────────────────────────────────

/**
 * FEN string validation — must match the standard 6-field FEN format.
 * We do a lightweight structural check rather than a full chess-rule parse.
 */
const fenString = z
  .string()
  .max(100)
  .regex(
    /^[1-8pnbrqkPNBRQK/]+ [wb] [KQkq-]+ [a-h1-8-]+ \d+ \d+$/,
    "Invalid FEN string",
  );

export const chessStateSchema = z.object({
  fen: fenString.optional(),
  status: z.enum(["idle", "active", "check", "checkmate", "stalemate", "draw"]).optional(),
  lastMove: z
    .object({
      from: z.string().max(2),
      to: z.string().max(2),
      san: z.string().max(10).optional(),
    })
    .nullable()
    .optional(),
  moveCount: z.number().int().min(0).max(500).optional(),
  capturedPieces: z
    .object({
      white: z.array(z.string().max(1)).max(16),
      black: z.array(z.string().max(1)).max(16),
    })
    .optional(),
  teachMode: z.boolean().optional(),
});

export type ChessState = z.infer<typeof chessStateSchema>;

// ─── Timeline Builder ─────────────────────────────────────────────────────────

const timelineEventSchema = z.object({
  id: z.string().max(64),
  label: z.string().max(200),
  year: z.number().int().min(-10000).max(2100),
  position: z.number().int().min(0).max(20),
});

export const timelineStateSchema = z.object({
  topic: z.string().max(200).optional(),
  events: z.array(timelineEventSchema).max(20).optional(),
  correctOrder: z.array(z.string().max(64)).max(20).optional(),
  attempts: z.number().int().min(0).max(100).optional(),
  score: z.number().min(0).max(100).optional(),
  completed: z.boolean().optional(),
  startedAt: z.number().optional(),
  completedAt: z.number().optional(),
});

export type TimelineState = z.infer<typeof timelineStateSchema>;

// ─── Artifact Investigation Studio ───────────────────────────────────────────

const investigationSchema = z.object({
  observations: z.string().max(2000).optional(),
  evidence: z.array(z.string().max(200)).max(20).optional(),
  interpretation: z.string().max(2000).optional(),
  hypothesis: z.string().max(1000).optional(),
});

const artifactSchema = z.object({
  id: z.string().max(128),
  title: z.string().max(300),
  imageUrl: z.string().url().max(500),
  source: z.enum(["smithsonian", "loc", "cache"]).optional(),
  metadata: z
    .object({
      date: z.string().max(100).optional(),
      origin: z.string().max(200).optional(),
      medium: z.string().max(200).optional(),
      dimensions: z.string().max(100).optional(),
      collection: z.string().max(200).optional(),
    })
    .optional(),
});

export const artifactStudioStateSchema = z.object({
  artifact: artifactSchema.nullable().optional(),
  step: z.enum(["discover", "inspect", "investigate", "conclude"]).optional(),
  investigation: investigationSchema.optional(),
  score: z.number().min(0).max(100).optional(),
  completed: z.boolean().optional(),
  startedAt: z.number().optional(),
  completedAt: z.number().optional(),
  apiSource: z.enum(["smithsonian", "loc", "cache", "none"]).optional(),
});

export type ArtifactStudioState = z.infer<typeof artifactStudioStateSchema>;

// ─── Registry ─────────────────────────────────────────────────────────────────

type PluginStateSchema =
  | typeof chessStateSchema
  | typeof timelineStateSchema
  | typeof artifactStudioStateSchema;

const PLUGIN_STATE_SCHEMAS: Record<string, PluginStateSchema> = {
  chess: chessStateSchema,
  timeline: timelineStateSchema,
  "artifact-studio": artifactStudioStateSchema,
};

export interface StateValidationResult {
  valid: boolean;
  error?: string;
  sanitized?: Record<string, unknown>;
}

/**
 * Validate plugin state against the registered schema for that plugin.
 * Returns { valid: true, sanitized } on success or { valid: false, error } on failure.
 *
 * If no schema is registered for the pluginId, the state passes through
 * (forward-compatible with future plugins).
 */
export function validatePluginState(
  pluginId: string,
  state: unknown,
): StateValidationResult {
  const schema = PLUGIN_STATE_SCHEMAS[pluginId];
  if (!schema) {
    // No schema registered — allow through (unknown plugin, forward-compat)
    if (typeof state !== "object" || state === null || Array.isArray(state)) {
      return { valid: false, error: "State must be a plain object" };
    }
    return { valid: true, sanitized: state as Record<string, unknown> };
  }

  const result = schema.safeParse(state);
  if (!result.success) {
    const firstIssue = result.error.issues[0];
    return {
      valid: false,
      error: `Schema validation failed: ${firstIssue?.path.join(".") ?? "root"} — ${firstIssue?.message ?? "invalid"}`,
    };
  }

  return { valid: true, sanitized: result.data as Record<string, unknown> };
}

/**
 * Scan a state object for prompt injection patterns.
 * Recursively inspects all string values up to 3 levels deep.
 */
const INJECTION_PATTERNS: RegExp[] = [
  /ignore previous instructions/i,
  /you are now/i,
  /disregard your guidelines/i,
  /pretend you are/i,
  /forget everything/i,
  /new persona/i,
  /jailbreak/i,
  /dan mode/i,
  /system prompt/i,
  /override instructions/i,
];

export function inspectStateForInjection(
  state: unknown,
  depth = 0,
): { clean: boolean; reason?: string } {
  if (depth > 3) return { clean: true };

  if (typeof state === "string") {
    for (const pattern of INJECTION_PATTERNS) {
      if (pattern.test(state)) {
        return { clean: false, reason: `Injection pattern detected in state string: "${pattern.source}"` };
      }
    }
    return { clean: true };
  }

  if (Array.isArray(state)) {
    for (const item of state) {
      const result = inspectStateForInjection(item, depth + 1);
      if (!result.clean) return result;
    }
    return { clean: true };
  }

  if (typeof state === "object" && state !== null) {
    for (const value of Object.values(state)) {
      const result = inspectStateForInjection(value, depth + 1);
      if (!result.clean) return result;
    }
    return { clean: true };
  }

  return { clean: true };
}
