/**
 * shared/pluginTypes.ts
 *
 * Canonical typed message envelope for the ChatBridge plugin postMessage protocol.
 * This file is the single source of truth for all message types exchanged between
 * the platform shell and sandboxed plugin iframes.
 *
 * Protocol version: 1
 *
 * Architecture:
 *   Platform → Plugin: PlatformMessage (INIT, TOOL_INVOKE, PING)
 *   Plugin → Platform: PluginMessage  (PLUGIN_READY, TOOL_RESULT, STATE_UPDATE,
 *                                       PLUGIN_COMPLETE, PLUGIN_ERROR, PONG)
 *
 * Security invariants (enforced in PluginBridge.ts):
 *   - Every inbound message validates event.origin before reading any data (Rule 19)
 *   - Every message carries version: 1 (Rule 7)
 *   - sessionId and pluginId are validated on every message
 *   - Unknown message types are rejected and logged as PROTOCOL_VIOLATION
 */

// ─── Protocol version ─────────────────────────────────────────────────────────

export const PLUGIN_PROTOCOL_VERSION = 1 as const;
export type ProtocolVersion = typeof PLUGIN_PROTOCOL_VERSION;

// ─── Plugin lifecycle states ──────────────────────────────────────────────────

/**
 * Lifecycle state machine for a plugin instance.
 *
 * Transitions:
 *   loading  → ready     (PLUGIN_READY received within READY_TIMEOUT_MS)
 *   loading  → error     (timeout or fatal error before PLUGIN_READY)
 *   ready    → active    (first TOOL_INVOKE sent or STATE_UPDATE received)
 *   active   → complete  (PLUGIN_COMPLETE received)
 *   active   → error     (fatal PLUGIN_ERROR received)
 *   ready    → error     (fatal PLUGIN_ERROR received)
 *   *        → disabled  (admin disables the plugin schema)
 */
export type PluginLifecycleState =
  | "loading"   // iframe mounted, waiting for PLUGIN_READY
  | "ready"     // PLUGIN_READY received, idle
  | "active"    // tool invocation in progress or state updates flowing
  | "complete"  // PLUGIN_COMPLETE received — session finished
  | "error"     // fatal error or timeout
  | "disabled"; // plugin schema status = disabled

// ─── Common message header ────────────────────────────────────────────────────

interface MessageHeader {
  /** Protocol version — must equal PLUGIN_PROTOCOL_VERSION (1). */
  version: ProtocolVersion;
  /** Manus session identifier (nanoid). Validated on every message. */
  sessionId: string;
  /** Plugin schema identifier (e.g. "chess", "artifact-studio"). Validated on every message. */
  pluginId: string;
  /** ISO-8601 UTC timestamp of when the message was created. */
  timestamp?: string;
}

// ─── Platform → Plugin messages ───────────────────────────────────────────────

/**
 * INIT — sent once after the iframe loads.
 * Carries the session context and any previously persisted plugin state.
 */
export interface InitMessage extends MessageHeader {
  type: "INIT";
  /** The conversation ID this plugin session belongs to. */
  conversationId: string;
  /**
   * Previously persisted plugin state snapshot (from plugin_states table).
   * null if this is a fresh session.
   */
  restoredState: unknown | null;
}

/**
 * TOOL_INVOKE — sent when the LLM requests a tool call.
 * The plugin must respond with a matching TOOL_RESULT within TOOL_RESULT_TIMEOUT_MS.
 */
export interface ToolInvokeMessage extends MessageHeader {
  type: "TOOL_INVOKE";
  /** Unique identifier for this tool call (nanoid). Used to match TOOL_RESULT. */
  toolCallId: string;
  /** The tool name as declared in the plugin's toolSchemas. */
  toolName: string;
  /** Tool arguments, validated against the plugin's JSON schema before forwarding. */
  arguments: Record<string, unknown>;
}

/**
 * PING — heartbeat sent periodically to verify the iframe is alive.
 * The plugin must respond with PONG.
 */
export interface PingMessage extends MessageHeader {
  type: "PING";
}

/** Union of all messages the platform sends to the plugin. */
export type PlatformMessage = InitMessage | ToolInvokeMessage | PingMessage;

// ─── Plugin → Platform messages ───────────────────────────────────────────────

