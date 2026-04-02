/**
 * User Management — paginated user list with role editing at /admin/users.
 */
import DashboardLayout from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { Loader2 } from "lucide-react";
import { useMemo, useState } from "react";
import { adminMenuItems } from "./AdminDashboard";

type Role = "student" | "teacher" | "admin";

interface DialogState {
  userId: number;
  userName: string;
  currentRole: Role;
  newRole: Role;
  reason: string;
}

const LIMIT = 20;

export default function UserManagement() {
  const utils = trpc.useUtils();
  const [page, setPage] = useState(0);
  const [roleFilter, setRoleFilter] = useState<string>("");
  const [dialog, setDialog] = useState<DialogState | null>(null);

  const queryInput = useMemo(() => ({
    page,
    limit: LIMIT,
    role: (roleFilter || undefined) as Role | undefined,
  }), [page, roleFilter]);

  const { data, isLoading } = trpc.admin.getUsers.useQuery(queryInput);

  const updateRole = trpc.admin.updateUserRole.useMutation({
    onSuccess: () => {
      utils.admin.getUsers.invalidate();
      setDialog(null);
    },
  });

  const users     = data?.users ?? [];
  const total     = data?.total ?? 0;
  const totalPages = Math.ceil(total / LIMIT);

  const openDialog = (userId: number, userName: string, currentRole: Role) => {
    setDialog({ userId, userName, currentRole, newRole: currentRole, reason: "" });
  };

  return (
    <DashboardLayout menuItems={adminMenuItems}>
      <div className="max-w-6xl mx-auto space-y-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">User Management</h1>
          <p className="text-sm text-muted-foreground mt-1">
            View all platform users and update their roles.
          </p>
        </div>

        {/* Filters */}
        <div className="flex gap-3 items-center">
          <Select value={roleFilter} onValueChange={v => { setRoleFilter(v === "all" ? "" : v); setPage(0); }}>
            <SelectTrigger className="w-[160px] min-h-[44px]">
              <SelectValue placeholder="All roles" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All roles</SelectItem>
              <SelectItem value="student">Student</SelectItem>
              <SelectItem value="teacher">Teacher</SelectItem>
              <SelectItem value="admin">Admin</SelectItem>
            </SelectContent>
          </Select>
          <span className="text-sm text-muted-foreground">{total} total</span>
        </div>

        {/* Table */}
        {isLoading ? (
          <div className="flex items-center gap-2 text-muted-foreground py-8">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-sm">Loading users…</span>
          </div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[200px]">Name</TableHead>
                  <TableHead className="w-[240px]">Email</TableHead>
                  <TableHead className="w-[100px]">Role</TableHead>
                  <TableHead className="w-[100px] text-right">Conversations</TableHead>
                  <TableHead className="w-[160px]">Last Sign-in</TableHead>
                  <TableHead className="w-[160px]">Joined</TableHead>
                  <TableHead className="w-[100px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                      No users found.
                    </TableCell>
                  </TableRow>
                )}
                {users.map(u => (
                  <TableRow key={u.id}>
                    <TableCell className="font-medium">{u.name}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{u.email}</TableCell>
                    <TableCell><RoleBadge role={u.role} /></TableCell>
                    <TableCell className="text-right tabular-nums">{u.conversationCount}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {u.lastSignedIn ? new Date(u.lastSignedIn).toLocaleDateString() : "—"}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(u.createdAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="outline"
                        size="sm"
                        className="min-h-[44px] text-xs"
                        onClick={() => openDialog(u.id, u.name ?? "", u.role as Role)}
                      >
                        Edit Role
                      </Button>
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

      {/* Edit role dialog */}
      <Dialog open={dialog !== null} onOpenChange={open => !open && setDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Role: {dialog?.userName}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              Current role: <strong>{dialog?.currentRole}</strong>
            </p>
            <div className="space-y-2">
              <label className="text-sm font-medium">New Role</label>
              <Select
                value={dialog?.newRole}
                onValueChange={v =>
                  setDialog(prev => prev ? { ...prev, newRole: v as Role } : null)
                }
              >
                <SelectTrigger className="min-h-[44px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="student">Student</SelectItem>
                  <SelectItem value="teacher">Teacher</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">
                Reason <span className="text-red-500">*</span>
              </label>
              <Input
                placeholder="Enter a reason for this role change…"
                value={dialog?.reason ?? ""}
                onChange={e =>
                  setDialog(prev => prev ? { ...prev, reason: e.target.value } : null)
                }
                className="min-h-[44px]"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDialog(null)}
              className="min-h-[44px]"
            >
              Cancel
            </Button>
            <Button
              disabled={
                !dialog?.reason.trim() ||
                dialog?.newRole === dialog?.currentRole ||
                updateRole.isPending
              }
              onClick={() => {
                if (dialog && dialog.reason.trim() && dialog.newRole !== dialog.currentRole) {
                  updateRole.mutate({
                    userId: dialog.userId,
                    role:   dialog.newRole,
                    reason: dialog.reason,
                  });
                }
              }}
              className="min-h-[44px]"
            >
              {updateRole.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}

function RoleBadge({ role }: { role: string }) {
  if (role === "admin")   return <Badge variant="destructive" className="text-xs">Admin</Badge>;
  if (role === "teacher") return <Badge variant="secondary"  className="text-xs text-purple-700 bg-purple-100">Teacher</Badge>;
  return <Badge variant="outline" className="text-xs">Student</Badge>;
}
