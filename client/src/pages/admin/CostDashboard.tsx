/**
 * Cost Dashboard — LLM cost metrics and projections at /admin/costs.
 */
import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { trpc } from "@/lib/trpc";
import { DollarSign, Loader2 } from "lucide-react";
import { useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { adminMenuItems } from "./AdminDashboard";

// Default: current month
function startOfMonth(): string {
  const d = new Date();
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function CostDashboard() {
  const [dateFrom, setDateFrom] = useState(startOfMonth());
  const [dateTo,   setDateTo]   = useState(today());

  const queryInput = useMemo(() => ({
    dateFrom: dateFrom ? new Date(dateFrom).getTime() : undefined,
    dateTo:   dateTo   ? new Date(dateTo  ).getTime() : undefined,
  }), [dateFrom, dateTo]);

  const { data, isLoading } = trpc.admin.getCostMetrics.useQuery(queryInput);
  const m = data?.metrics;

  const projectionRows = m
    ? [
        { label: "100 users",    ...m.projections.per100Users   },
        { label: "1,000 users",  ...m.projections.per1KUsers    },
        { label: "10,000 users", ...m.projections.per10KUsers   },
        { label: "100K users",   ...m.projections.per100KUsers  },
      ]
    : [];

  // Build a simple chart data point per projection tier
  const chartData = projectionRows.map(r => ({
    name:    r.label,
    cost:    r.estimatedCostUSD,
    requests: r.requests,
  }));

  return (
    <DashboardLayout menuItems={adminMenuItems}>
      <div className="max-w-6xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Cost Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-1">
            LLM token usage and estimated spend. Pricing: $3/1M input · $15/1M output (Claude Sonnet).
          </p>
        </div>

        {/* Date range */}
        <div className="flex items-center gap-3">
          <Input
            type="date"
            value={dateFrom}
            onChange={e => setDateFrom(e.target.value)}
            className="w-[160px] min-h-[44px]"
          />
          <span className="text-muted-foreground text-sm">to</span>
          <Input
            type="date"
            value={dateTo}
            onChange={e => setDateTo(e.target.value)}
            className="w-[160px] min-h-[44px]"
          />
          <Button
            variant="ghost"
            size="sm"
            className="min-h-[44px]"
            onClick={() => { setDateFrom(startOfMonth()); setDateTo(today()); }}
          >
            Reset to month
          </Button>
        </div>

        {isLoading || !m ? (
          <div className="flex items-center gap-2 text-muted-foreground py-8">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-sm">Loading metrics…</span>
          </div>
        ) : (
          <>
            {/* Summary cards */}
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <MetricCard
                label="Estimated Cost"
                value={`$${m.estimatedCostUSD.toFixed(4)}`}
                icon={<DollarSign className="h-4 w-4 text-amber-500" />}
              />
              <MetricCard
                label="Total Requests"
                value={m.totalRequests.toLocaleString()}
              />
              <MetricCard
                label="Input Tokens"
                value={formatTokens(m.totalInputTokens)}
              />
              <MetricCard
                label="Output Tokens"
                value={formatTokens(m.totalOutputTokens)}
              />
            </div>

            <div className="grid grid-cols-2 gap-4 sm:grid-cols-2">
              <MetricCard
                label="Avg Tokens / Request"
                value={m.avgTokensPerRequest.toLocaleString()}
              />
              <MetricCard
                label="Input : Output Ratio"
                value={
                  m.totalOutputTokens > 0
                    ? `${(m.totalInputTokens / m.totalOutputTokens).toFixed(1)} : 1`
                    : "—"
                }
              />
            </div>

            {/* Projections chart */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Cost Projections</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={240}>
                  <LineChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis
                      dataKey="name"
                      tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                    />
                    <YAxis
                      tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                      tickFormatter={v => `$${v.toLocaleString()}`}
                    />
                    <Tooltip
                      formatter={(value: number) => [`$${value.toLocaleString()}`, "Est. Cost"]}
                      contentStyle={{
                        background: "hsl(var(--popover))",
                        border: "1px solid hsl(var(--border))",
                        borderRadius: 6,
                        fontSize: 12,
                      }}
                    />
                    <Line
                      type="monotone"
                      dataKey="cost"
                      stroke="hsl(var(--primary))"
                      strokeWidth={2}
                      dot={{ r: 4 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* Projections table */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Detailed Projections</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Scale</TableHead>
                      <TableHead className="text-right">Users</TableHead>
                      <TableHead className="text-right">Requests</TableHead>
                      <TableHead className="text-right">Input Tokens</TableHead>
                      <TableHead className="text-right">Output Tokens</TableHead>
                      <TableHead className="text-right">Est. Cost (USD)</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {projectionRows.map(r => (
                      <TableRow key={r.label}>
                        <TableCell className="font-medium">{r.label}</TableCell>
                        <TableCell className="text-right tabular-nums">{r.users.toLocaleString()}</TableCell>
                        <TableCell className="text-right tabular-nums">{r.requests.toLocaleString()}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatTokens(r.inputTokens)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatTokens(r.outputTokens)}</TableCell>
                        <TableCell className="text-right tabular-nums font-semibold">
                          ${r.estimatedCostUSD.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </DashboardLayout>
  );
}

function MetricCard({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="pt-5 pb-4 px-4">
        <div className="flex items-center gap-2 mb-2">
          {icon}
          <span className="text-xs text-muted-foreground font-medium">{label}</span>
        </div>
        <p className="text-2xl font-semibold tracking-tight truncate">{value}</p>
      </CardContent>
    </Card>
  );
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}
