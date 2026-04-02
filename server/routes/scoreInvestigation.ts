/**
 * POST /api/plugins/score-investigation
 *
 * Called by the client when the artifact-studio sends PLUGIN_COMPLETE.
 * Scores the investigation with the LLM and persists the score into plugin_states.
 *
 * Body: { conversationId: string; finalState: unknown; summary: string }
 * Response: { score: RubricScore }
 */
import { nanoid } from "nanoid";
import type { Request, Response } from "express";
import { sdk } from "../_core/sdk";
import { invokeLLM } from "../_core/llm";
import { getConversationById, getLatestPluginState, upsertPluginState } from "../db";

const SCORING_SYSTEM_PROMPT = `You are an expert K-12 educational assessment specialist.
You will receive a student's artifact investigation and produce a structured JSON rubric score.

Return ONLY valid JSON matching this exact shape:
{
  "overall": <number 0.0–1.0>,
  "observation": <number 0.0–1.0>,
  "evidence": <number 0.0–1.0>,
  "reasoning": <number 0.0–1.0>,
  "depth": <number 0.0–1.0>,
  "strengths": [<up to 3 short strings>],
  "growth": [<up to 3 short strings>],
  "feedback": "<1–2 sentence encouraging narrative>"
}

Scoring rubric:
- observation (0–1): quality and specificity of artifact observations
- evidence (0–1): how well evidence supports claims
- reasoning (0–1): historical thinking and causal connections
- depth (0–1): thoroughness and curiosity of the inquiry
- overall (0–1): holistic weighted average of the four dimensions

Be encouraging and age-appropriate. Strengths celebrate what the student did well.
Growth areas suggest concrete next steps.`;

export async function scoreInvestigationHandler(req: Request, res: Response): Promise<void> {
  const { conversationId, finalState, summary } = req.body as {
    conversationId?: string;
    finalState?: unknown;
    summary?: string;
  };

  if (!conversationId || typeof conversationId !== "string") {
    res.status(400).json({ error: "conversationId is required" });
    return;
  }

  // Auth + ownership (Rule 31)
  let user: Awaited<ReturnType<typeof sdk.authenticateRequest>>;
  try {
    user = await sdk.authenticateRequest(req);
  } catch {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const conversation = await getConversationById(conversationId);
  if (!conversation || conversation.userId !== user.id) {
    res.status(403).json({ error: "Conversation not found" });
    return;
  }

  // Build investigation summary for the LLM
  const state = (finalState ?? {}) as Record<string, unknown>;
  const artifact = (state.selectedArtifact ?? {}) as Record<string, unknown>;

  // Support new state model (observations/evidence/interpretation/hypothesis)
  // with backward-compat fallback to legacy keys (inquiryQuestion/conclusion/annotations)
  const observations = (state.observations as string) || (state.inquiryQuestion as string) || "";
  const evidence = (state.evidence as string) || "";
  const interpretation = (state.interpretation as string) || "";
  const hypothesis = (state.hypothesis as string) || (state.conclusion as string) || "";

  const investigationText = [
    `Artifact: ${artifact.title ?? "Unknown"}`,
    summary ? `Summary: ${summary}` : "",
    observations ? `Observations: ${observations}` : "",
    evidence ? `Evidence: ${evidence}` : "",
    interpretation ? `Interpretation: ${interpretation}` : "",
    hypothesis ? `Hypothesis / Conclusion: ${hypothesis}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  let score: Record<string, unknown>;
  try {
    const result = await invokeLLM({
      messages: [
        { role: "system", content: SCORING_SYSTEM_PROMPT },
        { role: "user", content: investigationText },
      ],
    });

    const raw = result.choices[0]?.message?.content;
    const text = typeof raw === "string" ? raw : "";

    // Extract the JSON block from the LLM response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON in LLM response");
    score = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
  } catch (err) {
    console.error("[scoreInvestigation] Scoring failed:", err);
    res.status(500).json({ error: "Scoring unavailable" });
    return;
  }

  // Merge score into the existing plugin state
  try {
    const existing = await getLatestPluginState(conversationId, "artifact-studio");
    const mergedState = {
      ...((existing?.state ?? {}) as Record<string, unknown>),
      ...state,
      score,
      llmFeedback: typeof score.feedback === "string" ? score.feedback : null,
      completionStatus: "INVESTIGATION_COMPLETE",
      submitted: true,
    };

    await upsertPluginState({
      id: existing?.id ?? nanoid(),
      conversationId,
      pluginId: "artifact-studio",
      state: mergedState,
      version: (existing?.version ?? 0) + 1,
    });
  } catch (err) {
    console.error("[scoreInvestigation] State upsert failed:", err);
    // Non-fatal — still return the score to the client
  }

  res.json({ score });
}
