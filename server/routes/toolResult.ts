import type { Request, Response } from "express";
import { nanoid } from "nanoid";
import { sdk } from "../_core/sdk";
import { getConversationById } from "../db";
import { pendingToolResults } from "./pendingToolResults";
import { inspectStateForInjection } from "../pluginStateSchemas";
import { writeAuditLog } from "../auditLog";

/**
 * POST /api/chat/tool-result
 *
 * Receives the result of a tool call from the client's PluginBridge and
 * resolves the pending promise in the SSE stream handler so generation can
 * continue.
 *
 * Body: { toolCallId: string; conversationId: string; result: unknown; isError?: boolean }
 */
export async function toolResultHandler(req: Request, res: Response): Promise<void> {
  const { toolCallId, conversationId, result, isError } = req.body as {
    toolCallId?: string;
    conversationId?: string;
    result?: unknown;
    isError?: boolean;
  };

  if (!toolCallId || typeof toolCallId !== "string") {
    res.status(400).json({ error: "toolCallId is required" });
    return;
  }
  if (!conversationId || typeof conversationId !== "string") {
    res.status(400).json({ error: "conversationId is required" });
    return;
  }

  // Auth check — caller must own the conversation
  let user: Awaited<ReturnType<typeof sdk.authenticateRequest>>;
  try {
    user = await sdk.authenticateRequest(req);
  } catch {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const conversation = await getConversationById(conversationId);
  if (!conversation || conversation.userId !== user.id) {
    res.status(403).json({ error: "Conversation not found" });
    return;
  }

  const pending = pendingToolResults.get(toolCallId);
  if (!pending) {
    // Already timed out or unknown — return 404 so client knows
    res.status(404).json({ error: "No pending tool call with that id" });
    return;
  }

  // Phase 6: inspect tool result for injection patterns before it enters the LLM loop
  if (!isError && result !== undefined && result !== null) {
    const injectionCheck = inspectStateForInjection(result);
    if (!injectionCheck.clean) {
      writeAuditLog({
        eventType: "TOOL_RESULT_INJECTION_ATTEMPT",
        userId: user.id,
        conversationId,
        payload: { toolCallId, reason: injectionCheck.reason },
        severity: "critical",
      }).catch(err => console.error("[AuditLog]", err));

      clearTimeout(pending.timeout);
      pendingToolResults.delete(toolCallId);
      pending.reject(new Error("Tool result blocked: prohibited content detected"));
      res.status(400).json({ error: "Tool result blocked", code: "INJECTION_DETECTED" });
      return;
    }

    // Enforce a maximum payload size (64 KB) to prevent oversized injection
    const resultSize = JSON.stringify(result).length;
    if (resultSize > 65_536) {
      writeAuditLog({
        eventType: "TOOL_RESULT_OVERSIZED",
        userId: user.id,
        conversationId,
        payload: { toolCallId, sizeBytes: resultSize },
        severity: "warning",
      }).catch(err => console.error("[AuditLog]", err));

      clearTimeout(pending.timeout);
      pendingToolResults.delete(toolCallId);
      pending.reject(new Error("Tool result blocked: payload too large"));
      res.status(413).json({ error: "Tool result too large", code: "PAYLOAD_TOO_LARGE" });
      return;
    }
  }

  clearTimeout(pending.timeout);
  pendingToolResults.delete(toolCallId);

  if (isError) {
    pending.reject(new Error(typeof result === "string" ? result : "Tool call failed"));
  } else {
    pending.resolve(result);
  }

  res.json({ ok: true });
}
