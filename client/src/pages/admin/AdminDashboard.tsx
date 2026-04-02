/**
 * Admin Dashboard — overview at /admin.
 * Design: dark navy sidebar, light gray content, red/amber for critical items.
 */
import DashboardLayout, { type MenuItem } from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { trpc } from "@/lib/trpc";
import {
  Activity,
  AlertTriangle,
  BarChart2,
  DollarSign,
  LayoutDashboard,
  Loader2,
  Shield,
  Users,
  Zap,
} from "lucide-react";
import { useMemo } from "react";
import { useLocation } from "wouter";

// ─── Shared admin nav ─────────────────────────────────────────────────────────

export const adminMenuItems: MenuItem[] = [
  { icon: LayoutDashboard, label: "Overview",          path: "/admin" },
  { icon: Zap,             label: "Plugins",           path: "/admin/plugins" },
  { icon: Activity,        label: "Audit Logs",        path: "/admin/audit" },
  { icon: Users,           label: "Users",             path: "/admin/users" },
  { icon: DollarSign,      label: "Cost Dashboard",    path: "/admin/costs" },
  { icon: AlertTriangle,   label: "Plugin Failures",   path: "/admin/failures" },
];

// ─── Component ────────────────────────────────────────────────────────────────

export default function AdminDashboard() {
  const [, setLocation] = useLocation();

  const startOfMonth = useMemo(() => {
    const d = new Date();
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }, []);

  const startOfToday = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }, []);

  const { data: usersData }    = trpc.admin.getUsers.useQuery({ limit: 1 });
  const { data: pluginsData }  = trpc.admin.getPlugins.useQuery({});
  const { data: auditToday }   = trpc.admin.getAuditLogs.useQuery({ dateFrom: startOfToday, limit: 1 });
  const { data: costData }     = trpc.admin.getCostMetrics.useQuery({ dateFrom: startOfMonth });
  const { data: failuresData } = trpc.admin.getPluginFailures.useQuery({ resolved: false, limit: 1 });
  const { data: criticalLogs } = trpc.admin.getAuditLogs.useQuery({ severity: "critical", limit: 5 });

  const totalUsers       = usersData?.total ?? 0;
  const activePlugins    = (pluginsData?.plugins ?? []).filter(p => p.status === "active").length;
  const auditEventsToday = auditToday?.total ?? 0;
  const estimatedCost    = costData?.metrics.estimatedCostUSD ?? 0;
  const openFailures     = failuresData?.total ?? 0;

  return (
    <DashboardLayout menuItems={adminMenuItems}>
      <div className="max-w-5xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Admin Overview</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Platform health, usage, and recent critical events.
          </p>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          <StatCard
            title="Total Users"
            value={totalUsers}
            icon={<Users className="h-4 w-4 text-blue-500" />}
            onClick={() => setLocation("/admin/users")}
          />
          <StatCard
            title="Active Plugins"
            value={activePlugins}
            icon={<Zap className="h-4 w-4 text-green-500" />}
            onClick={() => setLocation("/admin/plugins")}
          />
          <StatCard
            title="Audit Events Today"
            value={auditEventsToday}
            icon={<Activity className="h-4 w-4 text-purple-500" />}
            onClick={() => setLocation("/admin/audit")}
          />
          <StatCard
            title="Est. Cost (month)"
            value={`$${estimatedCost.toFixed(2)}`}
            icon={<DollarSign className="h-4 w-4 text-amber-500" />}
            onClick={() => setLocation("/admin/costs")}
            small
          />
          <StatCard
            title="Open Failures"
            value={openFailures}
            icon={<AlertTriangle className="h-4 w-4 text-red-500" />}
            onClick={() => setLocation("/admin/failures")}
            highlight={openFailures > 0}
          />
        </div>

        {/* System health — circuit breaker status */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Shield className="h-4 w-4" />
              Plugin Health
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!pluginsData ? (
              <div className="flex items-center gap-2 text-muted-foreground text-sm">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading…
              </div>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {pluginsData.plugins.map(p => (
                  <div
                    key={p.id}
                    className="flex items-center gap-3 rounded-md border px-3 py-2 text-sm cursor-pointer hover:bg-muted/40"
                    onClick={() => setLocation("/admin/plugins")}
                  >
                    <span
                      className={`h-2.5 w-2.5 rounded-full shrink-0 ${
                        p.circuitBreakerActive ? "bg-red-500" :
                        p.status !== "active"  ? "bg-amber-400" :
                        "bg-green-500"
                      }`}
                    />
                    <span className="font-medium truncate">{p.name}</span>
                    {p.circuitBreakerActive && (
                      <Badge variant="destructive" className="text-xs ml-auto shrink-0">CB open</Badge>
                    )}
                    {p.status === "suspended" && (
                      <Badge variant="destructive" className="text-xs ml-auto shrink-0">Suspended</Badge>
                    )}
                    {p.status === "disabled" && !p.circuitBreakerActive && (
                      <Badge variant="outline" className="text-xs ml-auto shrink-0">Disabled</Badge>
                    )}
                  </div>
                ))}
                {pluginsData.plugins.length === 0 && (
                  <p className="text-sm text-muted-foreground col-span-3">No plugins registered.</p>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent critical events */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-red-500" />
              Recent Critical Events
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <ul className="divide-y">
              {(criticalLogs?.logs ?? []).map(evt => (
                <li
                  key={evt.id}
                  className="flex items-center gap-3 px-4 py-3 text-sm border-l-2 border-l-red-500 cursor-pointer hover:bg-muted/40"
                  onClick={() => setLocation("/admin/audit")}
                >
                  <SeverityBadge severity={evt.severity} />
                  <span className="font-mono text-xs text-muted-foreground">{evt.eventType}</span>
                  {evt.userName && <span className="truncate">{evt.userName}</span>}
                  <time className="ml-auto text-xs text-muted-foreground whitespace-nowrap">
                    {new Date(evt.createdAt).toLocaleString()}
                  </time>
                </li>
              ))}
              {(criticalLogs?.logs ?? []).length === 0 && (
                <li className="px-4 py-6 text-sm text-center text-muted-foreground">
                  No critical events.
                </li>
              )}
            </ul>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatCard({
  title, value, icon, onClick, small = false, highlight = false,
}: {
  title: string;
  value: string | number;
  icon: React.ReactNode;
  onClick?: () => void;
  small?: boolean;
  highlight?: boolean;
}) {
  return (
    <Card
      className={`cursor-pointer hover:shadow-md transition-shadow ${highlight ? "border-red-300" : ""}`}
      onClick={onClick}
    >
      <CardContent className="pt-5 pb-4 px-4">
        <div className="flex items-center gap-2 mb-2">
          {icon}
          <span className="text-xs text-muted-foreground font-medium">{title}</span>
        </div>
        <p className={`font-semibold tracking-tight ${small ? "text-base truncate" : "text-2xl"} ${highlight ? "text-red-500" : ""}`}>
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
