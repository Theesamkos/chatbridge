import { TRPCError } from "@trpc/server";
import { and, eq, inArray } from "drizzle-orm";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { conversations, pluginStates } from "../../drizzle/schema";

export const investigationsRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

    // Rule 31: only return rows owned by the requesting user
    const userConvs = await db
      .select({ id: conversations.id })
      .from(conversations)
      .where(eq(conversations.userId, ctx.user.id));

    if (userConvs.length === 0) return { investigations: [] };

    const convIds = userConvs.map(c => c.id);

    const states = await db
      .select()
      .from(pluginStates)
      .where(
        and(
          eq(pluginStates.pluginId, "artifact-studio"),
          inArray(pluginStates.conversationId, convIds),
        ),
      );

    const investigations = states
      .filter(s => {
        const state = s.state as Record<string, unknown>;
        return state?.completionStatus === "INVESTIGATION_COMPLETE" || state?.submitted === true;
      })
      .map(s => {
        const state = s.state as Record<string, unknown>;
        const artifact = (state?.selectedArtifact ?? {}) as Record<string, unknown>;
        return {
          id: s.id,
          conversationId: s.conversationId,
          artifactTitle: (artifact?.title ?? "Unknown Artifact") as string,
          artifactThumbnail: (artifact?.thumbnail ?? null) as string | null,
          submittedAt: s.createdAt,
          inquiryQuestion: (state?.inquiryQuestion ?? "") as string,
          conclusion: (state?.conclusion ?? "") as string,
          annotations: (state?.annotations ?? []) as unknown[],
          llmFeedback: (state?.llmFeedback ?? null) as string | null,
          score: (state?.score ?? null) as Record<string, unknown> | null,
        };
      });

    // Sort newest first
    investigations.sort(
      (a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime(),
    );

    return { investigations };
  }),
});
