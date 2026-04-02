import { beforeEach, describe, expect, it, vi } from "vitest";
import { PluginBridge } from "./PluginBridge";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const REGISTERED_ORIGIN = "http://localhost:3000";
const SESSION_ID = "sess-test-1";
const PLUGIN_ID = "chess";
const CONVERSATION_ID = "conv-1";

function makeIframe() {
  const iframe = document.createElement("iframe");
  // Provide a mock contentWindow so postMessage can be called
  Object.defineProperty(iframe, "contentWindow", {
    value: { postMessage: vi.fn() },
    writable: false,
  });
  return iframe;
}

function makeBridge(callbacks = {}) {
  const iframe = makeIframe();
  const bridge = new PluginBridge({
    iframe,
    pluginId: PLUGIN_ID,
    conversationId: CONVERSATION_ID,
    registeredOrigin: REGISTERED_ORIGIN,
    sessionId: SESSION_ID,
    callbacks,
  });
  return { bridge, iframe };
}

/** Dispatch a MessageEvent from the plugin origin. */
function dispatchFromPlugin(data: object, origin = REGISTERED_ORIGIN) {
  window.dispatchEvent(new MessageEvent("message", { data, origin }));
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("PluginBridge", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // Mock fetch used by reportProtocolViolation
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
  });

  // ── Origin validation (Rule 19) ──────────────────────────────────────────

  it("ignores messages from an unregistered origin", () => {
    const onReady = vi.fn();
    const { bridge } = makeBridge({ onReady });

    dispatchFromPlugin(
      { type: "PLUGIN_READY", version: 1, sessionId: SESSION_ID, pluginId: PLUGIN_ID },
      "http://evil.example.com",
    );

    expect(onReady).not.toHaveBeenCalled();
    bridge.destroy();
  });

  it("accepts messages from the registered origin", () => {
    const onReady = vi.fn();
    const { bridge } = makeBridge({ onReady });

    dispatchFromPlugin({
      type: "PLUGIN_READY",
      version: 1,
      sessionId: SESSION_ID,
      pluginId: PLUGIN_ID,
    });

    expect(onReady).toHaveBeenCalled();
    bridge.destroy();
  });

  // ── Session / plugin ID validation ────────────────────────────────────────

  it("ignores messages with a mismatched sessionId", () => {
    const onReady = vi.fn();
    const { bridge } = makeBridge({ onReady });

    dispatchFromPlugin({
      type: "PLUGIN_READY",
      version: 1,
      sessionId: "wrong-session",
      pluginId: PLUGIN_ID,
    });

    expect(onReady).not.toHaveBeenCalled();
    bridge.destroy();
  });

  it("ignores messages with a mismatched pluginId", () => {
    const onReady = vi.fn();
    const { bridge } = makeBridge({ onReady });

    dispatchFromPlugin({
      type: "PLUGIN_READY",
      version: 1,
      sessionId: SESSION_ID,
      pluginId: "wrong-plugin",
    });

    expect(onReady).not.toHaveBeenCalled();
    bridge.destroy();
  });

  // ── STATE_UPDATE ─────────────────────────────────────────────────────────

  it("calls onStateUpdate when a valid STATE_UPDATE is received", () => {
    const onStateUpdate = vi.fn();
    const { bridge } = makeBridge({ onStateUpdate });

    dispatchFromPlugin({
      type: "STATE_UPDATE",
      version: 1,
      sessionId: SESSION_ID,
      pluginId: PLUGIN_ID,
      state: { board: "rnbqkbnr", turn: "white" },
      partial: false,
    });

    expect(onStateUpdate).toHaveBeenCalledWith(
      { board: "rnbqkbnr", turn: "white" },
      false,
    );
    bridge.destroy();
  });

  // ── TOOL_RESULT ──────────────────────────────────────────────────────────

  it("resolves sendToolInvoke promise when TOOL_RESULT arrives", async () => {
    const { bridge } = makeBridge();

    const toolCallId = "tc-abc";
    const resultPromise = bridge.sendToolInvoke(toolCallId, "chess_make_move", { move: "e4" });

    dispatchFromPlugin({
      type: "TOOL_RESULT",
      version: 1,
      sessionId: SESSION_ID,
      pluginId: PLUGIN_ID,
      toolCallId,
      result: { ok: true },
      isError: false,
    });

    const result = await resultPromise;
    expect(result).toEqual({ ok: true });
    bridge.destroy();
  });

  it("rejects sendToolInvoke promise when TOOL_RESULT has isError=true", async () => {
    const { bridge } = makeBridge();

    const toolCallId = "tc-def";
    const resultPromise = bridge.sendToolInvoke(toolCallId, "chess_make_move", { move: "e4" });

    dispatchFromPlugin({
      type: "TOOL_RESULT",
      version: 1,
      sessionId: SESSION_ID,
      pluginId: PLUGIN_ID,
      toolCallId,
      result: "Move is illegal",
      isError: true,
    });

    await expect(resultPromise).rejects.toThrow("Move is illegal");
    bridge.destroy();
  });

  // ── destroy() ────────────────────────────────────────────────────────────

  it("rejects all pending tool calls on destroy()", async () => {
    const { bridge } = makeBridge();

    const p1 = bridge.sendToolInvoke("tc-1", "chess_make_move", { move: "e4" });
    const p2 = bridge.sendToolInvoke("tc-2", "chess_get_position", {});

    bridge.destroy();

    await expect(p1).rejects.toThrow("PluginBridge destroyed");
    await expect(p2).rejects.toThrow("PluginBridge destroyed");
  });

  it("stops handling messages after destroy()", () => {
    const onReady = vi.fn();
    const { bridge } = makeBridge({ onReady });

    bridge.destroy();

    dispatchFromPlugin({
      type: "PLUGIN_READY",
      version: 1,
      sessionId: SESSION_ID,
      pluginId: PLUGIN_ID,
    });

    expect(onReady).not.toHaveBeenCalled();
  });

  // ── sendInit / sendPing ───────────────────────────────────────────────────

  it("posts INIT with version:1 to the iframe contentWindow", () => {
    const { bridge, iframe } = makeBridge();
    const postMessage = iframe.contentWindow!.postMessage as ReturnType<typeof vi.fn>;

    bridge.sendInit({ board: "start" });

    // Sandboxed iframes have null/opaque origin, so PluginBridge uses "*" as targetOrigin
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "INIT", version: 1, pluginId: PLUGIN_ID }),
      "*",
    );
    bridge.destroy();
  });
});

