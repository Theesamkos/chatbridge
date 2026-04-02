/**
 * Chat — main conversational interface.
 * Covers 6C.3 polish: sidebar search/badges, message styling, plugin header,
 * auto-resize input, mobile layout, dark-mode toggle.
 */
import { useAuth } from "@/_core/hooks/useAuth";
import { useTheme } from "@/contexts/ThemeContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import {
  BookOpen,
  Check,
  Copy,
  LayoutDashboard,
  Loader2,
  Menu,
  MessageSquarePlus,
  Moon,
  Puzzle,
  Search,
  Send,
  Sparkles,
  Sun,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import { useLocation } from "wouter";
import React, {
  Suspense,
  startTransition,
  useCallback,
  useEffect,
  useId,
  useOptimistic,
  useRef,
  useState,
  useTransition,
} from "react";
import { toast } from "sonner";
import ErrorBoundary from "@/components/ErrorBoundary";
import PluginContainer, { type PluginContainerHandle } from "@/components/PluginContainer";
import PluginPicker from "@/components/PluginPicker";
import { RubricCard, type RubricScore } from "@/components/RubricCard";
import { Streamdown } from "streamdown";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  streaming?: boolean;
  createdAt?: string | Date;
}

// ─── Relative time helper ─────────────────────────────────────────────────────

