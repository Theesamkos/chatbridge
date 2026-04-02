/**
 * Context assembly engine (Rule 15, Rule 21, Rules 34).
 *
 * Builds the messages array and tool list sent to the LLM on every turn.
 * The assembled context is NEVER returned to the client — only passed to
 * invokeLLM / invokeLLMStream.
 */
import type { Message as LLMMessage } from "./_core/llm";
import { invokeLLM } from "./_core/llm";
import type { Message } from "../drizzle/schema";
import {
  getConversationById,
  getConversationMessages,
  getLatestPluginState,
} from "./db";
import { getPluginSchema } from "./pluginAllowlist";
import { writeAuditLog } from "./auditLog";

// Rule 21: 6,000-character truncation limit for plugin state fields
const PLUGIN_STATE_FIELD_MAX_CHARS = 6_000;

// Rule: context summarization threshold — rough estimate at 4 chars/token
const TOKEN_BUDGET = 60_000;
const CHARS_PER_TOKEN = 4;

// Injection keys stripped from plugin state (Rule 21)
const INJECTION_KEYS = new Set(["system", "instructions", "prompt", "ignore"]);

// Injection patterns matched against string VALUES in plugin state (Task 5.7)
const STATE_INJECTION_PATTERNS: RegExp[] = [
  /ignore previous instructions/i,
  /you are now/i,
  /disregard your guidelines/i,
  /pretend you are/i,
  /forget everything/i,
  /new persona/i,
  /jailbreak/i,
  /dan mode/i,
];

const BASE_SYSTEM_MESSAGE =
  "You are a helpful AI tutor for K-12 students. You are safe, encouraging, and educational. " +
  "Never provide content that is inappropriate for students under 18.";

export interface AssembledContext {
  messages: LLMMessage[];
  tools: Array<Record<string, unknown>> | undefined;
  systemMessage: string;
  pluginState: object | null;
  pluginId: string | null;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function assembleContext(
  conversationId: string,
  userId: number,
): Promise<AssembledContext> {
  // 1. Load and verify conversation ownership
  const conversation = await getConversationById(conversationId);
  if (!conversation || conversation.userId !== userId) {
    throw new Error("Conversation not found or access denied");
  }

  // 2. Load last 20 messages (chronological order already guaranteed by helper)
  let dbMessages = await getConversationMessages(conversationId, 20);

  // 3. Estimate token count
  const totalChars = dbMessages.reduce((sum, m) => sum + m.content.length, 0);
  const estimatedTokens = Math.ceil(totalChars / CHARS_PER_TOKEN);

  // 4. Summarize if over budget
  let llmMessages: LLMMessage[];
  if (estimatedTokens > TOKEN_BUDGET && dbMessages.length > 10) {
    const summary = await summarizeOldMessages(dbMessages.slice(0, 10));
    const recent = dbMessages.slice(10);
    const summaryMsg: LLMMessage = {
      role: "system",
      content: `Previous conversation summary: ${summary}`,
    };
    llmMessages = [summaryMsg, ...messagesToLLMFormat(recent)];
  } else {
    llmMessages = messagesToLLMFormat(dbMessages);
  }

  // 5 & 6. Load plugin state and tool schemas
  const activePluginId = conversation.activePluginId ?? null;
  let pluginState: object | null = null;
  let tools: Array<Record<string, unknown>> | undefined;

  if (activePluginId) {
    const stateRow = await getLatestPluginState(conversationId, activePluginId);
    if (stateRow) {
      pluginState = sanitizePluginState(stateRow.state as Record<string, unknown>, activePluginId);
    }

    const pluginSchema = await getPluginSchema(activePluginId);
    if (pluginSchema) {
      // Wrap raw function definitions into the { type: "function", function: {...} } format
      // required by invokeLLM / OpenAI-compatible APIs.
      const rawSchemas = pluginSchema.toolSchemas as Array<Record<string, unknown>>;
      tools = rawSchemas.map(schema =>
        schema.type === "function" ? schema : { type: "function", function: schema }
      );
    }
  }

  // 7. Build system message
  let systemMessage = BASE_SYSTEM_MESSAGE;

  // Always inject chess tool instructions when chess plugin is active (even before first move)
  if (activePluginId === "chess") {
    systemMessage +=
      "\n\n## CHESS PLUGIN ACTIVE — MANDATORY TOOL USAGE\n" +
      "You MUST use the provided chess tools for ALL chess interactions. This is non-negotiable.\n" +
      "Available tools: start_game, make_move, get_board_state, get_legal_moves, get_help.\n\n" +
      "RULES YOU MUST FOLLOW:\n" +
      "1. When the student asks to start a game OR play a move in the same message: call start_game FIRST, then call make_move.\n" +
      "2. When the student asks to make a move: call make_move with UCI notation (e.g. 'e2e4', 'g1f3', 'e1g1').\n" +
      "3. NEVER say you cannot make moves. You CAN and MUST make moves by calling make_move.\n" +
      "4. NEVER describe moves in text without calling the tool — always execute them.\n" +
      "5. If unsure of the position, call get_board_state or get_help first.\n" +
      "6. Use UCI notation ONLY for make_move (source square + destination square, e.g. 'e2e4').\n" +
      "7. If make_move returns an error, acknowledge it and ask what the student intended.";
  }

  if (activePluginId && pluginState !== null) {
    const pluginSchema = await getPluginSchema(activePluginId);
    const pluginName = pluginSchema?.name ?? activePluginId;
    systemMessage +=
      `\n\nCurrent ${pluginName} state: ${JSON.stringify(pluginState, null, 2)}`;

    if (activePluginId !== "chess") {
      // Non-chess plugin grounding (chess instructions already injected above)
    }

    // Teach Me Mode: inject chess-specific coaching prompt (Rule 12)
    if (
      activePluginId === "chess" &&
      (pluginState as Record<string, unknown>).teachMeMode === true
    ) {
      systemMessage +=
        "\n\nTEACH ME MODE IS ACTIVE. You are now acting as a dedicated chess instructor. " +
        "After every move, proactively explain: (1) why this move was played or what it accomplishes, " +
        "(2) any tactical or strategic ideas it creates, (3) what the opponent's best response might be. " +
        "Use simple language appropriate for a student learner. Encourage the student and celebrate good moves. " +
        "Point out mistakes kindly and suggest improvements. Reference the board position by square names (e.g. e4, d5).";
    }
  }

  return {
    messages: llmMessages,
    tools: tools && tools.length > 0 ? tools : undefined,
    systemMessage,
    pluginState,
    pluginId: activePluginId,
  };
}

/**
 * Summarize a slice of messages to fit within the token budget.
 * Returns a concise string preserving key facts (Rule 34 invariant 3).
 */
export async function summarizeOldMessages(msgs: Message[]): Promise<string> {
  const transcript = msgs
    .map(m => `${m.role}: ${m.content}`)
    .join("\n");

  const result = await invokeLLM({
    messages: [
      {
        role: "system",
        content:
          "You are a conversation summarizer. Produce a concise factual summary of the " +
          "conversation excerpt below. Preserve: key facts, learning progress, any tool " +
          "interactions, and the student's current understanding. Be brief (max 400 words).",
      },
      {
        role: "user",
        content: transcript,
      },
    ],
  });

  const content = result.choices[0]?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content) && content[0]?.type === "text") return content[0].text;
  return "(summary unavailable)";
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Convert DB message rows to the LLM Message format.
 * Properly reconstructs tool_use (assistant with tool_calls) and
 * tool_result (tool with tool_call_id) messages for the LLM API.
 */
