import { TRPCError } from "@trpc/server";
import { nanoid } from "nanoid";
import { z } from "zod";
import {
  adminProcedure,
  protectedProcedure,
  router,
} from "../_core/trpc";
import {
  createPluginSchema,
  freezeConversation,
  unfreezeConversation,
  getConversationById,
  getLatestPluginState,
  listPluginSchemas,
  updateConversationActivePlugin,
  updatePluginStatus,
  upsertPluginState,
} from "../db";
import { getPluginSchema, clearAllowlistCache } from "../pluginAllowlist";
import { writeAuditLog } from "../auditLog";
import { rateLimiter } from "../rateLimiter";
import { validatePluginState, inspectStateForInjection } from "../pluginStateSchemas";

export const pluginsRouter = router({
  // ── Conversation-scoped procedures ──────────────────────────────────────────

  /**
   * Activate a plugin for a conversation.
   * Verifies the plugin is active and allowed, then sets conversations.activePluginId.
   */
  activate: protectedProcedure
    .input(z.object({ conversationId: z.string(), pluginId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // Rule 31: ownership check
      const conversation = await getConversationById(input.conversationId);
      if (!conversation || conversation.userId !== ctx.user.id) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Conversation not found" });
      }

      const schema = await getPluginSchema(input.pluginId);
      if (!schema) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Plugin not found or not active" });
      }

      // Role check: ensure the user's role is in allowedRoles
      const allowedRoles = schema.allowedRoles as string[];
      if (!allowedRoles.includes(ctx.user.role)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Your role is not allowed to use this plugin" });
      }

      await updateConversationActivePlugin(input.conversationId, input.pluginId);

      writeAuditLog({
        eventType: "PLUGIN_ACTIVATED",
        userId: ctx.user.id,
        conversationId: input.conversationId,
        pluginId: input.pluginId,
        payload: { pluginId: input.pluginId },
        severity: "info",
      }).catch(err => console.error("[AuditLog]", err));

      return { success: true, pluginId: input.pluginId } as const;
    }),

  /**
   * Deactivate the active plugin for a conversation.
   */
  deactivate: protectedProcedure
    .input(z.object({ conversationId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const conversation = await getConversationById(input.conversationId);
      if (!conversation || conversation.userId !== ctx.user.id) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Conversation not found" });
      }

      const prevPluginId = conversation.activePluginId;
      await updateConversationActivePlugin(input.conversationId, null);

      if (prevPluginId) {
        writeAuditLog({
          eventType: "PLUGIN_DEACTIVATED",
          userId: ctx.user.id,
          conversationId: input.conversationId,
          pluginId: prevPluginId,
          payload: { pluginId: prevPluginId },
          severity: "info",
        }).catch(err => console.error("[AuditLog]", err));
      }

      return { success: true } as const;
    }),

  /**
   * Get the schema for a plugin (for client-side tool schema display).
   */
  getSchema: protectedProcedure
    .input(z.object({ pluginId: z.string() }))
    .query(async ({ input }) => {
      const schema = await getPluginSchema(input.pluginId);
      if (!schema) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Plugin not found or not active" });
      }
      return schema;
    }),

  /**
   * Save plugin state from a STATE_UPDATE postMessage event.
   * Called by the client after receiving a STATE_UPDATE from the plugin iframe.
   */
  updateState: protectedProcedure
    .input(
      z.object({
        conversationId: z.string(),
        pluginId: z.string(),
        state: z.record(z.string(), z.unknown()),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Rate limit: 60 state updates per minute per conversation (Rule 27)
      const stateRateKey = `state:${input.conversationId}`;
      const stateRate = rateLimiter.check(stateRateKey, 60, 60_000);
      if (!stateRate.allowed) {
        throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "State update rate limit exceeded" });
      }

      const conversation = await getConversationById(input.conversationId);
      if (!conversation || conversation.userId !== ctx.user.id) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Conversation not found" });
      }

      if (conversation.status === "frozen") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Conversation is frozen" });
      }

      if (conversation.activePluginId !== input.pluginId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Plugin is not active for this conversation" });
      }

      // Phase 6: validate state against per-plugin schema
      const schemaCheck = validatePluginState(input.pluginId, input.state);
      if (!schemaCheck.valid) {
        void writeAuditLog({
          eventType: "MALFORMED_STATE",
          userId: ctx.user.id,
          conversationId: input.conversationId,
          pluginId: input.pluginId,
          payload: { error: schemaCheck.error, pluginId: input.pluginId },
          severity: "warning",
        });
        throw new TRPCError({ code: "BAD_REQUEST", message: `Invalid plugin state: ${schemaCheck.error}` });
      }

      // Phase 6: scan state for prompt injection patterns
      const injectionCheck = inspectStateForInjection(input.state);
      if (!injectionCheck.clean) {
        void writeAuditLog({
          eventType: "STATE_INJECTION_ATTEMPT",
          userId: ctx.user.id,
          conversationId: input.conversationId,
          pluginId: input.pluginId,
          payload: { reason: injectionCheck.reason },
          severity: "critical",
        });
        throw new TRPCError({ code: "BAD_REQUEST", message: "State contains prohibited content" });
      }

      const updated = await upsertPluginState({
        id: nanoid(),
        conversationId: input.conversationId,
        pluginId: input.pluginId,
        state: input.state,
        version: 1,
      });

      return { success: true, version: updated?.version ?? 1 } as const;
    }),

  /**
   * Retrieve the latest plugin state for a conversation.
   */
  getState: protectedProcedure
    .input(z.object({ conversationId: z.string(), pluginId: z.string() }))
    .query(async ({ ctx, input }) => {
      const conversation = await getConversationById(input.conversationId);
      if (!conversation || conversation.userId !== ctx.user.id) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Conversation not found" });
      }
      return getLatestPluginState(input.conversationId, input.pluginId);
    }),

  /**
   * List all active plugins visible to the current user's role.
   */
  list: protectedProcedure.query(async ({ ctx }) => {
    const all = await listPluginSchemas();
    return all.filter(p => {
      if (p.status !== "active") return false;
      const allowed = p.allowedRoles as string[];
      return allowed.includes(ctx.user.role) || ctx.user.role === "admin";
    });
  }),

  // ── Admin procedures ─────────────────────────────────────────────────────────

  /**
   * Register a new plugin schema (admin only).
   */
  register: adminProcedure
    .input(
      z.object({
        id: z.string().max(64),
        name: z.string().max(128),
        description: z.string(),
        origin: z.string().url(),
        iframeUrl: z.string(),
        toolSchemas: z.array(z.record(z.string(), z.unknown())),
        manifest: z.record(z.string(), z.unknown()),
        allowedRoles: z.array(z.enum(["student", "teacher", "admin"])),
      }),
    )
    .mutation(async ({ input }) => {
      const schema = await createPluginSchema({
        ...input,
        status: "active",
      });
      clearAllowlistCache();
      return schema;
    }),

  /**
   * Enable a plugin (admin only). Sets status to 'active'.
   */
  enable: adminProcedure
    .input(z.object({ pluginId: z.string() }))
    .mutation(async ({ input }) => {
      await updatePluginStatus(input.pluginId, "active");
      clearAllowlistCache();
      return { success: true } as const;
    }),

  /**
   * Disable a plugin (admin only). Sets status to 'disabled'.
   */
  disable: adminProcedure
    .input(z.object({ pluginId: z.string() }))
    .mutation(async ({ input }) => {
      await updatePluginStatus(input.pluginId, "disabled");
      clearAllowlistCache();
      return { success: true } as const;
    }),

  /**
   * Freeze a conversation (admin only). Prevents further message sends.
   */
  freezeConversation: adminProcedure
    .input(z.object({ conversationId: z.string(), reason: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await freezeConversation(input.conversationId, input.reason, ctx.user.id);
      writeAuditLog({
        eventType: "SESSION_FROZEN",
        userId: ctx.user.id,
        conversationId: input.conversationId,
        payload: { reason: input.reason },
        severity: "warning",
      }).catch(err => console.error("[AuditLog]", err));
      return { success: true } as const;
    }),

  /**
   * Unfreeze a conversation (admin only). Restores 'active' status.
   */
  unfreezeConversation: adminProcedure
    .input(z.object({ conversationId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await unfreezeConversation(input.conversationId);
      writeAuditLog({
        eventType: "SESSION_UNFROZEN",
        userId: ctx.user.id,
        conversationId: input.conversationId,
        payload: {},
        severity: "info",
      }).catch(err => console.error("[AuditLog]", err));
      return { success: true } as const;
    }),
});
