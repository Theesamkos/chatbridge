/**
 * Core safety inspection for ChatBridge (Rules 2, 33).
 *
 * inspectInput  — called on every user message before LLM invocation.
 * moderateOutput — called on every LLM response before rendering.
 *
 * Neither function performs I/O; they are pure synchronous checks so they
 * can never block the SSE stream.
 */

import { invokeLLM } from "./_core/llm";

// ─── Injection patterns ───────────────────────────────────────────────────────

const INJECTION_PATTERNS: RegExp[] = [
  /ignore previous instructions/i,
  /you are now/i,
  /disregard your guidelines/i,
  /pretend you are/i,
  /forget everything/i,
  /new persona/i,
  /jailbreak/i,
  /dan mode/i,
];

// ─── K-12 prohibited content (Rule 2) ────────────────────────────────────────

// Violence
const PROHIBITED_TERMS = [
  "murder",
  "kill",
  "shooting",
  "stabbing",
  "assault",
  "weapon",
  "explosive",
  "bomb",
  "terrorism",
  "terrorist",
  "gore",
  "decapitate",
  "torture",
  "rape",
  // Adult content
  "pornography",
  "pornographic",
  "explicit sex",
  "nude photos",
  "naked",
  "erotic",
  "prostitution",
  // Self-harm
  "suicide",
  "self-harm",
  "self-mutilate",
  "overdose",
  "cutting myself",
];

// Build a single regex that matches whole-word occurrences to minimise false
// positives (e.g. "classical" should not match "ass").
const PROHIBITED_REGEX = new RegExp(
  `\\b(${PROHIBITED_TERMS.map(t => t.replace(/[-\s]/g, "[\\s-]")).join("|")})\\b`,
  "i",
);

// ─── PII patterns ─────────────────────────────────────────────────────────────

const PII_PATTERNS: { regex: RegExp; label: string }[] = [
  { regex: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, label: "email" },
  { regex: /\b(\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g, label: "phone" },
  { regex: /\b\d{3}[-\s]?\d{2}[-\s]?\d{4}\b/g, label: "ssn" },
];

// ─── Public API ───────────────────────────────────────────────────────────────

export interface InspectResult {
  passed: boolean;
  reason?: string;
  action: "allow" | "block" | "sanitize";
}

export interface ModerateResult {
  passed: boolean;
  reason?: string;
  action: "allow" | "block" | "sanitize";
  sanitized?: string;
}

export type ModerationResult = ModerateResult;

/**
 * Inspect a user message before it enters the LLM pipeline (Rule 2).
 */
export function inspectInput(message: string): InspectResult {
  if (message.length > 4000) {
    return { passed: false, reason: "Message too long", action: "block" };
  }

  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(message)) {
      return { passed: false, reason: "Potential prompt injection", action: "block" };
    }
  }

  if (PROHIBITED_REGEX.test(message)) {
    return { passed: false, reason: "Content policy violation", action: "block" };
  }

  return { passed: true, action: "allow" };
}

/**
 * Moderate an LLM response before it is rendered to the student (Rule 2).
 * PII is redacted rather than blocked so the response is not entirely lost.
 */
export function moderateOutput(response: string): ModerateResult {
  if (PROHIBITED_REGEX.test(response)) {
    return { passed: false, reason: "Output policy violation", action: "block" };
  }

  let sanitized = response;
  let hasPii = false;

  for (const { regex } of PII_PATTERNS) {
    regex.lastIndex = 0; // reset stateful global regex
    if (regex.test(sanitized)) {
      hasPii = true;
      regex.lastIndex = 0;
      sanitized = sanitized.replace(regex, "[REDACTED]");
    }
  }

  if (hasPii) {
    return { passed: true, action: "sanitize", sanitized };
  }

  return { passed: true, action: "allow" };
}

/**
 * LLM-powered moderation with 3-second timeout and pattern-matching fallback (Task 5.1).
 * Used for output moderation in the SSE streaming endpoint.
 */
export async function moderateWithLLM(
  content: string,
  contentType: "input" | "output",
): Promise<ModerateResult> {
  const TIMEOUT_MS = 3_000;

  try {
    const llmPromise = invokeLLM({
      messages: [
        {
          role: "system",
          content:
            "You are a content moderator for a K-12 educational platform. Respond with JSON only.",
        },
        {
          role: "user",
          content:
            `Is this ${contentType} safe for students under 18? Content: ${content}\n` +
            `Respond: {"safe": true/false, "reason": "brief reason if unsafe"}`,
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "moderation",
          strict: true,
          schema: {
            type: "object",
            properties: {
              safe: { type: "boolean" },
              reason: { type: "string" },
            },
            required: ["safe"],
            additionalProperties: false,
          },
        },
      },
    });

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("LLM moderation timeout")), TIMEOUT_MS),
    );

    const result = await Promise.race([llmPromise, timeoutPromise]);

    const rawContent = result.choices[0]?.message?.content;
    const text = typeof rawContent === "string" ? rawContent : JSON.stringify(rawContent);
    const parsed = JSON.parse(text) as { safe: boolean; reason?: string };

    return {
      passed: parsed.safe,
      reason: parsed.reason,
      action: parsed.safe ? "allow" : "block",
    };
  } catch (err) {
    console.warn("[Safety] LLM moderation failed, falling back to pattern matching:", err);
    return moderateOutput(content);
  }
}