function messagesToLLMFormat(msgs: Message[]): LLMMessage[] {
  const result: LLMMessage[] = [];
  for (const m of msgs) {
    if (m.role === "system") continue; // injected via systemMessage field

    if (m.role === "tool_use") {
      // Reconstruct as assistant message with tool_calls array
      // The last assistant message before this might need to be merged,
      // but for simplicity emit as a standalone assistant tool_call message.
      result.push({
        role: "assistant",
        content: "",
        tool_calls: [
          {
            id: m.toolCallId ?? `fallback-${m.id}`,
            type: "function",
            function: {
              name: m.toolName ?? "unknown",
              arguments: m.content,
            },
          },
        ],
      } as unknown as LLMMessage);
    } else if (m.role === "tool_result") {
      // Reconstruct as tool message with tool_call_id
      result.push({
        role: "tool",
        tool_call_id: m.toolCallId ?? `fallback-${m.id}`,
        content: m.content,
      } as unknown as LLMMessage);
    } else {
      result.push({ role: m.role as LLMMessage["role"], content: m.content });
    }
  }
  return result;
}

/**
 * Sanitize plugin state before LLM injection (Rule 21, Task 5.7).
 * - Strips keys matching injection key names
 * - Redacts string values containing injection patterns; logs to audit_logs
 * - Truncates string values longer than 6,000 characters
 */
export function sanitizePluginState(
  state: Record<string, unknown>,
  pluginId = "unknown",
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(state)) {
    if (INJECTION_KEYS.has(key.toLowerCase())) continue;

    if (typeof value === "string") {
      // Check for injection patterns in the value (Task 5.7)
      const hasInjection = STATE_INJECTION_PATTERNS.some(p => p.test(value));
      if (hasInjection) {
        writeAuditLog({
          eventType: "INJECTION_DETECTED",
          pluginId,
          payload: { field: key, detectedIn: "plugin_state" },
          severity: "warning",
        }).catch(err => console.error("[AuditLog]", err));
        result[key] = "[REDACTED]";
        continue;
      }
      result[key] = value.length > PLUGIN_STATE_FIELD_MAX_CHARS
        ? value.slice(0, PLUGIN_STATE_FIELD_MAX_CHARS)
        : value;
    } else if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      result[key] = sanitizePluginState(value as Record<string, unknown>, pluginId);
    } else {
      result[key] = value;
    }
  }

  return result;
}
