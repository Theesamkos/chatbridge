/**
 * PluginContainer — sandboxed iframe host for plugin apps.
 *
 * Security invariants (all enforced here):
 *  - Rule 1:  sandbox is exactly "allow-scripts allow-forms allow-popups" — never allow-same-origin.
 *  - Rule 20: credentialless attribute prevents cookie/storage inheritance.
 *  - Rule 22: CSP frame-src is set server-side; the iframe src must match.
 *  - Rule 26: wrapped in <Suspense> + <ErrorBoundary> by the caller.
 *  - Rule 39: descriptive title attribute on every iframe.
 *
 * Lifecycle state machine:
 *   loading → ready     (PLUGIN_READY received within PLUGIN_READY_TIMEOUT_MS)
 *   loading → error     (timeout or fatal error before PLUGIN_READY)
 *   ready   → active    (first tool invocation or STATE_UPDATE received)
 *   active  → complete  (PLUGIN_COMPLETE received)
 *   active  → error     (fatal PLUGIN_ERROR received)
 *   ready   → error     (fatal PLUGIN_ERROR received)
 *
 * Exposes `sendToolInvoke(toolCallId, toolName, args)` via forwardRef so the
 * parent Chat page can forward SSE tool_invoke events into the iframe.
 */

import { forwardRef, useEffect, useImperativeHandle, useRef, useState, startTransition } from "react";
import { trpc } from "@/lib/trpc";
import { PluginBridge } from "@/lib/PluginBridge";
import type { PluginSchema } from "../../../drizzle/schema";
import { Loader2, AlertTriangle, CheckCircle2, Zap, RefreshCw, ShieldAlert, Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { PluginLifecycleState } from "../../../shared/pluginTypes";

// Extended lifecycle states beyond the shared protocol (UI-only states)
type ExtendedLifecycleState = PluginLifecycleState | "frozen" | "circuit_open";

const PLUGIN_READY_TIMEOUT_MS = 15_000;

export interface PluginContainerHandle {
  /** Forward a server-emitted tool_invoke event into the iframe and await the result. */
  sendToolInvoke(
    toolCallId: string,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<unknown>;
}

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

// ─── Status pill ─────────────────────────────────────────────────────────────

function StatusPill({ state }: { state: ExtendedLifecycleState }) {
  const config: Record<ExtendedLifecycleState, { label: string; className: string; icon: React.ReactNode }> = {
    loading: {
      label: "Loading",
      className: "bg-muted/60 text-muted-foreground border-border/40",
      icon: <Loader2 className="h-2.5 w-2.5 animate-spin" />,
    },
    ready: {
      label: "Ready",
      className: "bg-amber-500/10 text-amber-600 border-amber-500/20",
      icon: <span className="h-2 w-2 rounded-full bg-amber-500 animate-pulse" />,
    },
    active: {
      label: "Active",
      className: "bg-primary/10 text-primary border-primary/20",
      icon: <Zap className="h-2.5 w-2.5" />,
    },
    complete: {
      label: "Complete",
      className: "bg-amber-500/10 text-amber-700 border-amber-500/20",
      icon: <CheckCircle2 className="h-2.5 w-2.5" />,
    },
    error: {
      label: "Error",
      className: "bg-destructive/10 text-destructive border-destructive/20",
      icon: <AlertTriangle className="h-2.5 w-2.5" />,
    },
    disabled: {
      label: "Disabled",
      className: "bg-muted/40 text-muted-foreground/60 border-border/30",
      icon: null,
    },
    frozen: {
      label: "Frozen",
      className: "bg-amber-500/10 text-amber-600 border-amber-500/30",
      icon: <Lock className="h-2.5 w-2.5" />,
    },
    circuit_open: {
      label: "Paused",
      className: "bg-destructive/10 text-destructive border-destructive/20",
      icon: <ShieldAlert className="h-2.5 w-2.5" />,
    },
  };

  const { label, className, icon } = config[state];

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium leading-none transition-all duration-300",
        className,
      )}
    >
      {icon}
      {label}
    </span>
  );
}

// ─── PluginContainer ─────────────────────────────────────────────────────────

