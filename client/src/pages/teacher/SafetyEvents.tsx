/**
 * Safety Events — paginated list with review workflow.
 * Route: /teacher/safety
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
import { CheckCircle, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { teacherMenuItems } from "./TeacherDashboard";

const PAGE_SIZE = 20;

export default function SafetyEvents() {
  const [, setLocation] = useLocation();
  const [page, setPage] = useState(0);
  const [reviewedFilter, setReviewedFilter] = useState<"all" | "reviewed" | "unreviewed">("all");
  const utils = trpc.useUtils();

  const queryInput = useMemo(() => ({
    page,
    limit: PAGE_SIZE,
    reviewed: reviewedFilter === "all" ? undefined : reviewedFilter === "reviewed",
  }), [page, reviewedFilter]);

  const { data, isLoading } = trpc.teacher.getSafetyEvents.useQuery(queryInput);

  const markReviewed = trpc.teacher.markSafetyEventReviewed.useMutation({
    onSuccess: () => utils.teacher.getSafetyEvents.invalidate(),
  });

  const events    = data?.events ?? [];
  const total     = data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <DashboardLayout menuItems={teacherMenuItems}>
      <div className="max-w-5xl mx-auto space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Safety Events</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Content moderation events — review and mark as resolved.
            </p>
          </div>
          <Select
            value={reviewedFilter}
            onValueChange={v => {
              setReviewedFilter(v as "all" | "reviewed" | "unreviewed");
              setPage(0);
            }}
          >
            <SelectTrigger className="w-40 min-h-[44px]">
              <SelectValue placeholder="Filter" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="unreviewed">Unreviewed</SelectItem>
              <SelectItem value="reviewed">Reviewed</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {isLoading ? (
          <div className="flex items-center gap-2 text-muted-foreground py-8">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-sm">Loading events…</span>
          </div>
        ) : (
          <>
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Student</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Content Preview</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>Time</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-[44px]" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {events.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                        No safety events found.
                      </TableCell>
                    </TableRow>
                  )}
                  {events.map(evt => (
                    <TableRow key={evt.id} className={evt.reviewed ? "opacity-60" : undefined}>
                      <TableCell
                        className="font-medium cursor-pointer hover:underline"
                        onClick={() => evt.conversationId && setLocation(`/teacher/sessions/${evt.conversationId}`)}
                      >
                        {evt.studentName ?? "—"}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs font-mono">{evt.eventType}</Badge>
                      </TableCell>
                      <TableCell className="max-w-xs">
                        <span className="text-xs text-muted-foreground line-clamp-2 break-all">
                          {evt.triggerContent}
                        </span>
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="text-xs">{evt.action}</Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                        {new Date(evt.createdAt).toLocaleString()}
                      </TableCell>
                      <TableCell>
                        {evt.reviewed
                          ? <Badge variant="secondary" className="text-xs">Reviewed</Badge>
                          : <Badge variant="destructive" className="text-xs">Pending</Badge>
                        }
                      </TableCell>
                      <TableCell>
                        {!evt.reviewed && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => markReviewed.mutate({ eventId: evt.id })}
                            disabled={markReviewed.isPending}
                            className="min-h-[44px] min-w-[44px]"
                            aria-label="Mark as reviewed"
                          >
                            <CheckCircle className="h-4 w-4 text-green-500" />
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* Pagination */}
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span>
                {total === 0 ? "0 events" : `${page * PAGE_SIZE + 1}–${Math.min((page + 1) * PAGE_SIZE, total)} of ${total}`}
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