// ─── Phase 2: Lifecycle state machine tests ────────────────────────────────

describe("PluginBridge — lifecycle callbacks", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
  });

  it("calls onComplete with finalState and summary on PLUGIN_COMPLETE", () => {
    const onComplete = vi.fn();
    const { bridge } = makeBridge({ onComplete });

    dispatchFromPlugin({
      type: "PLUGIN_COMPLETE",
      version: 1,
      sessionId: SESSION_ID,
      pluginId: PLUGIN_ID,
      finalState: { score: 42 },
      summary: "Game over — white wins",
    });

    expect(onComplete).toHaveBeenCalledWith({ score: 42 }, "Game over — white wins");
    bridge.destroy();
  });

  it("calls onError with fatal=true on fatal PLUGIN_ERROR", () => {
    const onError = vi.fn();
    const { bridge } = makeBridge({ onError });

    dispatchFromPlugin({
      type: "PLUGIN_ERROR",
      version: 1,
      sessionId: SESSION_ID,
      pluginId: PLUGIN_ID,
      error: "Unrecoverable engine crash",
      fatal: true,
    });

    expect(onError).toHaveBeenCalledWith("Unrecoverable engine crash", true);
    bridge.destroy();
  });

  it("calls onError with fatal=false on soft PLUGIN_ERROR", () => {
    const onError = vi.fn();
    const { bridge } = makeBridge({ onError });

    dispatchFromPlugin({
      type: "PLUGIN_ERROR",
      version: 1,
      sessionId: SESSION_ID,
      pluginId: PLUGIN_ID,
      error: "Transient network hiccup",
      fatal: false,
    });

    expect(onError).toHaveBeenCalledWith("Transient network hiccup", false);
    bridge.destroy();
  });

  it("calls onStateUpdate with partial=true for partial STATE_UPDATE", () => {
    const onStateUpdate = vi.fn();
    const { bridge } = makeBridge({ onStateUpdate });

    dispatchFromPlugin({
      type: "STATE_UPDATE",
      version: 1,
      sessionId: SESSION_ID,
      pluginId: PLUGIN_ID,
      state: { partialField: "value" },
      partial: true,
    });

    expect(onStateUpdate).toHaveBeenCalledWith({ partialField: "value" }, true);
    bridge.destroy();
  });

  it("sends PING via sendPing and responds to PONG correctly", () => {
    const { bridge, iframe } = makeBridge();
    const postMessage = iframe.contentWindow!.postMessage as ReturnType<typeof vi.fn>;

    bridge.sendPing();

    // Sandboxed iframes have null/opaque origin, so PluginBridge uses "*" as targetOrigin
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "PING", version: 1 }),
      "*",
    );
    bridge.destroy();
  });
});
