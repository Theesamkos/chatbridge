/**
 * Admin tRPC router (Task 6B.1, Phase 6B).
 *
 * All procedures require adminProcedure (role: admin only).
 */
import { TRPCError } from "@trpc/server";
import { and, count, desc, eq, gte, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { adminProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { writeAuditLog } from "../auditLog";
import { circuitBreaker } from "../circuitBreaker";
import {
  auditLogs,
  conversations,
  pluginFailures,
  pluginSchemas,
  users,
} from "../../drizzle/schema";

// ─── Pricing constants (Claude Sonnet) ───────────────────────────────────────

const INPUT_PRICE_PER_M  = 3;   // $3  per 1M input tokens
const OUTPUT_PRICE_PER_M = 15;  // $15 per 1M output tokens

// ─── Router ───────────────────────────────────────────────────────────────────

export const adminRouter = router({
  /**
   * All plugins with computed stats and circuit-breaker status.
   */
  getPlugins: adminProcedure
    .input(z.object({ status: z.enum(["active", "disabled", "suspended"]).optional() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const where = input.status ? eq(pluginSchemas.status, input.status) : undefined;

      const plugins = await db
        .select({
          id:          pluginSchemas.id,
          name:        pluginSchemas.name,
          description: pluginSchemas.description,
          origin:      pluginSchemas.origin,
          iframeUrl:   pluginSchemas.iframeUrl,
          status:      pluginSchemas.status,
          allowedRoles: pluginSchemas.allowedRoles,
          toolSchemas: pluginSchemas.toolSchemas,
          manifest:    pluginSchemas.manifest,
          createdAt:   pluginSchemas.createdAt,
          updatedAt:   pluginSchemas.updatedAt,
          activationCount: sql<number>`(
            SELECT COUNT(*) FROM audit_logs al
            WHERE al.pluginId = ${pluginSchemas.id}
            AND al.eventType = 'PLUGIN_ACTIVATED'
          )`,
          failureCount: sql<number>`(
            SELECT COUNT(*) FROM plugin_failures pf
            WHERE pf.pluginId = ${pluginSchemas.id}
          )`,
        })
        .from(pluginSchemas)
        .where(where)
        .orderBy(pluginSchemas.name);

      return {
        plugins: plugins.map(p => ({
          ...p,
          activationCount:    Number(p.activationCount),
          failureCount:       Number(p.failureCount),
          circuitBreakerActive: circuitBreaker.hasActiveBreaker(p.id),
        })),
      };
    }),

  /**
   * Update a plugin's status. If suspended, resets all active circuit breakers.
   */
  updatePluginStatus: adminProcedure
    .input(z.object({
      pluginId: z.string(),
      status:   z.enum(["active", "disabled", "suspended"]),
      reason:   z.string().min(1),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const [plugin] = await db
        .select({ id: pluginSchemas.id, status: pluginSchemas.status })
        .from(pluginSchemas)
        .where(eq(pluginSchemas.id, input.pluginId))
        .limit(1);

      if (!plugin) throw new TRPCError({ code: "NOT_FOUND", message: "Plugin not found" });

      const oldStatus = plugin.status;

      await db
        .update(pluginSchemas)
        .set({ status: input.status })
        .where(eq(pluginSchemas.id, input.pluginId));

      if (input.status === "suspended") {
        circuitBreaker.resetAllForPlugin(input.pluginId);
      }

      writeAuditLog({
        eventType: "plugin_status_changed",
        userId:    ctx.user.id,
        pluginId:  input.pluginId,
        payload: {
          pluginId:  input.pluginId,
          oldStatus,
          newStatus: input.status,
          reason:    input.reason,
          adminId:   ctx.user.id,
        },
        severity: input.status === "suspended" ? "warning" : "info",
      }).catch(err => console.error("[AuditLog]", err));

      return { success: true } as const;
    }),

  /**
   * Paginated, filterable audit log viewer.
   */
  getAuditLogs: adminProcedure
    .input(z.object({
      page:      z.number().int().min(0).optional().default(0),
      limit:     z.number().int().min(1).max(100).optional().default(20),
      eventType: z.string().optional(),
      userId:    z.number().int().optional(),
      dateFrom:  z.number().optional(),
      dateTo:    z.number().optional(),
      severity:  z.string().optional(),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const { page, limit, eventType, userId, dateFrom, dateTo, severity } = input;
      const offset = page * limit;

      const conditions = [];
      if (eventType) conditions.push(eq(auditLogs.eventType, eventType));
      if (userId)    conditions.push(eq(auditLogs.userId, userId));
      if (dateFrom)  conditions.push(gte(auditLogs.createdAt, new Date(dateFrom)));
      if (dateTo)    conditions.push(lte(auditLogs.createdAt, new Date(dateTo)));
      if (severity)  conditions.push(eq(auditLogs.severity, severity as "info" | "warning" | "error" | "critical"));

      const where = conditions.length > 0 ? and(...conditions) : undefined;

      const [totalRow] = await db
        .select({ total: count() })
        .from(auditLogs)
        .where(where);

      const logs = await db
        .select({
          id:             auditLogs.id,
          eventType:      auditLogs.eventType,
          conversationId: auditLogs.conversationId,
          pluginId:       auditLogs.pluginId,
          severity:       auditLogs.severity,
          payload:        auditLogs.payload,
          createdAt:      auditLogs.createdAt,
          userName:       users.name,
        })
        .from(auditLogs)
        .leftJoin(users, eq(auditLogs.userId, users.id))
        .where(where)
        .orderBy(desc(auditLogs.createdAt))
        .limit(limit)
        .offset(offset);

      return {
        logs,
        total: Number(totalRow?.total ?? 0),
        page,
      };
    }),

  /**
   * Paginated user list with conversation counts.
   */
  getUsers: adminProcedure
    .input(z.object({
      page:  z.number().int().min(0).optional().default(0),
      limit: z.number().int().min(1).max(100).optional().default(20),
      role:  z.enum(["student", "teacher", "admin"]).optional(),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const { page, limit, role } = input;
      const offset = page * limit;
      const where = role ? eq(users.role, role) : undefined;

      const [totalRow] = await db
        .select({ total: count() })
        .from(users)
        .where(where);

      const rows = await db
        .select({
          id:           users.id,
          name:         users.name,
          email:        users.email,
          role:         users.role,
          createdAt:    users.createdAt,
          lastSignedIn: users.lastSignedIn,
          conversationCount: sql<number>`(
            SELECT COUNT(*) FROM conversations c
            WHERE c.userId = ${users.id}
          )`,
        })
        .from(users)
        .where(where)
        .orderBy(desc(users.createdAt))
        .limit(limit)
        .offset(offset);

      return {
        users: rows.map(u => ({ ...u, conversationCount: Number(u.conversationCount) })),
        total: Number(totalRow?.total ?? 0),
        page,
      };
    }),

  /**
   * Update a user's role. Cannot demote yourself.
   */
  updateUserRole: adminProcedure
    .input(z.object({
      userId: z.number().int(),
      role:   z.enum(["student", "teacher", "admin"]),
      reason: z.string().min(1),
    }))
    .mutation(async ({ ctx, input }) => {
      if (input.userId === ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Cannot change your own role" });
      }

      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const [targetUser] = await db
        .select({ id: users.id, role: users.role })
        .from(users)
        .where(eq(users.id, input.userId))
        .limit(1);

      if (!targetUser) throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });

      const oldRole = targetUser.role;

      await db
        .update(users)
        .set({ role: input.role })
        .where(eq(users.id, input.userId));

      writeAuditLog({
        eventType: "user_role_changed",
        userId:    ctx.user.id,
        payload: {
          userId:  input.userId,
          oldRole,
          newRole: input.role,
          reason:  input.reason,
          adminId: ctx.user.id,
        },
        severity: "warning",
      }).catch(err => console.error("[AuditLog]", err));

      return { success: true } as const;
    }),

  /**
   * LLM cost metrics with projections.
   */
  getCostMetrics: adminProcedure
    .input(z.object({
      dateFrom: z.number().optional(),
      dateTo:   z.number().optional(),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const conditions = [eq(auditLogs.eventType, "llm_request_complete")];
      if (input.dateFrom) conditions.push(gte(auditLogs.createdAt, new Date(input.dateFrom)));
      if (input.dateTo)   conditions.push(lte(auditLogs.createdAt, new Date(input.dateTo)));

      const where = and(...conditions);

      const [totals] = await db
        .select({
          totalInputTokens:  sql<number>`COALESCE(SUM(CAST(JSON_UNQUOTE(JSON_EXTRACT(${auditLogs.payload}, '$.inputTokens')) AS UNSIGNED)), 0)`,
          totalOutputTokens: sql<number>`COALESCE(SUM(CAST(JSON_UNQUOTE(JSON_EXTRACT(${auditLogs.payload}, '$.outputTokens')) AS UNSIGNED)), 0)`,
          totalRequests:     count(),
        })
        .from(auditLogs)
        .where(where);

      const [userCountRow] = await db
        .select({ distinctUsers: sql<number>`COUNT(DISTINCT ${auditLogs.userId})` })
        .from(auditLogs)
        .where(where);

      const totalInputTokens  = Number(totals?.totalInputTokens  ?? 0);
      const totalOutputTokens = Number(totals?.totalOutputTokens ?? 0);
      const totalRequests     = Number(totals?.totalRequests     ?? 0);
      const distinctUsers     = Math.max(Number(userCountRow?.distinctUsers ?? 0), 1);

      const estimatedCostUSD =
        (totalInputTokens  / 1_000_000) * INPUT_PRICE_PER_M +
        (totalOutputTokens / 1_000_000) * OUTPUT_PRICE_PER_M;

      const avgTokensPerRequest =
        totalRequests > 0
          ? Math.round((totalInputTokens + totalOutputTokens) / totalRequests)
          : 0;

      const requestsPerUser = totalRequests / distinctUsers;
      const costPerUser     = estimatedCostUSD / distinctUsers;

      const project = (userCount: number) => ({
        users:          userCount,
        requests:       Math.round(requestsPerUser * userCount),
        inputTokens:    Math.round((totalInputTokens  / distinctUsers) * userCount),
        outputTokens:   Math.round((totalOutputTokens / distinctUsers) * userCount),
        estimatedCostUSD: parseFloat((costPerUser * userCount).toFixed(2)),
      });

      return {
        metrics: {
          totalInputTokens,
          totalOutputTokens,
          totalRequests,
          estimatedCostUSD: parseFloat(estimatedCostUSD.toFixed(4)),
          avgTokensPerRequest,
          projections: {
            per100Users:   project(100),
            per1KUsers:    project(1_000),
            per10KUsers:   project(10_000),
            per100KUsers:  project(100_000),
          },
        },
      };
    }),

  /**
   * Paginated plugin failure log.
   */
  getPluginFailures: adminProcedure
    .input(z.object({
      pluginId:  z.string().optional(),
      resolved:  z.boolean().optional(),
      page:      z.number().int().min(0).optional().default(0),
      limit:     z.number().int().min(1).max(100).optional().default(20),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const { page, limit } = input;
      const offset = page * limit;

      const conditions = [];
      if (input.pluginId !== undefined) conditions.push(eq(pluginFailures.pluginId, input.pluginId));
      if (input.resolved !== undefined) conditions.push(eq(pluginFailures.resolved, input.resolved));

      const where = conditions.length > 0 ? and(...conditions) : undefined;

      const [totalRow] = await db
        .select({ total: count() })
        .from(pluginFailures)
        .where(where);

      const failures = await db
        .select({
          id:             pluginFailures.id,
          pluginId:       pluginFailures.pluginId,
          pluginName:     pluginSchemas.name,
          conversationId: pluginFailures.conversationId,
          failureType:    pluginFailures.failureType,
          errorDetail:    pluginFailures.errorDetail,
          resolved:       pluginFailures.resolved,
          createdAt:      pluginFailures.createdAt,
        })
        .from(pluginFailures)
        .leftJoin(pluginSchemas, eq(pluginFailures.pluginId, pluginSchemas.id))
        .where(where)
        .orderBy(desc(pluginFailures.createdAt))
        .limit(limit)
        .offset(offset);

      return {
        failures,
        total: Number(totalRow?.total ?? 0),
        page,
      };
    }),

  /**
   * Mark a plugin failure as resolved.
   */
  resolvePluginFailure: adminProcedure
    .input(z.object({ failureId: z.string() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      await db
        .update(pluginFailures)
        .set({ resolved: true })
        .where(eq(pluginFailures.id, input.failureId));

      return { success: true } as const;
    }),
});
