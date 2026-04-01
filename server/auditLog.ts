import { nanoid } from "nanoid";
import { auditLogs, type InsertAuditLog } from "../drizzle/schema";
import { getDb } from "./db";

type Severity = InsertAuditLog["severity"];

interface AuditLogParams {
  eventType: string;
  payload: Record<string, unknown>;
  userId?: number;
  conversationId?: string;
  pluginId?: string;
  severity?: Severity;
}

/**
 * Fire-and-forget audit log writer (Rule 3, Rule 28).
 *
 * Usage — always call without await so it never blocks the request path:
 *   writeAuditLog({ eventType: 'AUTH_FAILURE', payload: { ... } })
 *     .catch(err => console.error('[AuditLog]', err));
 */
export async function writeAuditLog({
  eventType,
  payload,
  userId,
  conversationId,
  pluginId,
  severity = "info",
}: AuditLogParams): Promise<void> {
  const db = await getDb();
  if (!db) {
    console.warn("[AuditLog] Database unavailable, skipping audit log:", eventType);
    return;
  }

  await db.insert(auditLogs).values({
    id: nanoid(),
    eventType,
    payload,
    userId: userId ?? null,
    conversationId: conversationId ?? null,
    pluginId: pluginId ?? null,
    severity,
  });
}
