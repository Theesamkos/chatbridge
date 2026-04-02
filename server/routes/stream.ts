import Ajv from "ajv";
import { nanoid } from "nanoid";
import type { Request, Response } from "express";
import { sdk } from "../_core/sdk";
import { invokeLLM, invokeLLMStream, type Message, type ToolCall } from "../_core/llm";
import { assembleContext } from "../contextAssembly";
import { createMessage, getConversationById, createPluginFailure } from "../db";
import { inspectInput, moderateWithLLM } from "../safety";
import { writeAuditLog } from "../auditLog";
import { waitForToolResult } from "./pendingToolResults";
import { circuitBreaker } from "../circuitBreaker";
import { rateLimiter } from "../rateLimiter";

const MAX_TOOL_CALLS = 3; // Rule 13
const TOOL_RESULT_TIMEOUT_MS = 10_000;

const ajv = new Ajv({ strict: false });

/**
 * Validate tool call arguments against the tool's JSON schema (Rule 14).
 * Returns the parsed args or null if invalid.
 */
function validateToolArgs(
  rawArguments: string,
  parametersSchema: Record<string, unknown>,
): Record<string, unknown> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawArguments);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return null;
  }
  const validate = ajv.compile(parametersSchema);
  return validate(parsed) ? (parsed as Record<string, unknown>) : null;
}

/**
 * POST /api/chat/stream
 *
 * Production SSE streaming endpoint (Decision 4, Phase 2+3).
 * Registered in server/_core/index.ts BEFORE the tRPC middleware.
 *
 * Auth:    JWT session cookie via sdk.authenticateRequest().
 * Body:    { conversationId: string, message: string }
 *
 * Event shape:
 *   { type: "token",       content: string }
 *   { type: "tool_invoke", toolName: string, toolCallId: string, arguments: object }
 *   { type: "tool_result", toolCallId: string, result: unknown }
 *   { type: "complete",    messageId: string }
 *   { type: "error",       message: string }
 */