/**
 * PLUGIN_READY — sent by the plugin after receiving INIT and completing initialization.
 * Must be sent within PLUGIN_READY_TIMEOUT_MS or the container enters error state.
 */
export interface PluginReadyMessage extends MessageHeader {
  type: "PLUGIN_READY";
}

/**
 * TOOL_RESULT — sent in response to a TOOL_INVOKE message.
 * Must carry the matching toolCallId.
 */
export interface ToolResultMessage extends MessageHeader {
  type: "TOOL_RESULT";
  /** Must match the toolCallId from the corresponding TOOL_INVOKE. */
  toolCallId: string;
  /** The result data to be injected into the LLM context. */
  result: unknown;
  /** true if the tool execution failed; result will be treated as an error message. */
  isError: boolean;
}

/**
 * STATE_UPDATE — sent when the plugin's internal state changes.
 * The platform persists this to the plugin_states table.
 * Rate-limited to 60 updates/minute per conversation (Rule 27).
 */
export interface StateUpdateMessage extends MessageHeader {
  type: "STATE_UPDATE";
  /** Full or partial state snapshot. */
  state: unknown;
  /**
   * If true, the platform merges this into the existing state.
   * If false (default), the platform replaces the stored state entirely.
   */
  partial: boolean;
}

/**
 * PLUGIN_COMPLETE — sent when the plugin session is finished.
 * Carries the final state and a human-readable summary.
 * After this message, the plugin container transitions to "complete" state.
 */
export interface PluginCompleteMessage extends MessageHeader {
  type: "PLUGIN_COMPLETE";
  /** Final state snapshot for persistence. */
  finalState: unknown;
  /** Human-readable summary of what was accomplished (shown in chat). */
  summary: string;
}

/**
 * PLUGIN_ERROR — sent when the plugin encounters an error.
 * If fatal=true, the container transitions to "error" state and the iframe is hidden.
 * If fatal=false, the error is logged but the plugin continues.
 */
export interface PluginErrorMessage extends MessageHeader {
  type: "PLUGIN_ERROR";
  /** Human-readable error description. */
  error: string;
  /**
   * If true, the plugin cannot recover and the container should show an error state.
   * If false, the error is transient and the plugin may continue.
   */
  fatal: boolean;
}

/**
 * PONG — heartbeat response to a PING message.
 */
export interface PongMessage extends MessageHeader {
  type: "PONG";
}

/** Union of all messages the plugin sends to the platform. */
export type PluginMessage =
  | PluginReadyMessage
  | ToolResultMessage
  | StateUpdateMessage
  | PluginCompleteMessage
  | PluginErrorMessage
  | PongMessage;

/** Union of all protocol messages (both directions). */
export type AnyPluginMessage = PlatformMessage | PluginMessage;

// ─── Protocol constants ────────────────────────────────────────────────────────

/** Maximum time (ms) to wait for PLUGIN_READY after iframe load. */
export const PLUGIN_READY_TIMEOUT_MS = 5_000;

/** Maximum time (ms) to wait for TOOL_RESULT after TOOL_INVOKE. */
export const TOOL_RESULT_TIMEOUT_MS = 10_000;

/** Maximum number of tool calls per LLM turn (circuit-breaker guard). */
export const MAX_TOOL_CALLS_PER_TURN = 3;

// ─── Plugin schema (from DB) ──────────────────────────────────────────────────

/**
 * Plugin schema as returned by the server (mirrors plugin_schemas table).
 * Used by the client to render the plugin selector and initialize the container.
 */
export interface PluginSchema {
  id: string;
  name: string;
  description: string;
  origin: string;
  iframeUrl: string;
  toolSchemas: Record<string, unknown>[];
  manifest: Record<string, unknown>;
  allowedRoles: string[];
  status: "active" | "disabled" | "deprecated";
}

// ─── Protocol violation event ─────────────────────────────────────────────────

/**
 * Payload for PROTOCOL_VIOLATION audit log events.
 * Logged by PluginBridge when an inbound message fails validation.
 */
export interface ProtocolViolationPayload {
  reason:
    | "INVALID_ORIGIN"
    | "INVALID_SESSION_ID"
    | "INVALID_PLUGIN_ID"
    | "INVALID_VERSION"
    | "UNKNOWN_MESSAGE_TYPE"
    | "MALFORMED_PAYLOAD";
  detail: Record<string, unknown>;
  pluginId: string;
  conversationId: string;
}
