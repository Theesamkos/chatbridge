/**
 * Conversation Log — full message + plugin state history for one conversation.
 * Route: /teacher/sessions/:conversationId
 */
import DashboardLayout from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { trpc } from "@/lib/trpc";
import { ArrowLeft, Loader2, Lock, LockOpen } from "lucide-react";
import { useLocation, useParams } from "wouter";
import { teacherMenuItems } from "./TeacherDashboard";

export default function ConversationLog() {
  const params = useParams<{ conversationId: string }>();
  const conversationId = params.conversationId ?? "";
  const [, setLocation] = useLocation();

  const { data, isLoading } = trpc.teacher.getConversationLog.useQuery(
    { conversationId },
    { enabled: Boolean(conversationId) },
  );

  const unfreezeSession = trpc.teacher.unfreezeSession.useMutation({
    onSuccess: () => utils.teacher.getConversationLog.invalidate({ conversationId }),
  });
  const utils = trpc.useUtils();

  const conv = data?.conversation;
  const msgs = data?.messages ?? [];
  const pluginStates = data?.pluginStates ?? [];

  return (
    <DashboardLayout menuItems={teacherMenuItems}>
      <div className="max-w-4xl mx-auto space-y-4">
        {/* Header */}
        <div className="flex items-start gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setLocation("/teacher/sessions")}
            className="min-h-[44px] min-w-[44px] -ml-1"
            aria-label="Back to sessions"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight truncate">
              {conv?.title ?? "Conversation"}
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              {conv?.studentName ?? "—"} · {conversationId}
            </p>
          </div>
          {conv?.status === "frozen" && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const reason = window.prompt("Enter reason for unfreezing this session:");
                if (reason) unfreezeSession.mutate({ conversationId, reason });
              }}
              disabled={unfreezeSession.isPending}
              className="min-h-[44px] gap-2 shrink-0"
            >
              {unfreezeSession.isPending
                ? <Loader2 className="h-4 w-4 animate-spin" />
                : <LockOpen className="h-4 w-4" />
              }
              Unfreeze
            </Button>
          )}
          {conv?.status === "frozen" && (
            <Badge variant="destructive" className="flex items-center gap-1 shrink-0">
              <Lock className="h-3 w-3" />
              Frozen
            </Badge>
          )}
        </div>

        {isLoading ? (
          <div className="flex items-center gap-2 text-muted-foreground py-8">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-sm">Loading conversation…</span>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Messages */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">
                  Messages
                  <span className="text-muted-foreground font-normal ml-2 text-sm">
                    ({msgs.length})
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <ScrollArea className="h-[480px]">
                  <ul className="divide-y">
                    {msgs.map(msg => (
                      <li key={msg.id} className="px-4 py-3 space-y-1">
                        <div className="flex items-center gap-2">
                          <RoleBadge role={msg.role} />
                          {msg.toolName && (
                            <Badge variant="outline" className="text-xs font-mono">
                              {msg.toolName}
                            </Badge>
                          )}
                          {msg.moderationStatus === "flagged" && (
                            <Badge variant="destructive" className="text-xs">flagged</Badge>
                          )}
                          <time className="ml-auto text-xs text-muted-foreground">
                            {new Date(msg.createdAt).toLocaleString()}
                          </time>
                        </div>
                        <p className="text-sm whitespace-pre-wrap break-words">{msg.content}</p>
                      </li>
                    ))}
                    {msgs.length === 0 && (
                      <li className="px-4 py-6 text-sm text-center text-muted-foreground">
                        No messages.
                      </li>
                    )}
                  </ul>
                </ScrollArea>
              </CardContent>
            </Card>

            {/* Plugin state snapshots */}
            {pluginStates.length > 0 && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">
                    Plugin State Snapshots
                    <span className="text-muted-foreground font-normal ml-2 text-sm">
                      ({pluginStates.length})
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <ScrollArea className="h-48">
                    <ul className="divide-y">
                      {pluginStates.map((ps, i) => (
                        <li key={i} className="px-4 py-3 text-sm space-y-1">
                          <div className="flex items-center gap-2">
                            <Badge variant="secondary" className="text-xs font-mono">{ps.pluginId}</Badge>
                            <span className="text-xs text-muted-foreground">v{ps.version}</span>
                            <time className="ml-auto text-xs text-muted-foreground">
                              {new Date(ps.createdAt).toLocaleString()}
                            </time>
                          </div>
                          <pre className="text-xs text-muted-foreground overflow-x-auto bg-muted/30 rounded p-2">
                            {JSON.stringify(ps.state, null, 2)}
                          </pre>
                        </li>
                      ))}
                    </ul>
                  </ScrollArea>
                </CardContent>
              </Card>
            )}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}

function RoleBadge({ role }: { role: string }) {
  const variantMap: Record<string, "default" | "secondary" | "outline"> = {
    user:        "default",
    assistant:   "secondary",
    tool_use:    "outline",
    tool_result: "outline",
    system:      "outline",
  };
  return (
    <Badge variant={variantMap[role] ?? "outline"} className="text-xs capitalize">
      {role.replace("_", " ")}
    </Badge>
  );
}