export async function streamHandler(req: Request, res: Response): Promise<void> {
  const { conversationId, message } = req.body as {
    conversationId?: string;
    message?: string;
  };

  // ── 1. Input validation (synchronous — done before flushing headers) ────────

  if (!conversationId || typeof conversationId !== "string") {
    res.status(400).json({ error: "conversationId is required" });
    return;
  }
  if (!message || typeof message !== "string") {
    res.status(400).json({ error: "message is required" });
    return;
  }

  // Rule 2: inspect every user message before it reaches the LLM
  const inputCheck = inspectInput(message);
  if (!inputCheck.passed) {
    res.status(400).json({ error: "Message blocked", reason: inputCheck.reason });
    return;
  }

  // ── 2. SSE headers (Rule 16: flush immediately, before any async work) ──────

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no"); // prevents nginx/proxy buffering
  res.flushHeaders();

  const writeEvent = (data: object) => {
    if (res.writableEnded) return;
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  // Rule 18: AbortController for cancelling in-flight LLM streams on disconnect
  const abortController = new AbortController();

  // Rule 17: 15-second heartbeat so proxies don't drop idle connections
  const heartbeat = setInterval(() => {
    if (!res.writableEnded) res.write(": heartbeat\n\n");
  }, 15_000);

  const cleanup = () => {
    clearInterval(heartbeat);
    abortController.abort();
  };

  // Rule 17 + 18: clean up on client disconnect
  req.on("close", () => {
    cleanup();
    if (!res.writableEnded) res.end();
  });

  // ── 3. Authentication (async — after headers are flushed) ───────────────────

  let user: Awaited<ReturnType<typeof sdk.authenticateRequest>>;
  try {
    user = await sdk.authenticateRequest(req);
  } catch {
    writeEvent({ type: "error", message: "Authentication required" });
    cleanup();
    res.end();
    return;
  }

  // ── 3b. Rate limit check (Rule 27: 10 req/min/user) ────────────────────────

  const rateCheck = rateLimiter.check(`chat:${user.id}`, 10, 60_000);
  if (!rateCheck.allowed) {
    writeEvent({ type: "error", message: "Rate limit exceeded", code: "RATE_LIMITED", resetAt: rateCheck.resetAt });
    cleanup();
    res.end();
    return;
  }

  // ── 4. Conversation ownership check (Rule 31) ───────────────────────────────

  const conversation = await getConversationById(conversationId);
  if (!conversation || conversation.userId !== user.id) {
    writeEvent({ type: "error", message: "Conversation not found" });
    cleanup();
    res.end();
    return;
  }

  if (conversation.status === "frozen") {
    writeEvent({ type: "error", message: "Conversation is frozen" });
    cleanup();
    res.end();
    return;
  }

  // ── 5. Persist the user message ────────────────────────────────────────────

  const userMessageId = nanoid();
  await createMessage({
    id: userMessageId,
    conversationId,
    role: "user",
    content: message,
    moderationStatus: "passed",
  });

  // ── 6. Assemble context (Rule 15: never expose to client) ──────────────────

  let context: Awaited<ReturnType<typeof assembleContext>>;
  try {
    context = await assembleContext(conversationId, user.id);
  } catch (err) {
    console.error("[stream] Context assembly failed:", err);
    writeEvent({ type: "error", message: "Failed to prepare conversation context" });
    cleanup();
    res.end();
    return;
  }

  // Build the LLM messages array: system first, then history, then user turn
  const llmMessages: Message[] = [
    { role: "system", content: context.systemMessage },
    ...context.messages,
    { role: "user", content: message },
  ];

  const hasTools = context.tools && context.tools.length > 0;

  // ── 7. LLM invocation loop (with optional tool calls) ──────────────────────

  let fullResponse = "";
  let toolCallCount = 0;
  let assistantMessageId = nanoid();
  const toolNames: string[] = [];
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  try {
    // When tools are available, use non-streaming invokeLLM so we can inspect
    // tool_calls in the response.  When there are no tools, use the streaming
    // variant for a better UX.
    if (!hasTools) {
      const stream = invokeLLMStream(
        { messages: llmMessages },
        abortController.signal,
      );
      for await (const token of stream) {
        if (abortController.signal.aborted) break;
        fullResponse += token;
        writeEvent({ type: "token", content: token });
      }
      // Estimate token usage for the streaming path (no exact counts available)
      const inputChars = llmMessages.reduce((sum, m) => {
        const c = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
        return sum + c.length;
      }, 0);
      totalInputTokens  = Math.ceil(inputChars / 4);
      totalOutputTokens = Math.ceil(fullResponse.length / 4);
    } else {
      // Tool-capable loop
      while (true) {
        if (abortController.signal.aborted) break;

        const result = await invokeLLM({
          messages: llmMessages,
          tools: context.tools as never,
        });
        // Accumulate token usage from each invokeLLM call
        if (result.usage) {
          totalInputTokens  += result.usage.prompt_tokens     ?? 0;
          totalOutputTokens += result.usage.completion_tokens ?? 0;
        }

        const choice = result.choices[0];
        if (!choice) break;

        const rawContent = choice.message.content;
        const textContent =
          typeof rawContent === "string"
            ? rawContent
            : Array.isArray(rawContent)
              ? rawContent
                  .filter(p => p.type === "text")
                  .map(p => (p.type === "text" ? p.text : ""))
                  .join("")
              : "";

        // ── Tool call branch ───────────────────────────────────────────────
        if (
          choice.finish_reason === "tool_calls" &&
          choice.message.tool_calls &&
          choice.message.tool_calls.length > 0
        ) {
          // Emit any text that preceded the tool call
          if (textContent) {
            fullResponse += textContent;
            writeEvent({ type: "token", content: textContent });
          }

          // Add assistant message (with tool_calls) to history
          llmMessages.push({
            role: "assistant",
            content: textContent || "",
            tool_calls: choice.message.tool_calls,
          });

          // Process each tool call in order
          for (const toolCall of choice.message.tool_calls) {
            if (toolCallCount >= MAX_TOOL_CALLS) {
              // Rule 13: hard server-side limit
              writeEvent({ type: "error", message: "Tool call limit exceeded" });
              cleanup();
              if (!res.writableEnded) res.end();
              return;
            }
            toolCallCount++;

            // Rule 14: validate args against tool schema
            const toolSchema = (context.tools as Array<{
              type: string;
              function: { name: string; parameters: Record<string, unknown> };
            }>).find(t => t.function.name === toolCall.function.name);

            const args = toolSchema
              ? validateToolArgs(toolCall.function.arguments, toolSchema.function.parameters)
              : null;

            if (!args) {
              // Invalid args — reject tool call, continue loop with error result
              const errMsg = `Invalid arguments for tool ${toolCall.function.name}`;
              llmMessages.push({
                role: "tool",
                tool_call_id: toolCall.id,
                content: JSON.stringify({ error: errMsg }),
              });
              writeEvent({ type: "tool_result", toolCallId: toolCall.id, result: { error: errMsg } });
              continue;
            }

            toolNames.push(toolCall.function.name);

            // Circuit breaker check — skip tool if plugin is misbehaving
            const activePluginId = context.pluginId ?? "";
            if (activePluginId && circuitBreaker.isActive(activePluginId, conversationId)) {
              const cbMsg = `Circuit breaker active for plugin ${activePluginId}`;
              llmMessages.push({
                role: "tool",
                tool_call_id: toolCall.id,
                content: JSON.stringify({ error: cbMsg }),
              });
              writeEvent({ type: "tool_result", toolCallId: toolCall.id, result: { error: cbMsg } });
              continue;
            }

            // Persist tool_use message
            await createMessage({
              id: nanoid(),
              conversationId,
              role: "tool_use",
              content: JSON.stringify(args),
              toolName: toolCall.function.name,
              toolCallId: toolCall.id,
              moderationStatus: "passed",
            });

            // Emit tool_invoke event — client PluginBridge handles it
            writeEvent({
              type: "tool_invoke",
              toolName: toolCall.function.name,
              toolCallId: toolCall.id,
              arguments: args,
            });

            // Wait for client to POST /api/chat/tool-result
            let toolResult: unknown;
            try {
              toolResult = await waitForToolResult(toolCall.id, TOOL_RESULT_TIMEOUT_MS);
            } catch (timeoutErr) {
              // Record failure server-side and check circuit breaker
              if (activePluginId) {
                createPluginFailure({
                  id: nanoid(),
                  pluginId: activePluginId,
                  conversationId,
                  failureType: "timeout",
                  errorDetail: `Tool ${toolCall.function.name} timed out after ${TOOL_RESULT_TIMEOUT_MS}ms`,
                  resolved: false,
                }).catch(err => console.error("[stream] Failed to persist plugin failure:", err));

                const tripped = circuitBreaker.recordFailure(activePluginId, conversationId);
                if (tripped) {
                  writeAuditLog({
                    eventType: "CIRCUIT_OPEN",
                    userId: user.id,
                    conversationId,
                    pluginId: activePluginId,
                    payload: { reason: "tool_timeout", toolName: toolCall.function.name },
                    severity: "critical",
                  }).catch(err => console.error("[AuditLog]", err));
                }
              }

              writeEvent({ type: "error", message: "Tool call timed out", code: "TOOL_TIMEOUT" });
              cleanup();
              if (!res.writableEnded) res.end();
              return;
            }

            // Persist tool_result message
            await createMessage({
              id: nanoid(),
              conversationId,
              role: "tool_result",
              content: JSON.stringify(toolResult),
              toolCallId: toolCall.id,
              moderationStatus: "passed",
            });

            llmMessages.push({
              role: "tool",
              tool_call_id: toolCall.id,
              content: JSON.stringify(toolResult),
            });

            writeEvent({ type: "tool_result", toolCallId: toolCall.id, result: toolResult });
          }

          // Continue the loop to get the LLM's next response
          continue;
        }

        // ── Regular text response ──────────────────────────────────────────
        fullResponse += textContent;
        if (textContent) {
          writeEvent({ type: "token", content: textContent });
        }
        break;
      }
    }
  } catch (err: unknown) {
    if (abortController.signal.aborted) {
      // Normal disconnect — no error event needed
    } else {
      console.error("[stream] LLM error:", err);
      writeEvent({ type: "error", message: "LLM request failed" });
    }
    cleanup();
    if (!res.writableEnded) res.end();
    return;
  }

  if (abortController.signal.aborted) {
    cleanup();
    return;
  }

  // ── 8. Moderate and persist the assistant response ─────────────────────────

  const modResult = await moderateWithLLM(fullResponse, "output");
  const persistedContent =
    modResult.action === "block"
      ? "I'm sorry, I wasn't able to provide a response that meets our content guidelines."
      : (modResult.sanitized ?? fullResponse);

  const moderationStatus =
    modResult.action === "block"
      ? "blocked"
      : modResult.action === "sanitize"
        ? "flagged"
        : "passed";

  assistantMessageId = nanoid();
  try {
    await createMessage({
      id: assistantMessageId,
      conversationId,
      role: "assistant",
      content: persistedContent,
      moderationStatus,
    });
  } catch (err) {
    console.error("[stream] Failed to persist assistant message:", err);
  }

  // ── 9a. Token-usage audit log (for cost metrics — Rule 28) ─────────────────
  writeAuditLog({
    eventType: "llm_request_complete",
    userId: user.id,
    conversationId,
    pluginId: context.pluginId ?? undefined,
    payload: {
      inputTokens:  totalInputTokens,
      outputTokens: totalOutputTokens,
      model:        "claude-sonnet-4-5",
      pluginId:     context.pluginId ?? null,
      conversationId,
    },
    severity: "info",
  }).catch(err => console.error("[AuditLog]", err));

  // ── 9b. Audit log (Rule 28: log event types only, never raw content) ────────
  writeAuditLog({
    eventType: modResult.action === "block" ? "OUTPUT_FLAGGED" : "LLM_RESPONSE_COMPLETE",
    userId: user.id,
    conversationId,
    payload: {
      messageId: assistantMessageId,
      toolNames,
      toolCallCount,
      safetyFlags: {
        inputBlocked: false,
        outputFlagged: modResult.action !== "allow",
      },
    },
    severity: modResult.action === "block" ? "warning" : "info",
  }).catch(err => console.error("[AuditLog]", err));

  // ── 10. Send complete event and close ──────────────────────────────────────

  writeEvent({ type: "complete", messageId: assistantMessageId });
  cleanup();
  if (!res.writableEnded) res.end();
}
