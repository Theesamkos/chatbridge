import type { Request, Response } from "express";
import { sdk } from "../_core/sdk";

/**
 * POST /api/stream
 *
 * SSE streaming endpoint. Registered in server/_core/index.ts BEFORE the
 * tRPC middleware (tRPC's response serialization is incompatible with
 * long-lived SSE connections — Decision 4).
 *
 * Auth: reads the JWT session cookie via sdk.authenticateRequest().
 * Body: { message: string }
 *
 * Event shape:
 *   { type: "token",  content: string }
 *   { type: "done",   messageId: number }
 *   { type: "error",  code: string, message: string }
 */
export async function streamHandler(req: Request, res: Response): Promise<void> {
  // Rule 16: flush headers immediately — before any async work — so the
  // client receives HTTP 200 and starts reading before auth even completes.
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no"); // prevents nginx/proxy buffering
  res.flushHeaders();

  // Auth: same JWT cookie mechanism used by tRPC context.
  try {
    await sdk.authenticateRequest(req);
  } catch {
    res.write(
      `data: ${JSON.stringify({ type: "error", code: "UNAUTHORIZED", message: "Invalid session" })}\n\n`
    );
    res.end();
    return;
  }

  const writeEvent = (data: object) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  // Rule 18: AbortController for cancelling in-flight LLM streams on disconnect.
  const abortController = new AbortController();

  // Rule 17: 15-second heartbeat to keep proxies/load balancers from dropping
  // idle connections between token bursts.
  const heartbeat = setInterval(() => {
    res.write(": heartbeat\n\n");
  }, 15_000);

  // Rule 17 + 18: clean up on client disconnect.
  req.on("close", () => {
    clearInterval(heartbeat);
    abortController.abort();
    res.end();
  });

  // TODO Phase 2: replace with real invokeLLMStream() call and tool-use loop.
  // Pass abortController.signal to the stream so it cancels on disconnect.
  // This prototype verifies SSE delivery, headers, heartbeat, and abort wiring
  // are all correct before feature code is added.
  const { message = "" } = req.body as { message?: string };
  const tokens = `Hello! You said: "${message}". Stream confirmed.`.split(" ");

  for (const token of tokens) {
    if (abortController.signal.aborted) break;
    writeEvent({ type: "token", content: token + " " });
    // Simulate token-by-token delivery with a small delay
    await new Promise(r => setTimeout(r, 80));
  }

  if (!abortController.signal.aborted) {
    writeEvent({ type: "done", messageId: 0 });
  }

  clearInterval(heartbeat);
  res.end();
}
