/**
 * Shared in-memory store for pending tool results.
 *
 * When the stream handler emits a `tool_invoke` SSE event it registers a
 * pending entry here.  The client's PluginBridge relays the plugin's
 * TOOL_RESULT message to POST /api/chat/tool-result, which resolves the
 * promise and unblocks the stream handler to continue the LLM loop.
 *
 * Entries are automatically cleaned up when the promise settles or when
 * the 10-second timeout fires.
 */

export interface PendingEntry {
  resolve: (result: unknown) => void;
  reject: (reason: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

export const pendingToolResults = new Map<string, PendingEntry>();

/**
 * Register a pending tool result and return a Promise that resolves when
 * the client delivers the result or rejects after `timeoutMs` milliseconds.
 */
export function waitForToolResult(
  toolCallId: string,
  timeoutMs: number,
): Promise<unknown> {
  return new Promise<unknown>((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingToolResults.delete(toolCallId);
      reject(new Error(`Tool call ${toolCallId} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    pendingToolResults.set(toolCallId, { resolve, reject, timeout });
  });
}
