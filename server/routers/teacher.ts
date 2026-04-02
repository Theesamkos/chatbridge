/**
 * Teacher tRPC router (Task 6A.1, Phase 6A).
 *
 * All procedures require teacherProcedure (role: teacher | admin).
 * Teachers can read any student's data but cannot modify student content.
 */
import { TRPCError } from "@trpc/server";
import { nanoid } from "nanoid";
import { and, count, desc, eq, gte, isNotNull, isNull, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { teacherProcedure, router } from "../_core/trpc";
import { getDb, unfreezeConversation } from "../db";
import { writeAuditLog } from "../auditLog";
import {
  auditLogs,
  conversations,
  messages,
  pluginSchemas,
  pluginStates,
  safetyEvents,
  users,
} from "../../drizzle/schema";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Truncate trigger content to 200 chars with indicator (Task 6A.1 spec). */
function truncateTrigger(content: string): string {
  if (content.length <= 200) return content;
  return content.slice(0, 200) + "…";
}

// ─── Router ───────────────────────────────────────────────────────────────────

export const teacherRouter = router({
  /**
   * Paginated list of all student conversations with metadata.
   */
  getStudentSessions: teacherProcedure
    .input(
      z.object({
        page:     z.number().int().min(0).optional().default(0),
        limit:    z.number().int().min(1).max(100).optional().default(20),
        dateFrom: z.number().optional(),
        dateTo:   z.number().optional(),
      }),
    )
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const { page, limit, dateFrom, dateTo } = input;
      const offset = page * limit;

      const conditions = [eq(users.role, "student")];
      if (dateFrom) conditions.push(gte(conversations.updatedAt, new Date(dateFrom)));
      if (dateTo)   conditions.push(lte(conversations.updatedAt, new Date(dateTo)));

      const whereClause = conditions.length === 1 ? conditions[0] : and(...conditions);

      // Total count
      const [totalRow] = await db
        .select({ total: count() })
        .from(conversations)
        .innerJoin(users, eq(conversations.userId, users.id))
        .where(whereClause);

      // Main query with message count and safety event count via subqueries
      const sessions = await db
        .select({
          conversationId:  conversations.id,
          studentName:     users.name,
          studentId:       conversations.userId,
          activePlugin:    conversations.activePluginId,
          lastActivity:    conversations.updatedAt,
          status:          conversations.status,
          messageCount:    sql<number>`(
            SELECT COUNT(*) FROM messages m
            WHERE m.conversationId = ${conversations.id}
          )`,
          safetyEventCount: sql<number>`(
            SELECT COUNT(*) FROM safety_events se
            WHERE se.conversationId = ${conversations.id}
          )`,
        })
        .from(conversations)
        .innerJoin(users, eq(conversations.userId, users.id))
        .where(whereClause)
        .orderBy(desc(conversations.updatedAt))
        .limit(limit)
        .offset(offset);

      return {
        sessions: sessions.map(s => ({
          ...s,
          messageCount:     Number(s.messageCount),
          safetyEventCount: Number(s.safetyEventCount),
        })),
        total: Number(totalRow?.total ?? 0),
        page,
      };
    }),

  /**
   * Full conversation log for a single conversation (teachers read all student convos).
   */
  getConversationLog: teacherProcedure
    .input(z.object({ conversationId: z.string() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      // Load conversation + student info
      const [conv] = await db
        .select({
          id:            conversations.id,
          status:        conversations.status,
          activePluginId: conversations.activePluginId,
          createdAt:     conversations.createdAt,
          updatedAt:     conversations.updatedAt,
          studentName:   users.name,
          studentId:     conversations.userId,
          title:         conversations.title,
        })
        .from(conversations)
        .innerJoin(users, eq(conversations.userId, users.id))
        .where(eq(conversations.id, input.conversationId))
        .limit(1);

      if (!conv) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Conversation not found" });
      }

      // All messages — teachers see everything including tool messages
      const msgs = await db
        .select({
          id:               messages.id,
          role:             messages.role,
          content:          messages.content,
          toolName:         messages.toolName,
          moderationStatus: messages.moderationStatus,
          createdAt:        messages.createdAt,
        })
        .from(messages)
        .where(eq(messages.conversationId, input.conversationId))
        .orderBy(messages.createdAt);

      // Plugin state snapshots for this conversation
      const states = await db
        .select({
          pluginId:  pluginStates.pluginId,
          state:     pluginStates.state,
          version:   pluginStates.version,
          createdAt: pluginStates.createdAt,
        })
        .from(pluginStates)
        .where(eq(pluginStates.conversationId, input.conversationId))
        .orderBy(pluginStates.createdAt);

      return {
        conversation: conv,
        messages:     msgs,
        pluginStates: states,
      };
    }),

  /**
   * Paginated safety events with truncated trigger content.
   */
  getSafetyEvents: teacherProcedure
    .input(
      z.object({
        page:      z.number().int().min(0).optional().default(0),
        limit:     z.number().int().min(1).max(100).optional().default(20),
        severity:  z.string().optional(),
        reviewed:  z.boolean().optional(),
      }),
    )
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const { page, limit, reviewed } = input;
      const offset = page * limit;

      const conditions: ReturnType<typeof eq>[] = [];
      if (reviewed === true)  conditions.push(isNotNull(safetyEvents.reviewedBy) as never);
      if (reviewed === false) conditions.push(isNull(safetyEvents.reviewedBy) as never);

      const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

      const [totalRow] = await db
        .select({ total: count() })
        .from(safetyEvents)
        .where(whereClause);

      const events = await db
        .select({
          id:             safetyEvents.id,
          studentName:    users.name,
          studentId:      safetyEvents.userId,
          conversationId: safetyEvents.conversationId,
          eventType:      safetyEvents.eventType,
          triggerContent: safetyEvents.triggerContent,
          action:         safetyEvents.action,
          createdAt:      safetyEvents.createdAt,
          reviewedBy:     safetyEvents.reviewedBy,
        })
        .from(safetyEvents)
        .innerJoin(users, eq(safetyEvents.userId, users.id))
        .where(whereClause)
        .orderBy(desc(safetyEvents.createdAt))
        .limit(limit)
        .offset(offset);

      return {
        events: events.map(e => ({
          ...e,
          triggerContent: truncateTrigger(e.triggerContent),
          reviewed:       e.reviewedBy !== null,
        })),
        total: Number(totalRow?.total ?? 0),
        page,
      };
    }),

  /**
   * Mark a safety event as reviewed.
   */
  markSafetyEventReviewed: teacherProcedure
    .input(z.object({ eventId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      await db
        .update(safetyEvents)
        .set({ reviewedBy: ctx.user.id })
        .where(eq(safetyEvents.id, input.eventId));

      return { success: true } as const;
    }),

  /**
   * Unfreeze a frozen conversation with a required reason.
   */
  unfreezeSession: teacherProcedure
    .input(z.object({ conversationId: z.string(), reason: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const [conv] = await db
        .select({ id: conversations.id, status: conversations.status })
        .from(conversations)
        .where(eq(conversations.id, input.conversationId))
        .limit(1);

      if (!conv) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Conversation not found" });
      }
      if (conv.status !== "frozen") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Conversation is not frozen" });
      }

      await unfreezeConversation(input.conversationId);

      writeAuditLog({
        eventType:      "SESSION_UNFROZEN",
        userId:         ctx.user.id,
        conversationId: input.conversationId,
        payload: {
          reason:    input.reason,
          teacherId: ctx.user.id,
        },
        severity: "info",
      }).catch(err => console.error("[AuditLog]", err));

      return { success: true } as const;
    }),

  /**
   * Plugin usage statistics aggregated from audit_logs.
   */
  getPluginUsageStats: teacherProcedure
    .input(
      z.object({
        dateFrom: z.number().optional(),
        dateTo:   z.number().optional(),
      }),
    )
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const conditions = [isNotNull(auditLogs.pluginId)];
      if (input.dateFrom) conditions.push(gte(auditLogs.createdAt, new Date(input.dateFrom)));
      if (input.dateTo)   conditions.push(lte(auditLogs.createdAt, new Date(input.dateTo)));

      const whereClause = and(...conditions);

      const stats = await db
        .select({
          pluginId:        auditLogs.pluginId,
          activationCount: sql<number>`SUM(CASE WHEN ${auditLogs.eventType} = 'PLUGIN_ACTIVATED' THEN 1 ELSE 0 END)`,
          completionCount: sql<number>`SUM(CASE WHEN ${auditLogs.eventType} = 'PLUGIN_COMPLETE' THEN 1 ELSE 0 END)`,
          failureCount:    sql<number>`SUM(CASE WHEN ${auditLogs.eventType} = 'CIRCUIT_OPEN' OR ${auditLogs.eventType} = 'PLUGIN_ERROR' THEN 1 ELSE 0 END)`,
        })
        .from(auditLogs)
        .where(whereClause)
        .groupBy(auditLogs.pluginId);

      // Fetch plugin names
      const schemas = await db.select({ id: pluginSchemas.id, name: pluginSchemas.name }).from(pluginSchemas);
      const nameMap = new Map(schemas.map(s => [s.id, s.name]));

      return {
        stats: stats
          .filter(s => s.pluginId !== null)
          .map(s => ({
            pluginId:        s.pluginId!,
            pluginName:      nameMap.get(s.pluginId!) ?? s.pluginId!,
            activationCount: Number(s.activationCount),
            completionCount: Number(s.completionCount),
            failureCount:    Number(s.failureCount),
            failureRate:
              Number(s.activationCount) > 0
                ? Math.round((Number(s.failureCount) / Number(s.activationCount)) * 100)
                : 0,
          })),
      };
    }),

  /**
   * Aggregate class summary stats for the overview card row.
   */
  getClassSummary: teacherProcedure.query(async () => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1_000);

    const [studentCount] = await db
      .select({ total: count() })
      .from(users)
      .where(eq(users.role, "student"));

    const [activeConvs] = await db
      .select({ total: count() })
      .from(conversations)
      .innerJoin(users, eq(conversations.userId, users.id))
      .where(and(eq(conversations.status, "active"), eq(users.role, "student")));

    const [safetyCount] = await db
      .select({ total: count() })
      .from(safetyEvents)
      .where(gte(safetyEvents.createdAt, oneDayAgo));

    // Most-used plugin (by activation count in audit_logs)
    const [topPlugin] = await db
      .select({
        pluginId: auditLogs.pluginId,
        cnt:      count(),
      })
      .from(auditLogs)
      .where(and(isNotNull(auditLogs.pluginId), eq(auditLogs.eventType, "PLUGIN_ACTIVATED")))
      .groupBy(auditLogs.pluginId)
      .orderBy(desc(count()))
      .limit(1);

    const topPluginName = topPlugin?.pluginId
      ? await db
          .select({ name: pluginSchemas.name })
          .from(pluginSchemas)
          .where(eq(pluginSchemas.id, topPlugin.pluginId))
          .limit(1)
          .then(rows => rows[0]?.name ?? topPlugin.pluginId)
      : null;

    // Avg messages per session
    const [avgRow] = await db
      .select({
        avg: sql<number>`AVG(msg_counts.cnt)`,
      })
      .from(
        db
          .select({
            conversationId: messages.conversationId,
            cnt:            sql<number>`COUNT(*)`.as("cnt"),
          })
          .from(messages)
          .groupBy(messages.conversationId)
          .as("msg_counts"),
      );

    return {
      totalStudents:          Number(studentCount?.total ?? 0),
      activeConversations:    Number(activeConvs?.total ?? 0),
      safetyEventsLast24h:    Number(safetyCount?.total ?? 0),
      mostUsedPlugin:         topPluginName ?? "—",
      avgMessagesPerSession:  Math.round(Number(avgRow?.avg ?? 0)),
    };
  }),

  /**
   * Recent audit log events for the activity feed.
   */
  getRecentActivity: teacherProcedure
    .input(z.object({ limit: z.number().int().min(1).max(50).optional().default(10) }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const events = await db
        .select({
          id:             auditLogs.id,
          eventType:      auditLogs.eventType,
          pluginId:       auditLogs.pluginId,
          conversationId: auditLogs.conversationId,
          severity:       auditLogs.severity,
          createdAt:      auditLogs.createdAt,
          studentName:    users.name,
        })
        .from(auditLogs)
        .leftJoin(users, eq(auditLogs.userId, users.id))
        .orderBy(desc(auditLogs.createdAt))
        .limit(input.limit);

      return { events };
    }),
});