const PluginContainer = forwardRef<PluginContainerHandle, PluginContainerProps>(
  function PluginContainer(
    { conversationId, pluginId, sessionId, schema, restoredState, onComplete, onError },
    ref,
  ) {
    const iframeRef = useRef<HTMLIFrameElement>(null);
    const bridgeRef = useRef<PluginBridge | null>(null);
    // Use a ref to track loading state for the timeout callback (avoids stale closure)
    const isLoadingRef = useRef(true);

    const [lifecycleState, setLifecycleState] = useState<ExtendedLifecycleState>("loading");
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [completeSummary, setCompleteSummary] = useState<string | null>(null);
    const [retryKey, setRetryKey] = useState(0);

    const updateStateMutation = trpc.plugins.updateState.useMutation();

    // Expose sendToolInvoke to parent via ref
    useImperativeHandle(ref, () => ({
      sendToolInvoke(toolCallId, toolName, args) {
        const bridge = bridgeRef.current;
        if (!bridge) return Promise.reject(new Error("PluginBridge not ready"));
        // Transition to active state when a tool is invoked
        setLifecycleState(prev => (prev === "ready" || prev === "active") ? "active" : prev);
        return bridge.sendToolInvoke(toolCallId, toolName, args).catch((err: Error) => {
          // If the server returns a 429 (circuit breaker) or 403 (frozen), surface it
          const msg = err.message ?? "";
          if (msg.includes("circuit") || msg.includes("breaker")) {
            setLifecycleState("circuit_open");
            setErrorMessage("Too many errors detected. This plugin has been temporarily paused for safety.");
          } else if (msg.includes("frozen") || msg.includes("Conversation is frozen")) {
            setLifecycleState("frozen");
            setErrorMessage("This session has been frozen by a safety check. Please contact your teacher.");
          }
          throw err;
        });
      },
    }));

    useEffect(() => {
      const iframe = iframeRef.current;
      if (!iframe) return;

      let readyTimeout: ReturnType<typeof setTimeout>;
      let destroyed = false;

      setLifecycleState("loading");
      setErrorMessage(null);
      setCompleteSummary(null);
      isLoadingRef.current = true;

      // For self-hosted plugins (iframeUrl starts with /), the origin is always
      // the current window's origin — not the DB-stored localhost value.
      const effectiveOrigin = schema.iframeUrl.startsWith("/")
        ? window.location.origin
        : schema.origin;

      const bridge = new PluginBridge({
        iframe,
        pluginId,
        conversationId,
        registeredOrigin: effectiveOrigin,
        sessionId,
        callbacks: {
          onReady() {
            clearTimeout(readyTimeout);
            isLoadingRef.current = false;
            if (!destroyed) setLifecycleState("ready");
          },
          onStateUpdate(state, _partial) {
            // Transition to active on first state update
            if (!destroyed) setLifecycleState(prev => prev === "ready" ? "active" : prev);
            // Persist state update via tRPC
            startTransition(() => {
              updateStateMutation.mutate({
                conversationId,
                pluginId,
                state: state as Record<string, unknown>,
              });
            });
          },
          onComplete(finalState, summary) {
            if (!destroyed) {
              setLifecycleState("complete");
              setCompleteSummary(summary);
            }
            onComplete?.(finalState, summary);
          },
          onError(error, fatal) {
            if (!destroyed) {
              // Detect circuit breaker / frozen signals in the error message
              if (error.includes("circuit") || error.includes("breaker")) {
                setLifecycleState("circuit_open");
                setErrorMessage("Too many errors detected. This plugin has been temporarily paused for safety.");
              } else if (error.includes("frozen")) {
                setLifecycleState("frozen");
                setErrorMessage("This session has been frozen by a safety check. Please contact your teacher.");
              } else if (fatal) {
                setLifecycleState("error");
                setErrorMessage(error);
              }
              if (fatal) onError?.(error);
            }
          },
        },
      });

      bridgeRef.current = bridge;

      // 5-second timeout waiting for PLUGIN_READY
      // Use isLoadingRef (not lifecycleState) to avoid stale closure
      readyTimeout = setTimeout(() => {
        if (!destroyed && isLoadingRef.current) {
          isLoadingRef.current = false;
          setLifecycleState("error");
          setErrorMessage("Plugin did not respond within 15 seconds. It may be loading slowly or unavailable.");
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
    }, [pluginId, conversationId, sessionId, schema.origin, retryKey]);

    const handleRetry = () => {
      setRetryKey(k => k + 1);
    };

    return (
      <div className="relative flex h-full w-full flex-col overflow-hidden">
        {/* Status pill — top-right corner, always visible */}
        <div className="absolute top-2 right-2 z-20 pointer-events-none">
          <StatusPill state={lifecycleState} />
        </div>

        {/* Loading overlay — animated fade-in */}
        {lifecycleState === "loading" && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-background/90 backdrop-blur-sm transition-opacity duration-300">
            <div className="relative">
              <div className="h-12 w-12 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
              </div>
            </div>
            <div className="text-center">
              <p className="text-sm font-medium">Loading {schema.name}…</p>
              <p className="text-xs text-muted-foreground mt-0.5">Setting up your learning environment</p>
            </div>
          </div>
        )}

        {/* Frozen overlay — session locked by safety system */}
        {lifecycleState === "frozen" && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 bg-background/97 backdrop-blur-sm p-6 text-center">
            <div className="h-14 w-14 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center">
              <Lock className="h-7 w-7 text-amber-600" />
            </div>
            <div>
              <p className="font-semibold text-sm text-amber-600">Session Frozen</p>
              <p className="text-xs text-muted-foreground mt-1 max-w-xs leading-relaxed">
                {errorMessage ?? "This session has been frozen. Please contact your teacher for assistance."}
              </p>
            </div>
          </div>
        )}

        {/* Circuit breaker overlay — too many plugin errors */}
        {lifecycleState === "circuit_open" && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 bg-background/97 backdrop-blur-sm p-6 text-center">
            <div className="h-14 w-14 rounded-2xl bg-destructive/10 border border-destructive/20 flex items-center justify-center">
              <ShieldAlert className="h-7 w-7 text-destructive" />
            </div>
            <div>
              <p className="font-semibold text-sm text-destructive">Plugin Paused</p>
              <p className="text-xs text-muted-foreground mt-1 max-w-xs leading-relaxed">
                {errorMessage ?? "Too many errors were detected. This plugin has been temporarily paused."}
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5 text-xs"
              onClick={handleRetry}
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Try Again
            </Button>
          </div>
        )}

        {/* Complete overlay — shown briefly after PLUGIN_COMPLETE */}
        {lifecycleState === "complete" && completeSummary && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 bg-background/95 backdrop-blur-sm p-6 text-center">
            <div className="h-14 w-14 rounded-2xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center">
              <CheckCircle2 className="h-7 w-7 text-blue-600" />
            </div>
            <div>
              <p className="font-semibold text-sm">Session Complete</p>
              <p className="text-xs text-muted-foreground mt-1 max-w-xs leading-relaxed">{completeSummary}</p>
            </div>
          </div>
        )}

        {/* Error state — with retry button */}
        {lifecycleState === "error" && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 p-6 text-center bg-background/95 backdrop-blur-sm">
            <div className="h-14 w-14 rounded-2xl bg-destructive/10 border border-destructive/20 flex items-center justify-center">
              <AlertTriangle className="h-7 w-7 text-destructive" />
            </div>
            <div>
              <p className="font-semibold text-sm text-destructive">Plugin Error</p>
              {errorMessage && (
                <p className="text-xs text-muted-foreground mt-1 max-w-xs leading-relaxed">{errorMessage}</p>
              )}
            </div>
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5 text-xs"
              onClick={handleRetry}
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Retry
            </Button>
          </div>
        )}

        {/* Plugin iframe — security rules applied here */}
        <iframe
          key={retryKey}
          ref={iframeRef}
          src={schema.iframeUrl}
          // Rule 1: exact sandbox — never add allow-same-origin
          sandbox="allow-scripts allow-forms allow-popups"
          // Rule 20: credentialless prevents cookie/storage inheritance
          {...({ credentialless: "" } as Record<string, unknown>)}
          // Rule 39: descriptive title for screen readers
          title={`${schema.name} learning activity`}
          className={cn(
            "h-full w-full border-0 transition-opacity duration-300",
            lifecycleState === "loading" ? "opacity-0" : "opacity-100",
            lifecycleState === "error" ? "hidden" : "",
          )}
        />
      </div>
    );
  },
);

export default PluginContainer;
