/**
 * Plugin Management — enable/disable/suspend plugins with required reason.
 * Route: /admin/plugins
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { trpc } from "@/lib/trpc";
import { ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { useState } from "react";
import { adminMenuItems } from "./AdminDashboard";

type Action = "active" | "disabled" | "suspended";

interface DialogState {
  pluginId: string;
  pluginName: string;
  action: Action;
  reason: string;
}

export default function PluginManagement() {
  const utils = trpc.useUtils();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogState | null>(null);

  const { data, isLoading } = trpc.admin.getPlugins.useQuery({});
  const updateStatus = trpc.admin.updatePluginStatus.useMutation({
    onSuccess: () => {
      utils.admin.getPlugins.invalidate();
      setDialog(null);
    },
  });

  const plugins = data?.plugins ?? [];

  const openDialog = (pluginId: string, pluginName: string, action: Action) => {
    setDialog({ pluginId, pluginName, action, reason: "" });
  };

  return (
    <DashboardLayout menuItems={adminMenuItems}>
      <div className="max-w-5xl mx-auto space-y-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Plugin Management</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Enable, disable, or suspend plugins. All actions require a reason.
          </p>
        </div>

        {isLoading ? (
          <div className="flex items-center gap-2 text-muted-foreground py-8">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-sm">Loading plugins…</span>
          </div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead className="w-[200px]">Name</TableHead>
                  <TableHead className="w-[110px]">Status</TableHead>
                  <TableHead className="w-[100px] text-right">Activations</TableHead>
                  <TableHead className="w-[100px] text-right">Failures</TableHead>
                  <TableHead className="w-[120px] text-right">Failure Rate</TableHead>
                  <TableHead className="w-[120px]">Circuit Breaker</TableHead>
                  <TableHead className="w-[200px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {plugins.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                      No plugins found.
                    </TableCell>
                  </TableRow>
                )}
                {plugins.map(p => {
                  const failureRate =
                    p.activationCount > 0
                      ? Math.round((p.failureCount / p.activationCount) * 100)
                      : 0;
                  const isExpanded = expanded === p.id;

                  return (
                    <>
                      <TableRow
                        key={p.id}
                        className={p.status === "suspended" ? "bg-red-50 dark:bg-red-950/20" : undefined}
                      >
                        <TableCell>
                          <button
                            onClick={() => setExpanded(isExpanded ? null : p.id)}
                            className="min-h-[44px] min-w-[44px] flex items-center justify-center"
                            aria-label={isExpanded ? "Collapse" : "Expand"}
                          >
                            {isExpanded
                              ? <ChevronDown className="h-4 w-4 text-muted-foreground" />
                              : <ChevronRight className="h-4 w-4 text-muted-foreground" />
                            }
                          </button>
                        </TableCell>
                        <TableCell className="font-medium">{p.name}</TableCell>
                        <TableCell><StatusBadge status={p.status} /></TableCell>
                        <TableCell className="text-right tabular-nums">{p.activationCount}</TableCell>
                        <TableCell className="text-right tabular-nums">{p.failureCount}</TableCell>
                        <TableCell className="text-right">
                          <span className={failureRate > 20 ? "text-red-500 font-medium" : ""}>
                            {failureRate}%
                          </span>
                        </TableCell>
                        <TableCell>
                          {p.circuitBreakerActive ? (
                            <Badge variant="destructive" className="text-xs">Open</Badge>
                          ) : (
                            <span className="text-xs text-green-600 font-medium">Closed</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            {p.status !== "active" && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => openDialog(p.id, p.name, "active")}
                                className="min-h-[44px] text-xs"
                              >
                                Enable
                              </Button>
                            )}
                            {p.status === "active" && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => openDialog(p.id, p.name, "disabled")}
                                className="min-h-[44px] text-xs"
                              >
                                Disable
                              </Button>
                            )}
                            {p.status !== "suspended" && (
                              <Button
                                variant="destructive"
                                size="sm"
                                onClick={() => openDialog(p.id, p.name, "suspended")}
                                className="min-h-[44px] text-xs"
                              >
                                Suspend
                              </Button>
                            )}
                            {p.status === "suspended" && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => openDialog(p.id, p.name, "active")}
                                className="min-h-[44px] text-xs border-green-500 text-green-600 hover:bg-green-50"
                              >
                                Restore
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>

                      {/* Expanded detail row */}
                      {isExpanded && (
                        <TableRow key={`${p.id}-detail`} className="bg-muted/20">
                          <TableCell colSpan={8} className="px-6 py-4">
                            <div className="grid gap-4 text-sm">
                              <div>
                                <p className="font-medium mb-1">Tool Schemas</p>
                                <pre className="text-xs bg-muted rounded p-3 overflow-x-auto max-h-40">
                                  {JSON.stringify(p.toolSchemas, null, 2)}
                                </pre>
                              </div>
                              <div>
                                <p className="font-medium mb-1">Manifest</p>
                                <pre className="text-xs bg-muted rounded p-3 overflow-x-auto max-h-40">
                                  {JSON.stringify(p.manifest, null, 2)}
                                </pre>
                              </div>
                              <div className="text-xs text-muted-foreground">
                                <span className="font-medium">Origin:</span> {p.origin} ·{" "}
                                <span className="font-medium">iframe:</span> {p.iframeUrl} ·{" "}
                                <span className="font-medium">Roles:</span>{" "}
                                {(p.allowedRoles as string[]).join(", ")}
                              </div>
                            </div>
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

        {/* Confirmation dialog */}
        <Dialog open={dialog !== null} onOpenChange={open => !open && setDialog(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {dialog?.action === "active"    ? "Enable" :
                 dialog?.action === "disabled"  ? "Disable" : "Suspend"}{" "}
                Plugin: {dialog?.pluginName}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <p className="text-sm text-muted-foreground">
                {dialog?.action === "suspended"
                  ? "This will immediately suspend the plugin and reset all active circuit breakers. Students will lose access."
                  : `This will ${dialog?.action === "active" ? "re-enable" : "disable"} the plugin for all users.`
                }
              </p>
              <div className="space-y-2">
                <label className="text-sm font-medium">
                  Reason <span className="text-red-500">*</span>
                </label>
                <Input
                  placeholder="Enter a reason for this action…"
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
                variant={dialog?.action === "suspended" ? "destructive" : "default"}
                disabled={!dialog?.reason.trim() || updateStatus.isPending}
                onClick={() => {
                  if (dialog && dialog.reason.trim()) {
                    updateStatus.mutate({
                      pluginId: dialog.pluginId,
                      status:   dialog.action,
                      reason:   dialog.reason,
                    });
                  }
                }}
                className="min-h-[44px]"
              >
                {updateStatus.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Confirm
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}

function StatusBadge({ status }: { status: string }) {
  if (status === "active")    return <Badge variant="secondary"  className="text-xs text-green-700 bg-green-100">Active</Badge>;
  if (status === "suspended") return <Badge variant="destructive" className="text-xs">Suspended</Badge>;
  return <Badge variant="outline" className="text-xs">Disabled</Badge>;
}
