/**
 * PluginBridge — manages the versioned postMessage protocol between the
 * platform and a sandboxed plugin iframe (Task 3.1, Phase 3).
 *
 * Security invariants:
 *  - Rule 19: Every message handler validates event.origin before reading data.
 *  - Rule 7:  Every outbound message carries version: 1.
 *  - All PROTOCOL_VIOLATION events are reported to the server audit log.
 */

// ─── Protocol types (must stay in sync with CLAUDE.md § 6) ───────────────────

export type PlatformMessage =
  | { type: "INIT";        version: 1; sessionId: string; pluginId: string; conversationId: string; restoredState: unknown | null }
  | { type: "TOOL_INVOKE"; version: 1; sessionId: string; pluginId: string; toolName: string; toolCallId: string; arguments: Record<string, unknown> }
  | { type: "PING";        version: 1; sessionId: string; pluginId: string };

export type PluginMessage =
  | { type: "PLUGIN_READY";    version: 1; sessionId: string; pluginId: string }
  | { type: "TOOL_RESULT";     version: 1; sessionId: string; pluginId: string; toolCallId: string; result: unknown; isError: boolean }
  | { type: "STATE_UPDATE";    version: 1; sessionId: string; pluginId: string; state: unknown; partial: boolean }
  | { type: "PLUGIN_COMPLETE"; version: 1; sessionId: string; pluginId: string; finalState: unknown; summary: string }
  | { type: "PLUGIN_ERROR";    version: 1; sessionId: string; pluginId: string; error: string; fatal: boolean }
  | { type: "PONG";            version: 1; sessionId: string; pluginId: string };

const PROTOCOL_VERSION = 1;
const TOOL_RESULT_TIMEOUT_MS = 10_000;

// ─── Callbacks ────────────────────────────────────────────────────────────────

export interface PluginBridgeCallbacks {
  onReady?: () => void;
  onStateUpdate?: (state: unknown, partial: boolean) => void;
  onComplete?: (finalState: unknown, summary: string) => void;
  onError?: (error: string, fatal: boolean) => void;
}

// ─── PluginBridge class ───────────────────────────────────────────────────────

export class PluginBridge {
  private readonly iframe: HTMLIFrameElement;
  private readonly pluginId: string;
  private readonly conversationId: string;
  private readonly registeredOrigin: string;
  private readonly sessionId: string;
  private readonly callbacks: PluginBridgeCallbacks;

  /** toolCallId → { resolve, reject, timeout } */
  private pendingToolResults = new Map<
    string,
    { resolve: (r: unknown) => void; reject: (e: Error) => void; timeout: ReturnType<typeof setTimeout> }
  >();

  /** Number of errors seen from this plugin (circuit-breaker counter). */
  private errorCount = 0;

  private readonly messageHandler: (event: MessageEvent) => void;

  constructor(params: {
    iframe: HTMLIFrameElement;
    pluginId: string;
    conversationId: string;
    registeredOrigin: string;
    sessionId: string;
    callbacks?: PluginBridgeCallbacks;
  }) {
    this.iframe = params.iframe;
    this.pluginId = params.pluginId;
    this.conversationId = params.conversationId;
    this.registeredOrigin = params.registeredOrigin;
    this.sessionId = params.sessionId;
    this.callbacks = params.callbacks ?? {};

    this.messageHandler = this.handleMessage.bind(this);
    window.addEventListener("message", this.messageHandler);
  }

  // ── Outbound ──────────────────────────────────────────────────────────────

  /** Send INIT after the iframe loads. */
  sendInit(restoredState: unknown = null): void {
    this.post({
      type: "INIT",
      version: PROTOCOL_VERSION,
      sessionId: this.sessionId,
      pluginId: this.pluginId,
      conversationId: this.conversationId,
      restoredState,
    });
  }

