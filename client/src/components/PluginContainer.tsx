/**
 * PluginContainer — sandboxed iframe host for plugin apps (Task 3.2, Phase 3).
 *
 * Security invariants (all enforced here):
 *  - Rule 1:  sandbox is exactly "allow-scripts allow-forms allow-popups" — never allow-same-origin.
 *  - Rule 20: credentialless attribute prevents cookie/storage inheritance.
 *  - Rule 22: CSP frame-src is set server-side; the iframe src must match.
 *  - Rule 26: wrapped in <Suspense> + <ErrorBoundary> by the caller.
 *  - Rule 39: descriptive title attribute on every iframe.
 */

import { useEffect, useRef, useState, startTransition } from "react";
import { trpc } from "@/lib/trpc";
import { PluginBridge } from "@/lib/PluginBridge";
import type { PluginSchema } from "../../../drizzle/schema";
import { Loader2, AlertTriangle } from "lucide-react";

const PLUGIN_READY_TIMEOUT_MS = 5_000;

interface PluginContainerProps {
  conversationId: string;
  pluginId: string;
  sessionId: string;
  schema: PluginSchema;
  restoredState: unknown;
  /** Called when the plugin sends PLUGIN_COMPLETE. */
  onComplete?: (finalState: unknown, summary: string) => void;
  /** Called when the plugin sends a fatal PLUGIN_ERROR. */
  onError?: (error: string) => void;
}

export default function PluginContainer({
  conversationId,
  pluginId,
  sessionId,
  schema,
  restoredState,
  onComplete,
  onError,
}: PluginContainerProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const bridgeRef = useRef<PluginBridge | null>(null);

  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const updateStateMutation = trpc.plugins.updateState.useMutation();

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    let readyTimeout: ReturnType<typeof setTimeout>;
    let destroyed = false;

    const bridge = new PluginBridge({
      iframe,
      pluginId,
      conversationId,
      registeredOrigin: schema.origin,
      sessionId,
      callbacks: {
        onReady() {
          clearTimeout(readyTimeout);
          setStatus("ready");
        },
        onStateUpdate(state, _partial) {
          // Persist state update via tRPC (Rule 24: wrap in startTransition)
          startTransition(() => {
            updateStateMutation.mutate({
              conversationId,
              pluginId,
              state: state as Record<string, unknown>,
            });
          });
        },
        onComplete(finalState, summary) {
          onComplete?.(finalState, summary);
        },
        onError(error, fatal) {
          if (fatal) {
            setStatus("error");
            setErrorMessage(error);
            onError?.(error);
          }
        },
      },
    });

    bridgeRef.current = bridge;

    // 5-second timeout waiting for PLUGIN_READY
    readyTimeout = setTimeout(() => {
      if (!destroyed && status === "loading") {
        setStatus("error");
        setErrorMessage("Plugin did not respond in time.");
      }
    }, PLUGIN_READY_TIMEOUT_MS);

    // Send INIT once iframe loads
    const handleLoad = () => {
      bridge.sendInit(restoredState);
    };
    iframe.addEventListener("load", handleLoad);

    return () => {
      destroyed = true;
      clearTimeout(readyTimeout);
      iframe.removeEventListener("load", handleLoad);
      bridge.destroy();
      bridgeRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pluginId, conversationId, sessionId, schema.origin]);

  return (
    <div className="relative flex h-full w-full flex-col">
      {/* Loading overlay */}
      {status === "loading" && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/80">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {/* Error state (Rule 26: stays within the plugin pane) */}
      {status === "error" && (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center text-sm text-muted-foreground">
          <AlertTriangle className="size-8 text-destructive" />
          <p className="font-medium text-destructive">Plugin failed to load</p>
          {errorMessage && <p className="text-xs">{errorMessage}</p>}
        </div>
      )}

      {/* Plugin iframe — security rules applied here */}
      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
      <iframe
        ref={iframeRef}
        src={schema.iframeUrl}
        // Rule 1: exact sandbox — never add allow-same-origin
        sandbox="allow-scripts allow-forms allow-popups"
        // Rule 20: credentialless prevents cookie/storage inheritance (cast: not yet in @types/react)
        {...({ credentialless: true } as Record<string, unknown>)}
        // Rule 39: descriptive title for screen readers
        title={`${schema.name} learning activity`}
        className="h-full w-full border-0"
        style={{ display: status === "error" ? "none" : "block" }}
      />
    </div>
  );
}
