/**
 * Core safety inspection for ChatBridge (Rules 2, 33).
 *
 * inspectInput  — called on every user message before LLM invocation.
 * moderateOutput — called on every LLM response before rendering.
 *
 * Neither function performs I/O; they are pure synchronous checks so they
 * can never block the SSE stream.
 */

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
