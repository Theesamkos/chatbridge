/**
 * Teacher Dashboard — overview page at /teacher.
 * Premium redesign: elevated stat cards, trend indicators, refined activity feed.
 */
import DashboardLayout, { type MenuItem } from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { trpc } from "@/lib/trpc";
import {
  BarChart2,
  BookOpen,
  LayoutDashboard,
  Loader2,
  MessageSquare,
  Settings,
  Shield,
  Users,
  TrendingUp,
  Activity,
  ChevronRight,
} from "lucide-react";
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

  const now = new Date();
  const timeGreeting = now.getHours() < 12 ? "Good morning" : now.getHours() < 17 ? "Good afternoon" : "Good evening";

  return (
    <DashboardLayout menuItems={teacherMenuItems}>
      <div className="max-w-5xl mx-auto space-y-7 animate-fade-in">

        {/* Page header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider mb-1">
              {timeGreeting}
            </p>
            <h1 className="text-2xl font-bold tracking-tight">Teacher Dashboard</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Overview of class activity, safety events, and plugin usage.
            </p>
          </div>
          {me?.role === "admin" && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setLocation("/admin")}
              className="min-h-[40px] gap-2 shrink-0 bg-transparent"
            >
              <Settings className="h-3.5 w-3.5" />
              Admin Panel
            </Button>
          )}
        </div>

        {/* Summary cards */}
        {summaryLoading ? (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="rounded-xl border border-border/60 bg-card/60 p-4 h-24 animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            <SummaryCard
              title="Students"
              value={summary?.totalStudents ?? 0}
              icon={<Users className="h-4 w-4" />}
              color="blue"
            />
            <SummaryCard
              title="Active Sessions"
              value={summary?.activeConversations ?? 0}
              icon={<Activity className="h-4 w-4" />}
              color="emerald"
              trend="up"
            />
            <SummaryCard
              title="Safety (24h)"
              value={summary?.safetyEventsLast24h ?? 0}
              icon={<Shield className="h-4 w-4" />}
              color="red"
              trend={(summary?.safetyEventsLast24h ?? 0) > 0 ? "up" : undefined}
            />
            <SummaryCard
              title="Top Plugin"
              value={summary?.mostUsedPlugin ?? "—"}
              icon={<BarChart2 className="h-4 w-4" />}
              color="purple"
              small
            />
            <SummaryCard
              title="Avg Msgs"
              value={summary?.avgMessagesPerSession ?? 0}
              icon={<MessageSquare className="h-4 w-4" />}
              color="orange"
            />
          </div>
        )}

        {/* Quick actions */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "View Sessions",   icon: <BookOpen className="h-4 w-4" />,  path: "/teacher/sessions" },
            { label: "Safety Events",   icon: <Shield className="h-4 w-4" />,    path: "/teacher/safety" },
            { label: "Plugin Stats",    icon: <BarChart2 className="h-4 w-4" />, path: "/teacher/plugins" },
            { label: "Conversations",   icon: <MessageSquare className="h-4 w-4" />, path: "/chat" },
          ].map(action => (
            <button
              key={action.path}
              onClick={() => setLocation(action.path)}
              className="flex items-center justify-between gap-2 rounded-xl border border-border/60 bg-card/60 hover:bg-card hover:border-border px-4 py-3 text-sm font-medium transition-all duration-150 group"
            >
              <div className="flex items-center gap-2 text-muted-foreground group-hover:text-foreground transition-colors">
                {action.icon}
                {action.label}
              </div>
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/40 group-hover:text-muted-foreground transition-colors" />
            </button>
          ))}
        </div>

        {/* Recent activity */}
        <Card className="border-border/60 shadow-sm">
          <CardHeader className="pb-3 border-b border-border/40">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base font-semibold tracking-tight">Recent Activity</CardTitle>
              <button
                onClick={() => setLocation("/teacher/sessions")}
                className="text-xs text-muted-foreground hover:text-primary transition-colors flex items-center gap-1"
              >
                View all
                <ChevronRight className="h-3 w-3" />
              </button>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {activityLoading ? (
              <div className="flex items-center gap-2 p-5 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span className="text-sm">Loading activity…</span>
              </div>
            ) : (
              <ScrollArea className="h-64">
                <ul>
                  {(activityData?.events ?? []).map((evt, idx) => (
                    <li
                      key={evt.id}
                      className={`flex items-center justify-between px-5 py-3 text-sm hover:bg-muted/30 cursor-pointer transition-colors duration-100 ${idx > 0 ? "border-t border-border/30" : ""}`}
                      onClick={() =>
                        evt.conversationId &&
                        setLocation(`/teacher/sessions/${evt.conversationId}`)
                      }
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <SeverityBadge severity={evt.severity} />
                        <span className="truncate font-mono text-[11px] text-muted-foreground/70 hidden sm:block">
                          {evt.eventType}
                        </span>
                        {evt.studentName && (
                          <span className="truncate text-foreground/80 font-medium text-xs">{evt.studentName}</span>
                        )}
                      </div>
                      <time className="text-[11px] text-muted-foreground whitespace-nowrap ml-3 tabular-nums">
                        {new Date(evt.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </time>
                    </li>
                  ))}
                  {(activityData?.events ?? []).length === 0 && (
                    <li className="px-5 py-8 text-sm text-center text-muted-foreground">
                      <Activity className="h-8 w-8 mx-auto mb-2 opacity-20" />
                      No recent activity to display.
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

const colorMap = {
  blue:   { bg: "bg-blue-500/10",   border: "border-blue-500/20",   icon: "text-blue-500" },
  emerald:{ bg: "bg-emerald-500/10",border: "border-emerald-500/20",icon: "text-emerald-500" },
  red:    { bg: "bg-red-500/10",    border: "border-red-500/20",    icon: "text-red-500" },
  purple: { bg: "bg-purple-500/10", border: "border-purple-500/20", icon: "text-purple-500" },
  orange: { bg: "bg-orange-500/10", border: "border-orange-500/20", icon: "text-orange-500" },
};

function SummaryCard({
  title,
  value,
  icon,
  color = "blue",
  small = false,
  trend,
}: {
  title: string;
  value: string | number;
  icon: React.ReactNode;
  color?: keyof typeof colorMap;
  small?: boolean;
  trend?: "up" | "down";
}) {
  const c = colorMap[color];
  return (
    <div className="rounded-xl border border-border/60 bg-card/80 p-4 flex flex-col gap-3 hover:bg-card hover:shadow-sm transition-all duration-150">
      <div className="flex items-center justify-between">
        <div className={`h-8 w-8 rounded-lg border flex items-center justify-center ${c.bg} ${c.border}`}>
          <span className={c.icon}>{icon}</span>
        </div>
        {trend && (
          <TrendingUp className={`h-3.5 w-3.5 ${trend === "up" && color === "red" ? "text-red-500" : "text-emerald-500"}`} />
        )}
      </div>
      <div>
        <p className={`font-bold tracking-tight leading-none ${small ? "text-base truncate" : "text-2xl"}`}>
          {value}
        </p>
        <p className="text-xs text-muted-foreground mt-1 font-medium">{title}</p>
      </div>
    </div>
  );
}

function SeverityBadge({ severity }: { severity: string }) {
  const styles: Record<string, string> = {
    info:     "bg-blue-500/10 text-blue-600 border-blue-500/20",
    warning:  "bg-amber-500/10 text-amber-600 border-amber-500/20",
    error:    "bg-red-500/10 text-red-600 border-red-500/20",
    critical: "bg-red-500/15 text-red-700 border-red-500/30 font-semibold",
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium border shrink-0 ${styles[severity] ?? "bg-muted text-muted-foreground border-border"}`}>
      {severity}
    </span>
  );
}
