/**
 * Student Sessions — paginated list of all student conversations.
 * Route: /teacher/sessions
 */
import DashboardLayout from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { trpc } from "@/lib/trpc";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { teacherMenuItems } from "./TeacherDashboard";

const PAGE_SIZE = 20;

export default function StudentSessions() {
  const [, setLocation] = useLocation();
  const [page, setPage] = useState(0);

  const queryInput = useMemo(() => ({ page, limit: PAGE_SIZE }), [page]);

  const { data, isLoading } = trpc.teacher.getStudentSessions.useQuery(queryInput);

  const sessions = data?.sessions ?? [];
  const total    = data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <DashboardLayout menuItems={teacherMenuItems}>
      <div className="max-w-5xl mx-auto space-y-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Student Sessions</h1>
          <p className="text-sm text-muted-foreground mt-1">
            All student conversations — click a row to view the full log.
          </p>
        </div>

        {isLoading ? (
          <div className="flex items-center gap-2 text-muted-foreground py-8">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-sm">Loading sessions…</span>
          </div>
        ) : (
          <>
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Student</TableHead>
                    <TableHead>Plugin</TableHead>
                    <TableHead className="text-right">Messages</TableHead>
                    <TableHead className="text-right">Safety Events</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Last Activity</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sessions.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                        No sessions found.
                      </TableCell>
                    </TableRow>
                  )}
                  {sessions.map(s => (
                    <TableRow
                      key={s.conversationId}
                      className="cursor-pointer hover:bg-muted/40"
                      onClick={() => setLocation(`/teacher/sessions/${s.conversationId}`)}
                    >
                      <TableCell className="font-medium">{s.studentName ?? "—"}</TableCell>
                      <TableCell>
                        {s.activePlugin ? (
                          <Badge variant="secondary" className="text-xs">{s.activePlugin}</Badge>
                        ) : (
                          <span className="text-muted-foreground text-xs">None</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{s.messageCount}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {s.safetyEventCount > 0 ? (
                          <Badge variant="destructive" className="text-xs">{s.safetyEventCount}</Badge>
                        ) : (
                          <span className="text-muted-foreground">0</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={s.status} />
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {s.lastActivity ? new Date(s.lastActivity).toLocaleString() : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* Pagination */}
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span>
                {total === 0 ? "0 sessions" : `${page * PAGE_SIZE + 1}–${Math.min((page + 1) * PAGE_SIZE, total)} of ${total}`}
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage(p => Math.max(0, p - 1))}
                  disabled={page === 0}
                  className="min-h-[44px] min-w-[44px]"
                  aria-label="Previous page"
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span>Page {page + 1} of {pageCount}</span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage(p => Math.min(pageCount - 1, p + 1))}
                  disabled={page >= pageCount - 1}
                  className="min-h-[44px] min-w-[44px]"
                  aria-label="Next page"
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </>
        )}
      </div>
    </DashboardLayout>
  );
}

function StatusBadge({ status }: { status: string }) {
  if (status === "frozen") return <Badge variant="destructive" className="text-xs">Frozen</Badge>;
  if (status === "active")  return <Badge variant="secondary"  className="text-xs">Active</Badge>;
  return <Badge variant="outline" className="text-xs">{status}</Badge>;
}
