/**
 * Audit Log Viewer — filterable, paginated audit log at /admin/audit.
 */
import DashboardLayout from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { Download, Loader2 } from "lucide-react";
import { useMemo, useState } from "react";
import { adminMenuItems } from "./AdminDashboard";

const EVENT_TYPES = [
  "plugin_status_changed",
  "user_role_changed",
  "llm_request_complete",
  "PLUGIN_ACTIVATED",
  "PLUGIN_READY",
  "TOOL_INVOKE",
  "TOOL_RESULT",
  "STATE_UPDATE",
  "PLUGIN_COMPLETE",
  "PLUGIN_ERROR",
  "INPUT_BLOCKED",
  "OUTPUT_FLAGGED",
  "INJECTION_DETECTED",
  "CIRCUIT_OPEN",
  "RATE_LIMITED",
  "AUTH_FAILURE",
  "PROTOCOL_VIOLATION",
];

const SEVERITIES = ["info", "warning", "error", "critical"];

export default function AuditLogViewer() {
  const [page, setPage] = useState(0);
  const [eventType, setEventType] = useState<string>("");
  const [severity, setSeverity] = useState<string>("");
  const [userSearch, setUserSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const LIMIT = 20;

  const queryInput = useMemo(() => ({
    page,
    limit: LIMIT,
    eventType:  eventType  || undefined,
    severity:   severity   || undefined,
    dateFrom:   dateFrom   ? new Date(dateFrom).getTime()  : undefined,
    dateTo:     dateTo     ? new Date(dateTo).getTime()    : undefined,
  }), [page, eventType, severity, dateFrom, dateTo]);

  const { data, isLoading } = trpc.admin.getAuditLogs.useQuery(queryInput);

  const logs = data?.logs ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / LIMIT);

  // Client-side user name filter (applied after fetch)
  const filtered = userSearch.trim()
    ? logs.filter(l => l.userName?.toLowerCase().includes(userSearch.toLowerCase()))
    : logs;

  const handleExportCSV = () => {
    const rows = [
      ["Timestamp", "Event Type", "Severity", "User", "Plugin", "Payload"],
      ...filtered.map(l => [
        new Date(l.createdAt).toISOString(),
        l.eventType,
        l.severity,
        l.userName ?? "",
        l.pluginId ?? "",
        JSON.stringify(l.payload),
      ]),
    ];
    const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = `audit-logs-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const resetFilters = () => {
    setPage(0);
    setEventType("");
    setSeverity("");
    setUserSearch("");
    setDateFrom("");
    setDateTo("");
  };

  return (
    <DashboardLayout menuItems={adminMenuItems}>
      <div className="max-w-7xl mx-auto space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Audit Logs</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Full audit trail of all platform events.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={handleExportCSV} className="min-h-[44px] gap-2">
            <Download className="h-4 w-4" />
            Export CSV
          </Button>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-3 items-end">
          <div className="w-[200px]">
            <Select value={eventType} onValueChange={v => { setEventType(v === "all" ? "" : v); setPage(0); }}>
              <SelectTrigger className="min-h-[44px]">
                <SelectValue placeholder="Event type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All events</SelectItem>
                {EVENT_TYPES.map(t => (
                  <SelectItem key={t} value={t}>{t}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="w-[150px]">
            <Select value={severity} onValueChange={v => { setSeverity(v === "all" ? "" : v); setPage(0); }}>
              <SelectTrigger className="min-h-[44px]">
                <SelectValue placeholder="Severity" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All severity</SelectItem>
                {SEVERITIES.map(s => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Input
            placeholder="Search user…"
            value={userSearch}
            onChange={e => setUserSearch(e.target.value)}
            className="w-[160px] min-h-[44px]"
          />

          <div className="flex items-center gap-2">
            <Input
              type="date"
              value={dateFrom}
              onChange={e => { setDateFrom(e.target.value); setPage(0); }}
              className="w-[160px] min-h-[44px]"
            />
            <span className="text-muted-foreground text-sm">to</span>
            <Input
              type="date"
              value={dateTo}
              onChange={e => { setDateTo(e.target.value); setPage(0); }}
              className="w-[160px] min-h-[44px]"
            />
          </div>

          {(eventType || severity || userSearch || dateFrom || dateTo) && (
            <Button variant="ghost" size="sm" onClick={resetFilters} className="min-h-[44px]">
              Clear
            </Button>
          )}
        </div>

        {/* Table */}
        {isLoading ? (
          <div className="flex items-center gap-2 text-muted-foreground py-8">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-sm">Loading logs…</span>
          </div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[180px]">Timestamp</TableHead>
                  <TableHead className="w-[220px]">Event Type</TableHead>
                  <TableHead className="w-[100px]">Severity</TableHead>
                  <TableHead className="w-[140px]">User</TableHead>
                  <TableHead className="w-[120px]">Plugin</TableHead>
                  <TableHead>Payload Preview</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                      No logs found.
                    </TableCell>
                  </TableRow>
                )}
                {filtered.map(log => {
                  const isExpanded = expandedId === log.id;
                  const payloadStr = JSON.stringify(log.payload);
                  return (
                    <>
                      <TableRow
                        key={log.id}
                        className="cursor-pointer hover:bg-muted/40"
                        onClick={() => setExpandedId(isExpanded ? null : log.id)}
                      >
                        <TableCell className="text-xs font-mono tabular-nums whitespace-nowrap">
                          {new Date(log.createdAt).toLocaleString()}
                        </TableCell>
                        <TableCell className="font-mono text-xs">{log.eventType}</TableCell>
                        <TableCell><SeverityBadge severity={log.severity} /></TableCell>
                        <TableCell className="text-sm">{log.userName ?? <span className="text-muted-foreground">—</span>}</TableCell>
                        <TableCell className="text-xs font-mono">{log.pluginId ?? <span className="text-muted-foreground">—</span>}</TableCell>
                        <TableCell className="text-xs text-muted-foreground truncate max-w-[300px]">
                          {payloadStr.length > 80 ? payloadStr.slice(0, 80) + "…" : payloadStr}
                        </TableCell>
                      </TableRow>
                      {isExpanded && (
                        <TableRow key={`${log.id}-detail`} className="bg-muted/20">
                          <TableCell colSpan={6} className="px-6 py-3">
                            <pre className="text-xs bg-muted rounded p-3 overflow-x-auto max-h-48">
                              {JSON.stringify(log.payload, null, 2)}
                            </pre>
                          </TableCell>
                        </TableRow>
                      )}
                    </>
                  );
                })}
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

function SeverityBadge({ severity }: { severity: string }) {
  const cls: Record<string, string> = {
    info:     "bg-blue-100 text-blue-700",
    warning:  "bg-amber-100 text-amber-700",
    error:    "bg-red-100 text-red-700",
    critical: "bg-red-600 text-white",
  };
  return (
    <Badge variant="secondary" className={`text-xs ${cls[severity] ?? ""}`}>
      {severity}
    </Badge>
  );
}