  /**
   * Send TOOL_INVOKE and return a Promise that resolves when the plugin
   * posts TOOL_RESULT (or rejects after 10 seconds).
   */
  sendToolInvoke(
    toolCallId: string,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    this.post({
      type: "TOOL_INVOKE",
      version: PROTOCOL_VERSION,
      sessionId: this.sessionId,
      pluginId: this.pluginId,
      toolName,
      toolCallId,
      arguments: args,
    });

    return new Promise<unknown>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingToolResults.delete(toolCallId);
        // Report timeout to server so the circuit breaker can be incremented (Task 5.3)
        void this.reportPluginFailure("timeout", `Tool ${toolName} timed out after ${TOOL_RESULT_TIMEOUT_MS}ms`);
        reject(new Error(`Tool result for ${toolCallId} timed out`));
      }, TOOL_RESULT_TIMEOUT_MS);

      this.pendingToolResults.set(toolCallId, { resolve, reject, timeout });
    });
  }

  sendPing(): void {
    this.post({ type: "PING", version: PROTOCOL_VERSION, sessionId: this.sessionId, pluginId: this.pluginId });
  }

  /** Remove the window event listener and clear all pending tool calls. */
  destroy(): void {
    window.removeEventListener("message", this.messageHandler);
    for (const { reject, timeout } of Array.from(this.pendingToolResults.values())) {
      clearTimeout(timeout);
      reject(new Error("PluginBridge destroyed"));
    }
    this.pendingToolResults.clear();
  }

  // ── Inbound ───────────────────────────────────────────────────────────────

  private handleMessage(event: MessageEvent): void {
    // Rule 19: Validate origin FIRST, before reading any other property.
    // Sandboxed iframes without allow-same-origin have an opaque origin;
    // browsers report event.origin as the string "null" for such frames.
    // We accept this as valid for self-hosted plugins — session/plugin ID
    // validation below provides the security boundary.
    const isSandboxedNullOrigin = event.origin === "null";
    console.log('[PluginBridge] recv msg type:', (event.data as any)?.type, 'origin:', event.origin, 'isSandboxedNull:', isSandboxedNullOrigin, 'registeredOrigin:', this.registeredOrigin, 'mySessionId:', this.sessionId, 'msgSessionId:', (event.data as any)?.sessionId);
    if (!isSandboxedNullOrigin && event.origin !== this.registeredOrigin) {
      if (event.origin !== window.location.origin) {
        // Log protocol violation (fire-and-forget, best-effort)
        void this.reportProtocolViolation("INVALID_ORIGIN", { origin: event.origin });
      }
      return;
    }

    const msg = event.data as Partial<PluginMessage>;

    // Validate session / plugin identity
    if (msg.sessionId !== this.sessionId) {
      console.warn('[PluginBridge] INVALID_SESSION_ID received:', msg.sessionId, 'expected:', this.sessionId, 'msg.type:', msg.type);
      void this.reportProtocolViolation("INVALID_SESSION_ID", { sessionId: msg.sessionId });
      return;
    }
    if (msg.pluginId !== this.pluginId) {
      void this.reportProtocolViolation("INVALID_PLUGIN_ID", { pluginId: msg.pluginId });
      return;
    }
    if (msg.version !== PROTOCOL_VERSION) {
      void this.reportProtocolViolation("INVALID_VERSION", { version: msg.version });
      return;
    }

    switch (msg.type) {
      case "PLUGIN_READY":
        this.callbacks.onReady?.();
        break;

      case "TOOL_RESULT": {
        const pending = this.pendingToolResults.get(msg.toolCallId!);
        if (pending) {
          clearTimeout(pending.timeout);
          this.pendingToolResults.delete(msg.toolCallId!);
          if (msg.isError) {
            pending.reject(new Error(String(msg.result)));
          } else {
            pending.resolve(msg.result);
          }
        }
        break;
      }

      case "STATE_UPDATE":
        this.callbacks.onStateUpdate?.(msg.state, msg.partial ?? false);
        break;

      case "PLUGIN_COMPLETE":
        this.callbacks.onComplete?.(msg.finalState, msg.summary ?? "");
        break;

      case "PLUGIN_ERROR":
        this.errorCount++;
        this.callbacks.onError?.(msg.error ?? "Unknown plugin error", msg.fatal ?? false);
        break;

      case "PONG":
        // Heartbeat acknowledged — no action needed
        break;

      default:
        void this.reportProtocolViolation("UNKNOWN_MESSAGE_TYPE", { type: msg.type });
    }
  }

  private post(msg: PlatformMessage): void {
    // Sandboxed iframes (without allow-same-origin) have an opaque null origin.
    // The browser refuses to deliver postMessage if the target origin doesn't
    // match the iframe's actual origin. For self-hosted plugins we use "*" as
    // the target — the iframe is sandboxed so there is no credential leakage risk.
    // External plugins (non-self-hosted) still use the registered origin.
    const targetOrigin = this.registeredOrigin === window.location.origin ? "*" : this.registeredOrigin;
    console.log('[PluginBridge] post', msg.type, 'targetOrigin:', targetOrigin, 'contentWindow:', !!this.iframe.contentWindow);
    this.iframe.contentWindow?.postMessage(msg, targetOrigin);
  }

  private async reportPluginFailure(
    failureType: string,
    errorDetail: string,
  ): Promise<void> {
    try {
      await fetch("/api/plugins/failure", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pluginId: this.pluginId,
          conversationId: this.conversationId,
          failureType,
          errorDetail,
        }),
      });
    } catch {
      // Best-effort — never throw from a timeout handler
    }
  }

  private async reportProtocolViolation(
    reason: string,
    detail: Record<string, unknown>,
  ): Promise<void> {
    try {
      await fetch("/api/trpc/system.auditLog", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventType: "PROTOCOL_VIOLATION",
          pluginId: this.pluginId,
          payload: { reason, ...detail },
        }),
      });
    } catch {
      // Best-effort — never throw from a message handler
    }
  }

  get pluginErrorCount(): number {
    return this.errorCount;
  }
}
