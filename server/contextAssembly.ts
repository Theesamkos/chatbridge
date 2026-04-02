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

  // Chess plugin: inject strong role + behavior instructions
  if (activePluginId === "chess") {
    systemMessage +=
      "\n\n## CHESS PLUGIN — YOU ARE THE AI OPPONENT (BLACK PIECES)\n" +
      "You are playing chess as BLACK against the student (WHITE). This is a real game.\n" +
      "You MUST use the chess tools to execute all moves. Never describe moves in text only.\n\n" +
      "MANDATORY BEHAVIOR — FOLLOW EXACTLY:\n" +
      "1. STARTING A GAME: When the student asks to start a game, call start_game immediately.\n" +
      "2. AFTER WHITE MOVES: After the student plays a move as White, you MUST immediately call make_move to play Black's response. Do NOT ask the student what Black should play. Do NOT say 'what would you like me to play?' — just pick a strong move and call make_move right away.\n" +
      "3. START + MOVE IN ONE MESSAGE: If the student says 'start game and play e4' or 'let's play, I'll open with d4', call start_game first, then call make_move for White's move (e.g. e2e4), then IMMEDIATELY call make_move AGAIN for Black's response without asking.\n" +
      "4. NEVER ask the student what move Black should make — you are Black, you decide.\n" +
      "5. NEVER respond with only text when a move needs to be made — always call make_move.\n" +
      "6. UCI notation: use source+destination squares (e.g. 'e7e5', 'g8f6', 'e8g8' for castling).\n" +
      "7. After Black's move, give a brief 1-2 sentence explanation of why you chose that move.\n" +
      "8. If make_move fails, call get_legal_moves to see valid options, then pick and execute one.\n" +
      "9. Play principled chess: control the center, develop pieces, protect the king.";
  }

  if (activePluginId && pluginState !== null) {
    const pluginSchema = await getPluginSchema(activePluginId);
    const pluginName = pluginSchema?.name ?? activePluginId;
    systemMessage +=
      `\n\nCurrent ${pluginName} state: ${JSON.stringify(pluginState, null, 2)}`;

    // Teach Me Mode: inject chess-specific coaching prompt (Rule 12)
    if (
      activePluginId === "chess" &&
      (pluginState as Record<string, unknown>).teachMeMode === true
    ) {
      systemMessage +=
        "\n\nTEACH ME MODE IS ACTIVE. You are now acting as a dedicated chess instructor. " +
        "After every move (yours and the student's), proactively explain: (1) why this move was played or what it accomplishes, " +
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
