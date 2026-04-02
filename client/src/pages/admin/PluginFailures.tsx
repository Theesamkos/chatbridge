/**
 * Plugin Failures — paginated failure log with resolve action at /admin/failures.
 */
import DashboardLayout from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { trpc } from "@/lib/trpc";
import { CheckCircle2, Loader2 } from "lucide-react";
import { useMemo, useState } from "react";
import { adminMenuItems } from "./AdminDashboard";

const LIMIT = 20;

export default function PluginFailures() {
  const utils = trpc.useUtils();
  const [page, setPage]             = useState(0);
  const [resolvedFilter, setResolvedFilter] = useState<string>("false");

  const queryInput = useMemo(() => ({
    page,
    limit: LIMIT,
    resolved: resolvedFilter === "all" ? undefined : resolvedFilter === "true",
  }), [page, resolvedFilter]);

  const { data, isLoading } = trpc.admin.getPluginFailures.useQuery(queryInput);

  const resolveFailure = trpc.admin.resolvePluginFailure.useMutation({
    onSuccess: () => utils.admin.getPluginFailures.invalidate(),
  });

  const failures   = data?.failures ?? [];
  const total      = data?.total ?? 0;
  const totalPages = Math.ceil(total / LIMIT);

  return (
    <DashboardLayout menuItems={adminMenuItems}>
      <div className="max-w-6xl mx-auto space-y-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Plugin Failures</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Plugin errors and circuit-breaker trips. Mark resolved when investigated.
          </p>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-3">
          <Select value={resolvedFilter} onValueChange={v => { setResolvedFilter(v); setPage(0); }}>
            <SelectTrigger className="w-[180px] min-h-[44px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="false">Open (unresolved)</SelectItem>
              <SelectItem value="true">Resolved</SelectItem>
              <SelectItem value="all">All</SelectItem>
            </SelectContent>
          </Select>
          <span className="text-sm text-muted-foreground">{total} total</span>
        </div>

        {/* Table */}
        {isLoading ? (
          <div className="flex items-center gap-2 text-muted-foreground py-8">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-sm">Loading failures…</span>
          </div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[140px]">Plugin</TableHead>
                  <TableHead className="w-[130px]">Type</TableHead>
                  <TableHead className="w-[180px]">Conversation</TableHead>
                  <TableHead>Error</TableHead>
                  <TableHead className="w-[100px]">Status</TableHead>
                  <TableHead className="w-[160px]">Time</TableHead>
                  <TableHead className="w-[100px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {failures.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                      No failures found.
                    </TableCell>
                  </TableRow>
                )}
                {failures.map(f => (
                  <TableRow
                    key={f.id}
                    className={!f.resolved ? "bg-red-50 dark:bg-red-950/20" : undefined}
                  >
                    <TableCell className="font-medium">
                      {f.pluginName ?? <span className="text-muted-foreground font-mono text-xs">{f.pluginId}</span>}
                    </TableCell>
                    <TableCell>
                      <FailureTypeBadge type={f.failureType ?? ""} />
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground truncate max-w-[180px]">
                      {f.conversationId ?? "—"}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground truncate max-w-[300px]">
                      {f.errorDetail ?? "—"}
                    </TableCell>
                    <TableCell>
                      {f.resolved ? (
                        <span className="flex items-center gap-1 text-xs text-green-600 font-medium">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          Resolved
                        </span>
                      ) : (
                        <Badge variant="destructive" className="text-xs">Open</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground tabular-nums">
                      {new Date(f.createdAt).toLocaleString()}
                    </TableCell>
                    <TableCell>
                      {!f.resolved && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="min-h-[44px] text-xs"
                          disabled={resolveFailure.isPending}
                          onClick={() => resolveFailure.mutate({ failureId: f.id })}
                        >
                          {resolveFailure.isPending ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            "Resolve"
                          )}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>
              Showing {page * LIMIT + 1}–{Math.min((page + 1) * LIMIT, total)} of {total}
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page === 0}
                onClick={() => setPage(p => p - 1)}
                className="min-h-[44px]"
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages - 1}
                onClick={() => setPage(p => p + 1)}
                className="min-h-[44px]"
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}

function FailureTypeBadge({ type }: { type: string }) {
  const cls: Record<string, string> = {
    timeout:        "bg-amber-100 text-amber-700",
    crash:          "bg-red-100 text-red-700",
    protocol_error: "bg-purple-100 text-purple-700",
    state_invalid:  "bg-orange-100 text-orange-700",
  };
  return (
    <Badge variant="secondary" className={`text-xs ${cls[type] ?? ""}`}>
      {type || "unknown"}
    </Badge>
  );
}
