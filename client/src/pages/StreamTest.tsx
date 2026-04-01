import { Button } from "@/components/ui/button";
import { useOptimistic, useState, useTransition } from "react";

type StreamEvent =
  | { type: "token"; content: string }
  | { type: "done"; messageId: number }
  | { type: "error"; code: string; message: string };

/**
 * /stream-test
 *
 * Browser verification page for the /api/stream SSE prototype.
 * Sends a test message and renders tokens as they arrive.
 * This page is for Phase 0 verification only and is not part of the
 * production chat interface.
 */
export default function StreamTest() {
  const [tokens, setTokens] = useState<string[]>([]);
  const [status, setStatus] = useState<"idle" | "streaming" | "done" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  // Rule 25: optimistic message display (here used to show the outgoing message immediately)
  const [optimisticMessage, addOptimistic] = useOptimistic<string | null, string>(
    null,
    (_prev, next) => next
  );

  const runStreamTest = async () => {
    const testMessage = "Hello from the stream test page!";
    addOptimistic(testMessage);
    setTokens([]);
    setErrorMsg(null);
    setStatus("streaming");

    try {
      const res = await fetch("/api/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: testMessage }),
      });

      if (!res.ok || !res.body) {
        throw new Error(`HTTP ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const raw = line.slice(6).trim();
          if (!raw) continue;

          const event = JSON.parse(raw) as StreamEvent;

          if (event.type === "token") {
            // Rule 24: use startTransition for history/token updates
            startTransition(() => {
              setTokens(prev => [...prev, event.content]);
            });
          } else if (event.type === "done") {
            setStatus("done");
          } else if (event.type === "error") {
            setErrorMsg(`${event.code}: ${event.message}`);
            setStatus("error");
          }
        }
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Unknown error");
      setStatus("error");
    }
  };

  return (
    <main className="min-h-screen p-8 max-w-2xl mx-auto">
      <h1 className="text-2xl font-semibold mb-2">SSE Stream Test</h1>
      <p className="text-sm text-muted-foreground mb-6">
        Phase 0 verification — confirms <code>/api/stream</code> delivers tokens to the browser.
      </p>

      {/* Rule 25: show the outgoing message immediately */}
      {optimisticMessage && (
        <div className="mb-4 text-sm text-muted-foreground">
          <span className="font-medium">Sent:</span> {optimisticMessage}
        </div>
      )}

      {/* Rule 37: aria-live region for streaming completion announcement */}
      <div aria-live="polite" aria-atomic="false" className="sr-only">
        {status === "done" ? "Stream complete" : ""}
      </div>

      <div
        className="min-h-24 p-4 rounded-md border bg-muted font-mono text-sm whitespace-pre-wrap mb-4"
        aria-label="Streamed output"
      >
        {tokens.length === 0 && status === "idle" && (
          <span className="text-muted-foreground">Output will appear here…</span>
        )}
        {tokens.join("")}
        {/* Rule 42: CSS-animated streaming cursor, no JS intervals */}
        {status === "streaming" && (
          <span className="streaming-cursor" aria-hidden="true" />
        )}
      </div>

      {status === "error" && (
        <p className="text-destructive text-sm mb-4">Error: {errorMsg}</p>
      )}

      {status === "done" && (
        <p className="text-green-600 dark:text-green-400 text-sm mb-4">
          ✓ Stream complete — {tokens.length} tokens received
        </p>
      )}

      {/* Rule 36: minimum 44×44px touch target via py-3 px-6 */}
      <Button
        onClick={runStreamTest}
        disabled={status === "streaming"}
        className="py-3 px-6 min-h-[44px]"
      >
        {status === "streaming" ? "Streaming…" : "Run Stream Test"}
      </Button>
    </main>
  );
}
