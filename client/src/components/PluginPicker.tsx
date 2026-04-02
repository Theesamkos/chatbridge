/**
 * PluginPicker — polished plugin selection and activation UI.
 *
 * Renders a popover with the list of available plugins for the current user's role.
 * Handles activate / deactivate lifecycle with optimistic UI and loading states.
 */
import { useState } from "react";
import { Puzzle, ChevronDown, Zap, X, Loader2, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

interface PluginPickerProps {
  conversationId: string;
  activePluginId: string | null;
  onActivated: (pluginId: string) => void;
  onDeactivated: () => void;
  disabled?: boolean;
}

const PLUGIN_ICONS: Record<string, string> = {
  chess: "♟",
  "timeline-builder": "📅",
  "artifact-studio": "🏛",
  "mock-plugin": "🧪",
};

const PLUGIN_COLORS: Record<string, string> = {
  chess: "from-emerald-500/20 to-emerald-600/10 border-emerald-500/30",
  "timeline-builder": "from-blue-500/20 to-blue-600/10 border-blue-500/30",
  "artifact-studio": "from-amber-500/20 to-amber-600/10 border-amber-500/30",
  "mock-plugin": "from-purple-500/20 to-purple-600/10 border-purple-500/30",
};

export default function PluginPicker({
  conversationId,
  activePluginId,
  onActivated,
  onDeactivated,
  disabled = false,
}: PluginPickerProps) {
  const [open, setOpen] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const { data: plugins = [], isLoading } = trpc.plugins.list.useQuery(undefined, {
    staleTime: 30_000,
  });

  const utils = trpc.useUtils();

  const activateMutation = trpc.plugins.activate.useMutation({
    onSuccess: (_, variables) => {
      utils.conversations.list.invalidate();
      utils.conversations.get.invalidate({ id: conversationId });
      onActivated(variables.pluginId);
      setPendingId(null);
      setOpen(false);
      toast.success(`Plugin activated`);
    },
    onError: (err) => {
      setPendingId(null);
      toast.error(`Failed to activate plugin: ${err.message}`);
    },
  });

  const deactivateMutation = trpc.plugins.deactivate.useMutation({
    onSuccess: () => {
      utils.conversations.list.invalidate();
      utils.conversations.get.invalidate({ id: conversationId });
      onDeactivated();
      setPendingId(null);
      setOpen(false);
      toast.success(`Plugin deactivated`);
    },
    onError: (err) => {
      setPendingId(null);
      toast.error(`Failed to deactivate plugin: ${err.message}`);
    },
  });

  const handleActivate = (pluginId: string) => {
    if (pendingId) return;
    setPendingId(pluginId);
    activateMutation.mutate({ conversationId, pluginId });
  };

  const handleDeactivate = () => {
    if (pendingId || !activePluginId) return;
    setPendingId(activePluginId);
    deactivateMutation.mutate({ conversationId });
  };

  const activePlugin = plugins.find((p) => p.id === activePluginId);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          disabled={disabled}
          className={cn(
            "h-8 gap-1.5 text-xs font-medium transition-all",
            activePluginId
              ? "border-primary/40 bg-primary/10 text-primary hover:bg-primary/20"
              : "text-muted-foreground hover:text-foreground",
          )}
          aria-label={activePluginId ? `Active plugin: ${activePlugin?.name ?? activePluginId}` : "Select a plugin"}
        >
          {activePluginId ? (
            <>
              <Zap className="h-3.5 w-3.5" />
              <span className="hidden sm:inline truncate max-w-[100px]">
                {activePlugin?.name ?? activePluginId}
              </span>
              <ChevronDown className="h-3 w-3 opacity-60" />
            </>
          ) : (
            <>
              <Puzzle className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Apps</span>
              <ChevronDown className="h-3 w-3 opacity-60" />
            </>
          )}
        </Button>
      </PopoverTrigger>

      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-72 p-0 shadow-xl border-border/60"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-2.5 border-b border-border/60">
          <div className="flex items-center gap-2">
            <Puzzle className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-xs font-semibold text-foreground">Learning Apps</span>
          </div>
          {activePluginId && (
            <Badge variant="secondary" className="text-[10px] h-4 px-1.5 bg-primary/10 text-primary border-primary/20">
              1 active
            </Badge>
          )}
        </div>

        {/* Plugin list */}
        <div className="p-1.5 space-y-1">
          {isLoading ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          ) : plugins.length === 0 ? (
            <div className="py-6 text-center text-xs text-muted-foreground">
              No apps available for your role.
            </div>
          ) : (
            plugins.map((plugin) => {
              const isActive = plugin.id === activePluginId;
              const isPending = pendingId === plugin.id;
              const colorClass = PLUGIN_COLORS[plugin.id] ?? "from-slate-500/20 to-slate-600/10 border-slate-500/30";
              const icon = PLUGIN_ICONS[plugin.id] ?? "🔌";

              return (
                <button
                  key={plugin.id}
                  onClick={() => isActive ? handleDeactivate() : handleActivate(plugin.id)}
                  disabled={!!pendingId}
                  className={cn(
                    "w-full flex items-start gap-3 rounded-lg px-3 py-2.5 text-left transition-all",
                    "hover:bg-accent/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    isActive && "bg-primary/8 ring-1 ring-primary/20",
                    isPending && "opacity-60 cursor-wait",
                  )}
                >
                  {/* Icon */}
                  <div
                    className={cn(
                      "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border bg-gradient-to-br text-lg",
                      colorClass,
                    )}
                  >
                    {icon}
                  </div>

                  {/* Text */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-medium leading-tight truncate">
                        {plugin.name}
                      </span>
                      {isActive && (
                        <CheckCircle2 className="h-3.5 w-3.5 text-primary shrink-0" />
                      )}
                    </div>
                    <p className="text-[11px] text-muted-foreground leading-snug mt-0.5 line-clamp-2">
                      {plugin.description}
                    </p>
                  </div>

                  {/* Action indicator */}
                  <div className="shrink-0 mt-0.5">
                    {isPending ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                    ) : isActive ? (
                      <X className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100" />
                    ) : null}
                  </div>
                </button>
              );
            })
          )}
        </div>

        {/* Footer */}
        {activePluginId && (
          <div className="border-t border-border/60 px-3 py-2">
            <button
              onClick={handleDeactivate}
              disabled={!!pendingId}
              className="w-full flex items-center justify-center gap-1.5 text-xs text-muted-foreground hover:text-destructive transition-colors py-1 rounded"
            >
              {pendingId === activePluginId ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <X className="h-3 w-3" />
              )}
              Deactivate {activePlugin?.name ?? activePluginId}
            </button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
