/**
 * Plugin Stats — activation, completion, and failure rates per plugin.
 * Route: /teacher/plugins
 */
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { trpc } from "@/lib/trpc";
import { Loader2 } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { teacherMenuItems } from "./TeacherDashboard";

export default function PluginStats() {
  const { data, isLoading } = trpc.teacher.getPluginUsageStats.useQuery({});

  const stats = data?.stats ?? [];

  const chartData = stats.map(s => ({
    name:       s.pluginName,
    Activations: s.activationCount,
    Completions: s.completionCount,
    Failures:    s.failureCount,
  }));

  return (
    <DashboardLayout menuItems={teacherMenuItems}>
      <div className="max-w-5xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Plugin Usage Stats</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Activation, completion, and failure counts per plugin.
          </p>
        </div>

        {isLoading ? (
          <div className="flex items-center gap-2 text-muted-foreground py-8">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-sm">Loading stats…</span>
          </div>
        ) : stats.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8">No plugin usage data yet.</p>
        ) : (
          <div className="space-y-6">
            {/* Bar chart */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Usage Overview</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={chartData} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                    <YAxis tick={{ fontSize: 12 }} />
                    <Tooltip
                      contentStyle={{ fontSize: 12, borderRadius: 6 }}
                      cursor={{ fill: "hsl(var(--muted))" }}
                    />
                    <Bar dataKey="Activations" fill="#3b82f6" radius={[3, 3, 0, 0]} />
                    <Bar dataKey="Completions" fill="#22c55e" radius={[3, 3, 0, 0]} />
                    <Bar dataKey="Failures"    fill="#ef4444" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
                <div className="flex items-center gap-4 justify-center mt-2 text-xs text-muted-foreground">
                  <LegendDot color="#3b82f6" label="Activations" />
                  <LegendDot color="#22c55e" label="Completions" />
                  <LegendDot color="#ef4444" label="Failures" />
                </div>
              </CardContent>
            </Card>

            {/* Per-plugin detail cards */}
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {stats.map(s => (
                <Card key={s.pluginId}>
                  <CardContent className="pt-5 pb-4 px-4 space-y-3">
                    <p className="font-medium truncate">{s.pluginName}</p>
                    <div className="grid grid-cols-3 gap-2 text-center">
                      <Stat label="Activations" value={s.activationCount} color="text-blue-500" />
                      <Stat label="Completions" value={s.completionCount} color="text-green-500" />
                      <Stat label="Failures"    value={s.failureCount}    color="text-red-500" />
                    </div>
                    <div className="text-xs text-muted-foreground text-center">
                      Failure rate:{" "}
                      <span className={s.failureRate > 20 ? "text-red-500 font-medium" : ""}>
                        {s.failureRate}%
                      </span>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div>
      <p className={`text-xl font-semibold tabular-nums ${color}`}>{value}</p>
      <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className="h-2.5 w-2.5 rounded-sm shrink-0" style={{ background: color }} />
      {label}
    </span>
  );
}
