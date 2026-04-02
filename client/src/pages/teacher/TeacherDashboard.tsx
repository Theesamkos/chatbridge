/**
 * Teacher Dashboard — overview page at /teacher.
 * Shows class summary cards and recent activity feed.
 */
import DashboardLayout, { type MenuItem } from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { trpc } from "@/lib/trpc";
import { BarChart2, BookOpen, LayoutDashboard, Loader2, Settings, Shield, Users } from "lucide-react";
import { useLocation } from "wouter";

// ─── Shared teacher nav ───────────────────────────────────────────────────────

export const teacherMenuItems: MenuItem[] = [
  { icon: LayoutDashboard, label: "Dashboard",        path: "/teacher" },
  { icon: Users,           label: "Student Sessions", path: "/teacher/sessions" },
  { icon: Shield,          label: "Safety Events",    path: "/teacher/safety" },
  { icon: BarChart2,       label: "Plugin Stats",     path: "/teacher/plugins" },
];

// ─── Component ────────────────────────────────────────────────────────────────

export default function TeacherDashboard() {
  const [, setLocation] = useLocation();

  const { data: me } = trpc.auth.me.useQuery();

  const { data: summary, isLoading: summaryLoading } =
    trpc.teacher.getClassSummary.useQuery();

  const { data: activityData, isLoading: activityLoading } =
    trpc.teacher.getRecentActivity.useQuery({ limit: 10 });

  return (
    <DashboardLayout menuItems={teacherMenuItems}>
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Teacher Dashboard</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Overview of class activity and safety events.
            </p>
          </div>
          {me?.role === "admin" && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setLocation("/admin")}
              className="min-h-[44px] gap-2 border-slate-300 text-slate-700 hover:bg-slate-100 shrink-0"
            >
              <Settings className="h-4 w-4" />
              Admin Panel
            </Button>
          )}
        </div>

        {/* Summary cards */}
        {summaryLoading ? (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-sm">Loading summary…</span>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            <SummaryCard
              title="Students"
              value={summary?.totalStudents ?? 0}
              icon={<Users className="h-4 w-4 text-blue-500" />}
            />
            <SummaryCard
              title="Active Sessions"
              value={summary?.activeConversations ?? 0}
              icon={<BookOpen className="h-4 w-4 text-green-500" />}
            />
            <SummaryCard
              title="Safety (24h)"
              value={summary?.safetyEventsLast24h ?? 0}
              icon={<Shield className="h-4 w-4 text-red-500" />}
            />
            <SummaryCard
              title="Top Plugin"
              value={summary?.mostUsedPlugin ?? "—"}
              icon={<BarChart2 className="h-4 w-4 text-purple-500" />}
              small
            />
            <SummaryCard
              title="Avg Msgs / Session"
              value={summary?.avgMessagesPerSession ?? 0}
              icon={<LayoutDashboard className="h-4 w-4 text-orange-500" />}
            />
          </div>
        )}

        {/* Recent activity */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Recent Activity</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {activityLoading ? (
              <div className="flex items-center gap-2 p-4 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span className="text-sm">Loading activity…</span>
              </div>
            ) : (
              <ScrollArea className="h-64">
                <ul className="divide-y">
                  {(activityData?.events ?? []).map(evt => (
                    <li
                      key={evt.id}
                      className="flex items-center justify-between px-4 py-3 text-sm hover:bg-muted/40 cursor-pointer"
                      onClick={() =>
                        evt.conversationId &&
                        setLocation(`/teacher/sessions/${evt.conversationId}`)
                      }
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <SeverityBadge severity={evt.severity} />
                        <span className="truncate font-mono text-xs text-muted-foreground">
                          {evt.eventType}
                        </span>
                        {evt.studentName && (
                          <span className="truncate text-foreground">{evt.studentName}</span>
                        )}
                      </div>
                      <time className="text-xs text-muted-foreground whitespace-nowrap ml-2">
                        {new Date(evt.createdAt).toLocaleTimeString()}
                      </time>
                    </li>
                  ))}
                  {(activityData?.events ?? []).length === 0 && (
                    <li className="px-4 py-6 text-sm text-center text-muted-foreground">
                      No recent activity.
                    </li>
                  )}
                </ul>
              </ScrollArea>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SummaryCard({
  title,
  value,
  icon,
  small = false,
}: {
  title: string;
  value: string | number;
  icon: React.ReactNode;
  small?: boolean;
}) {
  return (
    <Card>
      <CardContent className="pt-5 pb-4 px-4">
        <div className="flex items-center gap-2 mb-2">
          {icon}
          <span className="text-xs text-muted-foreground font-medium">{title}</span>
        </div>
        <p className={`font-semibold tracking-tight ${small ? "text-base truncate" : "text-2xl"}`}>
          {value}
        </p>
      </CardContent>
    </Card>
  );
}

function SeverityBadge({ severity }: { severity: string }) {
  const variant: Record<string, "default" | "destructive" | "secondary" | "outline"> = {
    info:     "secondary",
    warning:  "outline",
    error:    "destructive",
    critical: "destructive",
  };
  return (
    <Badge variant={variant[severity] ?? "secondary"} className="text-xs shrink-0">
      {severity}
    </Badge>
  );
}
