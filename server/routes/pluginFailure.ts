/**
 * POST /api/plugins/failure
 *
 * Called by PluginBridge (client) when a tool invocation times out or
 * the plugin iframe crashes.  Persists a plugin_failures record, increments
 * the circuit breaker counter, and writes a critical audit log if the breaker
 * just tripped.
 */
import { nanoid } from "nanoid";
import type { Request, Response } from "express";
import { sdk } from "../_core/sdk";
import { createPluginFailure } from "../db";
import { circuitBreaker } from "../circuitBreaker";
import { writeAuditLog } from "../auditLog";

export async function pluginFailureHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const { pluginId, conversationId, failureType, errorDetail } = req.body as {
    pluginId?: string;
    conversationId?: string;
    failureType?: string;
    errorDetail?: string;
  };

  if (!pluginId || !conversationId || !failureType) {
    res.status(400).json({ error: "pluginId, conversationId, and failureType are required" });
    return;
  }

  // Best-effort auth — non-critical; we log the failure regardless
  let userId: number | undefined;
  try {
    const user = await sdk.authenticateRequest(req);
    userId = user.id;
  } catch {
    // proceed without userId
  }

  // Persist failure record (fire-and-forget style — never block the response)
  createPluginFailure({
    id: nanoid(),
    pluginId,
    conversationId,
    failureType: failureType as "timeout" | "load_failure" | "invalid_origin" | "malformed_state" | "tool_error" | "circuit_breaker",
    errorDetail: errorDetail ?? "No detail provided",
    resolved: false,
  }).catch(err => console.error("[PluginFailure] DB write failed:", err));

  // Increment circuit breaker; write critical audit log if just activated
  const justActivated = circuitBreaker.recordFailure(pluginId, conversationId);

  if (justActivated) {
    writeAuditLog({
      eventType: "CIRCUIT_OPEN",
      userId,
      conversationId,
      pluginId,
      payload: {
        failureType: failureType ?? "unknown",
        errorDetail: errorDetail ?? "",
        triggeredBy: "pluginFailure",
      },
      severity: "critical",
    }).catch(err => console.error("[AuditLog]", err));
  }

  const isActive = circuitBreaker.isActive(pluginId, conversationId);
  res.json({ success: true, circuitBreakerActive: justActivated || isActive });
}
