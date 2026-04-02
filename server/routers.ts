import { TRPCError } from "@trpc/server";
import { nanoid } from "nanoid";
import { z } from "zod";
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import { pluginsRouter } from "./routers/plugins";
import {
  archiveConversation,
  createConversation,
  getConversationById,
  getConversationMessages,
  listConversations,
} from "./db";

const conversationsRouter = router({
  create: protectedProcedure
    .input(z.object({ title: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      return createConversation({
        id: nanoid(),
        userId: ctx.user.id,
        title: input.title ?? null,
        status: "active",
        activePluginId: null,
      });
    }),

  list: protectedProcedure.query(async ({ ctx }) => {
    return listConversations(ctx.user.id);
  }),

  get: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      // Rule 31: verify ownership before returning
      const conversation = await getConversationById(input.id);
      if (!conversation || conversation.userId !== ctx.user.id) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Conversation not found" });
      }
      const msgs = await getConversationMessages(input.id, 50);
      return { ...conversation, messages: msgs };
    }),

  archive: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // Rule 31: verify ownership before mutating
      const conversation = await getConversationById(input.id);
      if (!conversation || conversation.userId !== ctx.user.id) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Conversation not found" });
      }
      await archiveConversation(input.id);
      return { success: true } as const;
    }),
});

export const appRouter = router({
  // if you need to use socket.io, read and register route in server/_core/index.ts, all api should start with '/api/' so that the gateway can route correctly
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return {
        success: true,
      } as const;
    }),
  }),

  conversations: conversationsRouter,
  plugins: pluginsRouter,
});

export type AppRouter = typeof appRouter;
