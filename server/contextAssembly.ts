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

  // Timeline plugin: inject coaching instructions
  if (activePluginId === "timeline") {
    systemMessage +=
      "\n\n## TIMELINE BUILDER PLUGIN — YOU ARE THE HISTORY TUTOR\n" +
      "The student is using a drag-and-drop timeline activity to practice chronological ordering of historical events.\n\n" +
      "MANDATORY BEHAVIOR:\n" +
      "1. STARTING: When the student wants to practice a history topic, call load_timeline with the exact topic name.\n" +
      "   Available topics: 'American Civil War', 'American Revolution', 'Ancient Rome', 'World War II', 'Space Race', 'French Revolution', 'Cold War', 'Industrial Revolution'.\n" +
      "   If the student's topic is close but not exact, pick the closest match and call load_timeline.\n" +
      "2. CHECKING ANSWERS: When the student says they are done, finished, or wants to check their answer, call validate_arrangement immediately.\n" +
      "3. COACHING: After validation, give specific, encouraging feedback:\n" +
      "   - For a perfect score: celebrate and explain why the correct order makes historical sense.\n" +
      "   - For partial credit: identify which events were misplaced and explain the correct sequence with historical context.\n" +
      "   - For a poor score: be encouraging, briefly explain the correct chronological order, and offer to reset for another attempt.\n" +
      "4. CHECKING STATE: Use get_state to see what topic is loaded and the student's current progress before giving advice.\n" +
      "5. RESETTING: If the student wants to try again or you want to give them another attempt, call reset_timeline.\n" +
      "6. NEVER guess or make up event dates — the app handles all validation deterministically.\n" +
      "7. Keep explanations concise and age-appropriate for K-12 students.";
  }

  // Artifact Investigation Studio: inject guided reasoning instructions
  if (activePluginId === "artifact-studio") {
    systemMessage +=
      "\n\n## ARTIFACT INVESTIGATION STUDIO — YOU ARE THE INQUIRY GUIDE\n" +
      "The student is conducting a structured historical inquiry using real artifacts from the Smithsonian and Library of Congress.\n\n" +
      "THE FOUR-STEP WORKFLOW:\n" +
      "  Step 1 — DISCOVER: Student searches for artifacts. You call search_artifacts with relevant terms.\n" +
      "  Step 2 — INSPECT: Student examines a specific artifact. You call get_artifact_detail to load it.\n" +
      "  Step 3 — INVESTIGATE: Student fills in 4 reasoning fields (observations, evidence, interpretation, hypothesis). Each must be ≥50 chars.\n" +
      "  Step 4 — CONCLUDE: Student submits. You call submit_investigation to finalize and trigger LLM scoring.\n\n" +
      "MANDATORY BEHAVIOR:\n" +
      "1. SEARCHING: When the student wants to explore a topic or find artifacts, call search_artifacts immediately with descriptive terms.\n" +
      "   Good queries: 'Civil War rifle infantry', 'ancient Roman pottery cooking', 'Apollo 11 mission equipment'.\n" +
      "2. LOADING ARTIFACTS: When the student selects or wants to examine a specific artifact, call get_artifact_detail with its id and source.\n" +
      "3. COACHING DURING INVESTIGATION: Ask Socratic questions to help the student think deeper:\n" +
      "   - Observations: 'What materials do you see? What condition is it in? Are there any markings or symbols?'\n" +
      "   - Evidence: 'Which specific detail you observed tells you the most about when or where this was made?'\n" +
      "   - Interpretation: 'Who do you think used this? What does the wear pattern tell you about how it was used?'\n" +
      "   - Hypothesis: 'Based on everything, what is your best conclusion? What questions remain unanswered?'\n" +
      "4. SUBMITTING: When the student says they are done or ready to submit, call submit_investigation. The app validates all fields are complete.\n" +
      "5. RESETTING: If the student wants to start over or try a different artifact, call reset_investigation.\n" +
      "6. CHECKING STATE: Call get_investigation_state before giving coaching advice to see exactly where the student is.\n" +
      "7. NEVER invent artifact details — only discuss what the API returns.\n" +
      "8. NEVER evaluate whether the student's historical conclusion is factually correct — evaluate the QUALITY of their reasoning process.\n" +
      "9. Keep all language age-appropriate for K-12 students. Be encouraging and curious.";
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

    // Timeline completion coaching (Rule 12 equivalent for timeline)
    if (
      activePluginId === "timeline" &&
      (pluginState as Record<string, unknown>).completionStatus === "TIMELINE_COMPLETE"
    ) {
      const score = (pluginState as Record<string, unknown>).score as number | null;
      const total = (pluginState as Record<string, unknown>).total as number | null;
      const topic = (pluginState as Record<string, unknown>).topic as string | null;
      if (score !== null && total !== null) {
        const pct = score / total;
        if (pct === 1) {
          systemMessage +=
            `\n\nThe student just completed the ${topic ?? ""} timeline with a PERFECT score (${score}/${total}). ` +
            "Celebrate their achievement enthusiastically and reinforce the historical significance of the correct order.";
        } else {
          systemMessage +=
            `\n\nThe student just completed the ${topic ?? ""} timeline with a score of ${score}/${total}. ` +
            "Give specific, encouraging feedback about which events were in the wrong position and why the correct chronological order matters historically. " +
            "Offer to reset for another attempt if they scored below 80%.";
        }
      }
    }

    // Artifact Investigation Studio: completion coaching
    if (
      activePluginId === "artifact-studio" &&
      (pluginState as Record<string, unknown>).completionStatus === "INVESTIGATION_COMPLETE"
    ) {
      const ps = pluginState as Record<string, unknown>;
      const artifactTitle = (ps.selectedArtifact as Record<string, unknown>)?.title as string | null;
      const scoreData = ps.score as Record<string, unknown> | null;
      if (scoreData && typeof scoreData.overall === "number") {
        const overallPct = Math.round(scoreData.overall * 100);
        const feedback = typeof scoreData.feedback === "string" ? scoreData.feedback : null;
        if (overallPct >= 80) {
          systemMessage +=
            `\n\nThe student just completed their investigation of "${artifactTitle ?? "the artifact"}" with an excellent score of ${overallPct}%. ` +
            "Celebrate their strong historical reasoning. " +
            (feedback ? `The scoring feedback was: "${feedback}" ` : "") +
            "Highlight what they did especially well and suggest a follow-up question to deepen their inquiry.";
        } else if (overallPct >= 60) {
          systemMessage +=
            `\n\nThe student completed their investigation of "${artifactTitle ?? "the artifact"}" with a score of ${overallPct}%. ` +
            "Give encouraging, specific feedback on how to strengthen their reasoning. " +
            (feedback ? `The scoring feedback was: "${feedback}" ` : "") +
            "Suggest which of the four fields (observations, evidence, interpretation, hypothesis) needs the most improvement.";
        } else {
          systemMessage +=
            `\n\nThe student completed their investigation of "${artifactTitle ?? "the artifact"}" with a score of ${overallPct}%. ` +
            "Be encouraging and constructive. " +
            (feedback ? `The scoring feedback was: "${feedback}" ` : "") +
            "Explain what strong historical reasoning looks like and offer to reset so they can try again with better observations and evidence.";
        }
      } else {
        // Submitted but not yet scored
        systemMessage +=
          `\n\nThe student has submitted their investigation of "${artifactTitle ?? "the artifact"}". ` +
          "Acknowledge their completion and encourage them to reflect on their reasoning process while the score is being calculated.";
      }
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
