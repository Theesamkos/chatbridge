import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { Loader2, MessageSquarePlus, Sparkles, User } from "lucide-react";
import {
  Suspense,
  startTransition,
  useId,
  useOptimistic,
  useRef,
  useState,
  useTransition,
} from "react";
import { toast } from "sonner";
import { AIChatBox } from "@/components/AIChatBox";
import ErrorBoundary from "@/components/ErrorBoundary";
import PluginContainer from "@/components/PluginContainer";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  streaming?: boolean;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function Chat() {
  // Rule: redirect if not authenticated
  useAuth({ redirectOnUnauthenticated: true });

  const utils = trpc.useUtils();
  const [, startHistoryTransition] = useTransition(); // Rule 24

  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const abortControllerRef = useRef<AbortController | null>(null);

  // Stable session ID for the current browser session (for PluginBridge)
  const sessionId = useId();

  // ── Conversation list ────────────────────────────────────────────────────
  const { data: convList = [], isLoading: convListLoading } =
    trpc.conversations.list.useQuery();

  // ── Active conversation with messages ────────────────────────────────────
  const { data: activeConv } = trpc.conversations.get.useQuery(
    { id: activeConvId! },
    { enabled: activeConvId !== null },
  );

  // ── Plugin schema for the active plugin ──────────────────────────────────
  const activePluginId = activeConv?.activePluginId ?? null;
  const { data: pluginSchema } = trpc.plugins.getSchema.useQuery(
    { pluginId: activePluginId! },
    { enabled: activePluginId !== null },
  );

  // ── Plugin state for restoration ─────────────────────────────────────────
  const { data: pluginState } = trpc.plugins.getState.useQuery(
    { conversationId: activeConvId!, pluginId: activePluginId! },
    { enabled: activeConvId !== null && activePluginId !== null },
  );

  // ── Optimistic messages ───────────────────────────────────────────────────
  // Rule 25: optimistic messages — user message appears instantly before SSE
  const persistedMessages: ChatMessage[] = (activeConv?.messages ?? []).map(m => ({
    id: m.id,
    role: m.role === "tool_use" || m.role === "tool_result" ? "assistant" : (m.role as ChatMessage["role"]),
    content: m.content,
  }));

  const [optimisticMessages, addOptimisticMessage] = useOptimistic<
    ChatMessage[],
    ChatMessage
  >(persistedMessages, (state, newMsg) => [...state, newMsg]);

  const createConv = trpc.conversations.create.useMutation({
    onSuccess: conv => {
      startHistoryTransition(() => {
        utils.conversations.list.invalidate();
        setActiveConvId(conv.id);
      });
    },
  });

  // ── Send a message ───────────────────────────────────────────────────────
  const handleSendMessage = async (content: string) => {
    if (!activeConvId || isStreaming) return;

    // Rule 25: show user message optimistically
    const optimisticId = `opt-${Date.now()}`;
    startTransition(() => {
      addOptimisticMessage({ id: optimisticId, role: "user", content });
    });

    setIsStreaming(true);
    setStreamingContent("");

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const res = await fetch("/api/chat/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId: activeConvId, message: content }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { reason?: string };
        toast.error(body.reason ?? "Message blocked by content policy");
        setIsStreaming(false);
        return;
      }

      if (!res.body) throw new Error("No response body");

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

          const event = JSON.parse(raw) as
            | { type: "token"; content: string }
            | { type: "tool_invoke"; toolName: string; toolCallId: string; arguments: Record<string, unknown> }
            | { type: "tool_result"; toolCallId: string; result: unknown }
            | { type: "complete"; messageId: string }
            | { type: "error"; message: string };

          if (event.type === "token") {
            // Rule 24: startTransition for streaming content updates
            startTransition(() => {
              setStreamingContent(prev => prev + event.content);
            });
          } else if (event.type === "complete") {
            // Refresh conversation to get persisted messages
            startHistoryTransition(() => {
              utils.conversations.get.invalidate({ id: activeConvId });
              utils.conversations.list.invalidate();
            });
            setStreamingContent("");
            setIsStreaming(false);
          } else if (event.type === "error") {
            toast.error("An error occurred. Please try again.");
            setIsStreaming(false);
          }
          // tool_invoke and tool_result events are handled by PluginContainer/PluginBridge
        }
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name !== "AbortError") {
        toast.error("Connection lost. Please try again.");
      }
      setIsStreaming(false);
      setStreamingContent("");
    }
  };

  const handleNewChat = () => {
    createConv.mutate({ title: "New conversation" });
  };

  // ── Build messages array for AIChatBox ───────────────────────────────────
  const displayMessages: ChatMessage[] = [
    ...optimisticMessages,
    ...(isStreaming && streamingContent
      ? [{ id: "streaming", role: "assistant" as const, content: streamingContent, streaming: true }]
      : []),
  ];

  return (
    <div className="flex h-screen overflow-hidden">
      {/* ── Sidebar ─────────────────────────────────────────────────────── */}
      <aside className="flex w-64 flex-col border-r bg-sidebar">
        <div className="flex items-center justify-between p-4 border-b">
          <span className="font-semibold text-sidebar-foreground">Conversations</span>
          {/* Rule 36: min 44×44px touch target */}
          <Button
            size="icon"
            variant="ghost"
            onClick={handleNewChat}
            disabled={createConv.isPending}
            className="min-h-[44px] min-w-[44px]"
            aria-label="New conversation"
          >
            {createConv.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <MessageSquarePlus className="size-4" />
            )}
          </Button>
        </div>

        <ScrollArea className="flex-1">
          {convListLoading ? (
            <div className="flex justify-center p-4">
              <Loader2 className="size-4 animate-spin text-muted-foreground" />
            </div>
          ) : convList.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">
              No conversations yet. Start one!
            </p>
          ) : (
            <ul className="p-2 space-y-1">
              {convList.map(conv => (
                <li key={conv.id}>
                  <button
                    onClick={() => setActiveConvId(conv.id)}
                    className={cn(
                      "w-full rounded-md px-3 py-2 text-left text-sm transition-colors min-h-[44px]",
                      activeConvId === conv.id
                        ? "bg-sidebar-primary text-sidebar-primary-foreground"
                        : "text-sidebar-foreground hover:bg-sidebar-accent",
                    )}
                  >
                    <span className="line-clamp-2">{conv.title ?? "Untitled"}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </ScrollArea>
      </aside>

      {/* ── Main area ───────────────────────────────────────────────────── */}
      <main className="flex flex-1 overflow-hidden">
        {!activeConvId ? (
          <div className="flex flex-1 flex-col items-center justify-center text-muted-foreground gap-4">
            <Sparkles className="size-12 opacity-20" />
            <p className="text-sm">Select a conversation or start a new one.</p>
            <Button onClick={handleNewChat} disabled={createConv.isPending}>
              {createConv.isPending ? (
                <Loader2 className="size-4 animate-spin mr-2" />
              ) : (
                <MessageSquarePlus className="size-4 mr-2" />
              )}
              New Conversation
            </Button>
          </div>
        ) : (
          <div
            className={cn(
              "flex flex-1 overflow-hidden",
              activePluginId ? "flex-row" : "flex-col",
            )}
          >
            {/* Chat panel — 100% width without plugin, 60% with */}
            <div
              className={cn(
                "flex flex-col overflow-hidden",
                activePluginId ? "w-[60%] border-r" : "flex-1",
              )}
            >
              {/* Rule 37: aria-live region for streaming completion */}
              <div aria-live="polite" aria-atomic="false" className="sr-only">
                {!isStreaming && streamingContent === "" ? "Response complete" : ""}
              </div>

              <AIChatBox
                messages={displayMessages.map(m => ({
                  role: m.role,
                  content: m.content,
                }))}
                onSendMessage={handleSendMessage}
                isLoading={isStreaming}
                placeholder="Ask your tutor anything…"
                height="100%"
                className="rounded-none border-0 shadow-none"
                emptyStateMessage="Start your learning conversation"
                suggestedPrompts={[
                  "Explain photosynthesis to me",
                  "Help me understand quadratic equations",
                  "What were the causes of World War I?",
                ]}
              />
            </div>

            {/* Plugin panel — shown when activePlugin is set */}
            {activePluginId && (
              <div className="flex w-[40%] flex-col overflow-hidden">
                {pluginSchema ? (
                  // Rule 26: each plugin has its own Suspense + ErrorBoundary
                  <ErrorBoundary>
                    <Suspense
                      fallback={
                        <div className="flex flex-1 items-center justify-center">
                          <Loader2 className="size-6 animate-spin text-muted-foreground" />
                        </div>
                      }
                    >
                      <PluginContainer
                        conversationId={activeConvId}
                        pluginId={activePluginId}
                        sessionId={sessionId}
                        schema={pluginSchema}
                        restoredState={pluginState?.state ?? null}
                        onComplete={(_finalState, summary) => {
                          toast.success(`Plugin complete: ${summary}`);
                        }}
                        onError={error => {
                          toast.error(`Plugin error: ${error}`);
                        }}
                      />
                    </Suspense>
                  </ErrorBoundary>
                ) : (
                  <div className="flex flex-1 items-center justify-center">
                    <Loader2 className="size-4 animate-spin text-muted-foreground" />
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