function relativeTime(date: string | Date): string {
  const diff = Date.now() - new Date(date).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

// ─── Message bubble ───────────────────────────────────────────────────────────

const MessageBubble = React.memo(function MessageBubble({ msg }: { msg: ChatMessage }) {
  const [copied, setCopied] = useState(false);
  const [hovering, setHovering] = useState(false);

  const copyText = () => {
    navigator.clipboard.writeText(msg.content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  if (msg.role === "user") {
    return (
      <div className="flex justify-end group px-4 sm:px-6 animate-fade-in">
        <div className="relative max-w-[72%]">
          {msg.createdAt && (
            <p className="text-[10px] text-muted-foreground text-right mb-1 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
              {new Date(msg.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </p>
          )}
          <div className="msg-user">
            {msg.content}
          </div>
        </div>
      </div>
    );
  }

  if (msg.role === "assistant") {
    return (
      <div
        className="flex items-start gap-3 group px-4 sm:px-6 animate-fade-in"
        onMouseEnter={() => setHovering(true)}
        onMouseLeave={() => setHovering(false)}
      >
        {/* Avatar */}
        <div className="shrink-0 mt-1 h-7 w-7 rounded-full bg-primary/12 border border-primary/20 flex items-center justify-center shadow-sm">
          <Sparkles className="h-3.5 w-3.5 text-primary" />
        </div>

        <div className="flex flex-col min-w-0 flex-1 max-w-[82%]">
          {msg.createdAt && (
            <p className="text-[10px] text-muted-foreground mb-1.5 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
              {new Date(msg.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </p>
          )}
          <div
            className={cn(
              "msg-assistant prose prose-sm dark:prose-invert max-w-none",
              msg.streaming && "streaming-cursor",
            )}
          >
            {msg.streaming ? (
              <span>{msg.content}</span>
            ) : (
              <Streamdown>{msg.content}</Streamdown>
            )}
          </div>
          {/* Copy button */}
          {!msg.streaming && (
            <div className={cn("flex mt-1.5", hovering ? "opacity-100" : "opacity-0 pointer-events-none", "transition-opacity duration-150")}>
              <button
                onClick={copyText}
                className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground px-2 py-1 rounded-md hover:bg-muted/60 transition-all duration-150 min-h-[28px]"
                aria-label="Copy message"
              >
                {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
                <span>{copied ? "Copied" : "Copy"}</span>
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  return null;
});

// ─── Tool indicator ────────────────────────────────────────────────────────────

const ToolIndicator = React.memo(function ToolIndicator({ pluginName }: { pluginName: string }) {
  return (
    <div className="flex items-start gap-3 px-4 sm:px-6 animate-fade-in">
      <div className="shrink-0 mt-1 h-7 w-7 rounded-full bg-primary/12 border border-primary/20 flex items-center justify-center shadow-sm">
        <Sparkles className="h-3.5 w-3.5 text-primary" />
      </div>
      <div className="tool-indicator animate-slide-up">
        <Loader2 className="h-3.5 w-3.5 animate-spin text-primary/70" />
        <span>Using <span className="font-medium text-foreground/80">{pluginName}</span>…</span>
      </div>
    </div>
  );
});

// ─── Plugin skeleton ──────────────────────────────────────────────────────────

function PluginSkeleton() {
  return (
    <div className="flex flex-col gap-3 p-4 h-full">
      <Skeleton className="h-6 w-1/2" />
      <Skeleton className="h-full w-full rounded-lg" />
    </div>
  );
}

// ─── Auto-resize textarea ─────────────────────────────────────────────────────

function AutoResizeTextarea({
  value,
  onChange,
  onSend,
  disabled,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  disabled: boolean;
  placeholder: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    const maxH = 6 * 24 + 24;
    el.style.height = Math.min(el.scrollHeight, maxH) + "px";
  }, [value]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      if (!disabled && value.trim()) onSend();
    }
  };

  const charCount = value.length;
  const showCount = charCount >= 3000;

  return (
    <div className="relative flex flex-col">
      <textarea
        ref={ref}
        value={value}
        onChange={e => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        placeholder={placeholder}
        rows={1}
        maxLength={4000}
        className="composer-input placeholder:text-muted-foreground/60 disabled:opacity-40 pr-12"
        aria-label="Message input"
      />
      {showCount && (
        <span
          className={cn(
            "absolute bottom-3 right-12 text-[10px] tabular-nums",
            charCount >= 3800 ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {charCount}/4000
        </span>
      )}
    </div>
  );
}

// ─── Conversation sidebar content ─────────────────────────────────────────────

interface SidebarContentProps {
  convList: Array<{ id: string; title: string | null; updatedAt: string | Date; activePluginId?: string | null }>;
  loading: boolean;
  activeConvId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  isCreating: boolean;
  user: { role: string; name?: string | null } | null | undefined;
  onNavigate: (path: string) => void;
  onClose?: () => void;
  onDelete: (id: string) => void;
  deletingId: string | null;
}

const SidebarContents = React.memo(function SidebarContents({
  convList, loading, activeConvId, onSelect, onNew, isCreating, user, onNavigate, onClose, onDelete, deletingId,
}: SidebarContentProps) {
  const [search, setSearch] = useState("");

  const filtered = search.trim()
    ? convList.filter(c => (c.title ?? "Untitled").toLowerCase().includes(search.toLowerCase()))
    : convList;

  return (
    <div className="flex flex-col h-full bg-sidebar text-sidebar-foreground">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3.5 border-b border-sidebar-border shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="h-7 w-7 rounded-lg bg-primary/20 flex items-center justify-center shadow-sm">
            <Sparkles className="h-3.5 w-3.5 text-primary" />
          </div>
          <span className="font-semibold text-sm tracking-tight text-sidebar-foreground">ChatBridge</span>
        </div>
        <div className="flex items-center gap-1">
          <Button
            size="icon"
            variant="ghost"
            onClick={onNew}
            disabled={isCreating}
            className="h-8 w-8 text-sidebar-foreground hover:bg-sidebar-accent"
            aria-label="New conversation"
          >
            {isCreating ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageSquarePlus className="h-4 w-4" />}
          </Button>
          {onClose && (
            <Button size="icon" variant="ghost" onClick={onClose} className="h-8 w-8 text-sidebar-foreground hover:bg-sidebar-accent md:hidden">
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      {/* Search */}
      <div className="px-3 py-2.5 shrink-0">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-sidebar-foreground/35" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search conversations…"
            className="pl-8 h-8 text-xs bg-sidebar-accent/40 border-sidebar-border/60 text-sidebar-foreground placeholder:text-sidebar-foreground/35 focus-visible:ring-sidebar-ring focus-visible:ring-1 rounded-lg"
          />
        </div>
      </div>

      {/* List */}
      <ScrollArea className="flex-1 px-2">
        {loading ? (
          <div className="space-y-1 p-1">
            {[1,2,3].map(i => <Skeleton key={i} className="h-12 w-full rounded-lg bg-sidebar-accent/30" />)}
          </div>
        ) : filtered.length === 0 ? (
          <p className="text-xs text-sidebar-foreground/50 text-center py-6 px-3">
            {search ? "No matching conversations." : "No conversations yet. Start one!"}
          </p>
        ) : (
          <ul className="py-1 space-y-0.5">
            {filtered.map(conv => (
              <li key={conv.id} className="group/conv">
                <div className="relative flex items-center">
                  <button
                    onClick={() => { onSelect(conv.id); onClose?.(); }}
                    className={cn(
                      "w-full rounded-lg px-3 py-2.5 text-left text-sm transition-all duration-150 min-h-[44px] pr-8",
                      activeConvId === conv.id
                        ? "bg-primary/12 text-sidebar-primary font-medium shadow-sm"
                        : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground",
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="line-clamp-1 font-medium text-xs leading-snug flex-1">
                        {(conv.title ?? "Untitled").slice(0, 40)}
                      </span>
                      {conv.activePluginId && (
                        <Badge className="text-[9px] px-1 py-0 h-4 bg-primary/20 text-primary border-0 shrink-0">
                          <Zap className="h-2.5 w-2.5 mr-0.5" />
                          {conv.activePluginId}
                        </Badge>
                      )}
                    </div>
                    {conv.updatedAt && (
                      <p className="text-[10px] opacity-50 mt-0.5">{relativeTime(conv.updatedAt)}</p>
                    )}
                  </button>
                  {/* Delete button — visible on hover */}
                  <button
                    onClick={e => { e.stopPropagation(); onDelete(conv.id); }}
                    disabled={deletingId === conv.id}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 h-6 w-6 rounded-md flex items-center justify-center opacity-0 group-hover/conv:opacity-100 transition-opacity duration-150 hover:bg-destructive/15 hover:text-destructive text-sidebar-foreground/40 disabled:opacity-30"
                    aria-label="Delete conversation"
                    title="Delete conversation"
                  >
                    {deletingId === conv.id
                      ? <Loader2 className="h-3 w-3 animate-spin" />
                      : <Trash2 className="h-3 w-3" />}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </ScrollArea>

      {/* Footer nav */}
      <div className="border-t border-sidebar-border p-2 space-y-0.5 shrink-0">
        {user?.role === "student" && (
          <button
            onClick={() => { onNavigate("/portfolio"); onClose?.(); }}
            className="flex items-center gap-2 w-full rounded-lg px-3 py-2.5 text-xs text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground transition-all duration-150 min-h-[44px]"
          >
            <BookOpen className="h-3.5 w-3.5 shrink-0 text-sidebar-foreground/50" />
            My Portfolio
          </button>
        )}
        {(user?.role === "teacher" || user?.role === "admin") && (
          <button
            onClick={() => { onNavigate("/teacher"); onClose?.(); }}
            className="flex items-center gap-2 w-full rounded-lg px-3 py-2.5 text-xs text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground transition-all duration-150 min-h-[44px]"
          >
            <LayoutDashboard className="h-3.5 w-3.5 shrink-0 text-sidebar-foreground/50" />
            Teacher Dashboard
          </button>
        )}
      </div>
    </div>
  );
});

// ─── Main component ─────────────────────────────────────────────

export default function Chat() {
  const { user } = useAuth({ redirectOnUnauthenticated: true });
  const { theme, toggleTheme, switchable } = useTheme();
  const [, setLocation] = useLocation();

  const utils = trpc.useUtils();
  const [, startHistoryTransition] = useTransition();

  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const [activeToolName, setActiveToolName] = useState<string | null>(null);
  const [inputValue, setInputValue] = useState("");
  const [mobileShowPlugin, setMobileShowPlugin] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [rubricScore, setRubricScore] = useState<RubricScore | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const pluginContainerRef = useRef<PluginContainerHandle | null>(null);

  const sessionId = useId();

  // ── Data queries ──────────────────────────────────────────────────────────
  const { data: convList = [], isLoading: convListLoading } =
    trpc.conversations.list.useQuery();

  const { data: activeConv } = trpc.conversations.get.useQuery(
    { id: activeConvId! },
    { enabled: activeConvId !== null },
  );

  const activePluginId = activeConv?.activePluginId ?? null;

  const { data: pluginSchema } = trpc.plugins.getSchema.useQuery(
    { pluginId: activePluginId! },
    { enabled: activePluginId !== null },
  );

  const { data: pluginState } = trpc.plugins.getState.useQuery(
    { conversationId: activeConvId!, pluginId: activePluginId! },
    { enabled: activeConvId !== null && activePluginId !== null },
  );

  // ── Optimistic messages ───────────────────────────────────────────────────
  // Filter out tool_use and tool_result messages — they are internal plumbing
  // and should never be rendered as chat bubbles.
  const persistedMessages: ChatMessage[] = (activeConv?.messages ?? [])
    .filter(m => m.role !== "tool_use" && m.role !== "tool_result")
    .map(m => ({
      id: m.id,
      role: m.role as ChatMessage["role"],
      content: m.content,
      createdAt: m.createdAt,
    }));

  const [optimisticMessages, addOptimisticMessage] = useOptimistic<ChatMessage[], ChatMessage>(
    persistedMessages,
    (state, newMsg) => [...state, newMsg],
  );

  const deactivatePlugin = trpc.plugins.deactivate.useMutation({
    onSuccess: () => {
      utils.conversations.get.invalidate({ id: activeConvId! });
      utils.conversations.list.invalidate();
    },
    onError: () => toast.error("Failed to close plugin"),
  });

  const createConv = trpc.conversations.create.useMutation({
    onSuccess: conv => {
      startHistoryTransition(() => {
        utils.conversations.list.invalidate();
        setActiveConvId(conv.id);
      });
    },
  });

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [optimisticMessages.length, streamingContent]);

  // ── Send message ──────────────────────────────────────────────────────────
  const handleSendMessage = useCallback(async () => {
    const content = inputValue.trim();
    if (!activeConvId || isStreaming || !content) return;

    setInputValue("");
    const optimisticId = `opt-${Date.now()}`;
    startTransition(() => {
      addOptimisticMessage({ id: optimisticId, role: "user", content, createdAt: new Date() });
    });

    setIsStreaming(true);
    setStreamingContent("");
    setActiveToolName(null);

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
            setActiveToolName(null);
            startTransition(() => {
              setStreamingContent(prev => prev + event.content);
            });
          } else if (event.type === "tool_invoke") {
            setActiveToolName(pluginSchema?.name ?? event.toolName);
            // Forward tool invocation to the plugin iframe via PluginBridge
            const pluginContainer = pluginContainerRef.current;
            if (pluginContainer) {
              pluginContainer
                .sendToolInvoke(event.toolCallId, event.toolName, event.arguments)
                .then(result => {
                  // POST the result back to the server so the SSE loop can continue
                  return fetch("/api/chat/tool-result", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      toolCallId: event.toolCallId,
                      conversationId: activeConvId,
                      result,
                      isError: false,
                    }),
                  });
                })
                .catch(err => {
                  // Tool failed — report error so server can continue
                  return fetch("/api/chat/tool-result", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      toolCallId: event.toolCallId,
                      conversationId: activeConvId,
                      result: err instanceof Error ? err.message : "Tool invocation failed",
                      isError: true,
                    }),
                  });
                });
            } else {
              // Plugin container not yet mounted — send error immediately so server doesn't hang on timeout
              fetch("/api/chat/tool-result", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  toolCallId: event.toolCallId,
                  conversationId: activeConvId,
                  result: "Plugin panel is still loading. Please wait a moment and try again.",
                  isError: true,
                }),
              }).catch(() => {});
            }
          } else if (event.type === "tool_result") {
            setActiveToolName(null);
          } else if (event.type === "complete") {
            startHistoryTransition(() => {
              utils.conversations.get.invalidate({ id: activeConvId });
              utils.conversations.list.invalidate();
            });
            setStreamingContent("");
            setIsStreaming(false);
            setActiveToolName(null);
          } else if (event.type === "error") {
            toast.error("An error occurred. Please try again.");
            setIsStreaming(false);
          }
        }
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name !== "AbortError") {
        toast.error("Connection lost. Please try again.");
      }
      setIsStreaming(false);
      setStreamingContent("");
      setActiveToolName(null);
    }
  }, [activeConvId, isStreaming, inputValue, addOptimisticMessage, startHistoryTransition, utils, pluginSchema?.name]);

  const handleNewChat = () => {
    createConv.mutate({ title: "New conversation" });
  };

  const [deletingConvId, setDeletingConvId] = useState<string | null>(null);
  const deleteConv = trpc.conversations.delete.useMutation({
    onMutate: (vars) => setDeletingConvId(vars.id),
    onSuccess: (_data, vars) => {
      if (activeConvId === vars.id) setActiveConvId(null);
      utils.conversations.list.invalidate();
    },
    onError: () => toast.error("Failed to delete conversation."),
    onSettled: () => setDeletingConvId(null),
  });

  const handleDeleteConv = (id: string) => {
    if (!window.confirm("Delete this conversation? This cannot be undone.")) return;
    deleteConv.mutate({ id });
  };

  // Build display messages
  const displayMessages: ChatMessage[] = [
    ...optimisticMessages,
    ...(isStreaming && streamingContent
      ? [{ id: "streaming", role: "assistant" as const, content: streamingContent, streaming: true }]
      : []),
  ];

  const sidebarProps: SidebarContentProps = {
    convList: convList as Array<{ id: string; title: string | null; updatedAt: string | Date; activePluginId?: string | null }>,
    loading: convListLoading,
    activeConvId,
    onSelect: id => setActiveConvId(id),
    onNew: handleNewChat,
    isCreating: createConv.isPending,
    user,
    onNavigate: setLocation,
    onDelete: handleDeleteConv,
    deletingId: deletingConvId,
  };

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* ── Rule 37: aria-live region ────────────────────────────────────── */}
      <div aria-live="polite" aria-atomic="false" className="sr-only">
        {!isStreaming && streamingContent === "" ? "" : ""}
      </div>

      {/* ── Desktop sidebar ──────────────────────────────────────────────── */}
      <aside className="hidden md:flex w-64 shrink-0 flex-col border-r border-sidebar-border">
        <SidebarContents {...sidebarProps} />
      </aside>

      {/* ── Mobile sidebar (Sheet) ───────────────────────────────────────── */}
      <Sheet open={mobileSidebarOpen} onOpenChange={setMobileSidebarOpen}>
        <SheetContent side="left" className="p-0 w-72 border-0">
          <SidebarContents
            {...sidebarProps}
            onClose={() => setMobileSidebarOpen(false)}
          />
        </SheetContent>
      </Sheet>

      {/* ── Main area ────────────────────────────────────────────────────── */}
      <div className="flex flex-1 flex-col overflow-hidden min-w-0">
        {/* Top bar */}
        <header className="flex items-center justify-between px-4 py-2 border-b border-border/60 bg-background/95 backdrop-blur-md shrink-0 h-14">
          <div className="flex items-center gap-2">
            {/* Mobile hamburger */}
            <Sheet open={mobileSidebarOpen} onOpenChange={setMobileSidebarOpen}>
              <SheetTrigger asChild>
                <Button size="icon" variant="ghost" className="md:hidden h-9 w-9" aria-label="Open sidebar">
                  <Menu className="h-4 w-4" />
                </Button>
              </SheetTrigger>
            </Sheet>
            <span className="text-sm font-semibold tracking-tight truncate hidden md:block text-foreground/90">
              {activeConv?.title ?? (activeConvId ? "Conversation" : "ChatBridge")}
            </span>
          </div>

          <div className="flex items-center gap-1">
            {/* Teach Me badge */}
            {activePluginId === "chess" && (
              <Badge variant="secondary" className="text-xs hidden sm:flex" id="teach-me-badge" />
            )}
            {/* Plugin picker — only shown when a conversation is active */}
            {activeConvId && (
              <PluginPicker
                conversationId={activeConvId}
                activePluginId={activePluginId}
                onActivated={() => {
                  utils.conversations.get.invalidate({ id: activeConvId });
                  utils.conversations.list.invalidate();
                }}
                onDeactivated={() => {
                  utils.conversations.get.invalidate({ id: activeConvId });
                  utils.conversations.list.invalidate();
                }}
                disabled={isStreaming}
              />
            )}
            {/* Dark mode toggle */}
            {switchable && toggleTheme && (
              <Button
                size="icon"
                variant="ghost"
                onClick={toggleTheme}
                className="h-9 w-9"
                aria-label="Toggle theme"
              >
                {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              </Button>
            )}
          </div>
        </header>

        {/* Content area */}
        {!activeConvId ? (
          <EmptyState onNew={handleNewChat} isCreating={createConv.isPending} onQuickStart={text => setInputValue(text)} />
        ) : (
          <div className="flex flex-1 overflow-hidden min-h-0">
            {/* ── Chat panel ───────────────────────────────────────────── */}
            <div
              className={cn(
                "flex flex-col overflow-hidden min-w-0",
                activePluginId
                  ? mobileShowPlugin
                    ? "hidden md:flex md:w-[45%]"
                    : "flex w-full md:w-[45%]"
                  : "flex flex-1",
              )}
            >
              <ScrollArea className="flex-1">
                <div className="py-6 space-y-4">
                  {displayMessages
                    .filter(m => m.role !== "system")
                    .filter(m => m.role === "user" || (m.content && m.content.trim().length > 0))
                    .map(msg => (
                      <MessageBubble key={msg.id} msg={msg} />
                    ))}
                  {activeToolName && <ToolIndicator pluginName={activeToolName} />}
                  {rubricScore && (
                    <div className="px-4">
                      <RubricCard score={rubricScore} />
                    </div>
                  )}
                  <div ref={messagesEndRef} />
                </div>
              </ScrollArea>

              {/* Input */}
              <div className="shrink-0 border-t border-border/50 px-4 py-3.5">
                <div className="flex items-end gap-2.5">
                  <div className="flex-1 min-w-0">
                    <AutoResizeTextarea
                      value={inputValue}
                      onChange={setInputValue}
                      onSend={handleSendMessage}
                      disabled={isStreaming}
                      placeholder="Ask your tutor anything… (⌘↵ to send)"
                    />
                  </div>
                  <Button
                    size="icon"
                    className={cn(
                      "h-[44px] w-[44px] shrink-0 rounded-xl transition-all duration-150",
                      inputValue.trim() && !isStreaming && "glow-primary"
                    )}
                    disabled={!inputValue.trim() || isStreaming}
                    onClick={handleSendMessage}
                    aria-label="Send message"
                  >
                    {isStreaming ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  </Button>
                </div>
              </div>

              {/* Mobile: switch to plugin button */}
              {activePluginId && pluginSchema && (
                <div className="md:hidden shrink-0 border-t px-3 py-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full min-h-[44px] gap-2"
                    onClick={() => setMobileShowPlugin(true)}
                  >
                    <Puzzle className="h-4 w-4" />
                    Switch to {pluginSchema.name}
                  </Button>
                </div>
              )}
            </div>

            {/* ── Chat/Plugin divider ────────────────────────────────── */}
            {activePluginId && (
              <div className="chat-divider hidden md:block" />
            )}

            {/* ── Plugin panel ──────────────────────────────────────────── */}
            {activePluginId && (
              <div
                className={cn(
                  "flex flex-col overflow-hidden min-w-0",
                  mobileShowPlugin
                    ? "flex w-full md:w-[55%]"
                    : "hidden md:flex md:w-[55%]",
                )}
              >
                {/* Plugin header bar */}
                <div className="plugin-header shrink-0">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <div className="h-5 w-5 rounded-md bg-primary/15 flex items-center justify-center shrink-0">
                      <Zap className="h-3 w-3 text-primary" />
                    </div>
                    <span className="text-sm font-semibold tracking-tight truncate text-foreground/90">
                      {pluginSchema?.name ?? activePluginId}
                    </span>
                    {/* Teach Me Mode badge — populated by chess state */}
                    <span id="teach-me-badge-plugin" className="hidden">
                      <Badge variant="secondary" className="text-[10px] bg-amber-500/10 text-amber-600 border-amber-500/20">
                        Teach Me Mode Active
                      </Badge>
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    {/* Mobile: back to chat */}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="md:hidden h-8 text-xs gap-1"
                      onClick={() => setMobileShowPlugin(false)}
                    >
                      <MessageSquarePlus className="h-3.5 w-3.5" />
                      Chat
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 text-xs gap-1 text-muted-foreground hover:text-destructive transition-colors duration-150"
                      onClick={() => {
                        if (activeConvId && activePluginId) {
                          deactivatePlugin.mutate({ conversationId: activeConvId });
                        }
                      }}
                      disabled={deactivatePlugin.isPending}
                      aria-label="Close plugin"
                    >
                      <X className="h-3.5 w-3.5" />
                      <span className="hidden sm:inline">Close</span>
                    </Button>
                  </div>
                </div>

                {/* Plugin iframe */}
                {pluginSchema ? (
                  <ErrorBoundary>
                    <Suspense fallback={<PluginSkeleton />}>
                      <PluginContainer
                        ref={pluginContainerRef}
                        conversationId={activeConvId}
                        pluginId={activePluginId}
                        sessionId={sessionId}
                        schema={pluginSchema}
                        restoredState={pluginState?.state ?? null}
                        onComplete={(finalState, summary) => {
                          if (activePluginId === "artifact-studio" && activeConvId) {
                            fetch("/api/plugins/score-investigation", {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ conversationId: activeConvId, finalState, summary }),
                            })
                              .then(r => r.json())
                              .then((data: { score?: RubricScore }) => {
                                if (data.score) setRubricScore(data.score);
                              })
                              .catch(() => {
                                toast.success(`Investigation complete: ${summary}`);
                              });
                          } else {
                            toast.success(`Plugin complete: ${summary}`);
                          }
                        }}
                        onError={error => {
                          toast.error(`Plugin error: ${error}`);
                        }}
                      />
                    </Suspense>
                  </ErrorBoundary>
                ) : (
                  <PluginSkeleton />
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

//// ─── Empty state ────────────────────────────────────────────────────────────

const QUICK_STARTERS = [
  { label: "Play chess with me", icon: "♞" },
  { label: "Explore a historical artifact", icon: "🏛️" },
  { label: "Build a timeline of WWII", icon: "📍" },
  { label: "Explain the water cycle", icon: "💧" },
];

function EmptyState({
  onNew,
  isCreating,
  onQuickStart,
}: {
  onNew: () => void;
  isCreating: boolean;
  onQuickStart?: (text: string) => void;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-8 p-8 animate-fade-in">
      {/* Icon */}
      <div className="relative">
        <div className="h-16 w-16 rounded-2xl bg-primary/10 border border-primary/15 flex items-center justify-center shadow-lg">
          <Sparkles className="h-8 w-8 text-primary" />
        </div>
        <div className="absolute -inset-3 rounded-3xl bg-primary/5 blur-xl -z-10" />
      </div>

      {/* Copy */}
      <div className="text-center max-w-sm">
        <h3 className="font-semibold tracking-tight text-foreground">Start a conversation</h3>
        <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">
          Select an existing conversation from the sidebar, or create a new one to begin learning.
        </p>
      </div>

      {/* Quick starters */}
      <div className="grid grid-cols-2 gap-2 w-full max-w-sm">
        {QUICK_STARTERS.map(qs => (
          <button
            key={qs.label}
            onClick={() => { onNew(); onQuickStart?.(qs.label); }}
            disabled={isCreating}
            className="flex items-center gap-2 px-3 py-2.5 rounded-xl border border-border/60 bg-card/60 hover:bg-card hover:border-primary/30 text-left text-xs text-muted-foreground hover:text-foreground transition-all duration-150 disabled:opacity-50"
          >
            <span className="text-base leading-none">{qs.icon}</span>
            <span className="leading-snug">{qs.label}</span>
          </button>
        ))}
      </div>

      {/* CTA */}
      <Button
        onClick={onNew}
        disabled={isCreating}
        className="min-h-[44px] gap-2 px-6"
      >
        {isCreating ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageSquarePlus className="h-4 w-4" />}
        New Conversation
      </Button>
    </div>
  );
}
