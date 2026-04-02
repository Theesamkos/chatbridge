import { and, desc, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import {
  type Conversation,
  type InsertConversation,
  type InsertMessage,
  type Message,
  type PluginState,
  type PluginSchema,
  type InsertPluginSchema,
  conversations,
  messages,
  pluginStates,
  pluginSchemas,
  users,
  type InsertUser,
  type InsertPluginState,
  type InsertPluginFailure,
  pluginFailures,
  safetyEvents,
  type InsertSafetyEvent,
} from "../drizzle/schema";
import { ENV } from './_core/env';
import { nanoid } from "nanoid";

let _db: ReturnType<typeof drizzle> | null = null;

// Lazily create the drizzle instance so local tooling can run without a DB.
export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    const values: InsertUser = {
      openId: user.openId,
    };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      // Owner account is always admin regardless of DB default
      values.role = 'admin';
      updateSet.role = 'admin';
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await db.insert(users).values(values).onDuplicateKeyUpdate({
      set: updateSet,
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);

  return result.length > 0 ? result[0] : undefined;
}

// ─── Conversations ────────────────────────────────────────────────────────────

export async function getConversationById(id: string): Promise<Conversation | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(conversations).where(eq(conversations.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function createConversation(data: InsertConversation): Promise<Conversation> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  await db.insert(conversations).values(data);
  const row = await getConversationById(data.id);
  if (!row) throw new Error("Failed to retrieve created conversation");
  return row;
}

export async function listConversations(userId: number): Promise<Conversation[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(conversations)
    .where(and(eq(conversations.userId, userId), eq(conversations.status, "active")))
    .orderBy(desc(conversations.updatedAt));
}

export async function archiveConversation(id: string): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  await db.update(conversations).set({ status: "archived" }).where(eq(conversations.id, id));
}

export async function updateConversationActivePlugin(
  id: string,
  pluginId: string | null,
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  await db.update(conversations).set({ activePluginId: pluginId }).where(eq(conversations.id, id));
}

// ─── Messages ─────────────────────────────────────────────────────────────────

export async function createMessage(data: InsertMessage): Promise<Message> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  await db.insert(messages).values(data);
  const rows = await db
    .select()
    .from(messages)
    .where(eq(messages.id, data.id))
    .limit(1);
  if (!rows[0]) throw new Error("Failed to retrieve created message");
  return rows[0];
}

export async function getConversationMessages(
  conversationId: string,
  limit = 20,
): Promise<Message[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(desc(messages.createdAt))
    .limit(limit)
    .then(rows => rows.reverse()); // return chronological order
}

// ─── Plugin states ────────────────────────────────────────────────────────────

/**
 * INSERT or UPDATE plugin state for a conversation.
 * Uses ON DUPLICATE KEY UPDATE to handle the UNIQUE(conversationId, pluginId) constraint.
 * Increments version on every update.
 */
export async function upsertPluginState(data: InsertPluginState): Promise<PluginState | null> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  await db
    .insert(pluginStates)
    .values(data)
    .onDuplicateKeyUpdate({
      set: {
        state: data.state,
        version: sql`version + 1`,
      },
    });
  return getLatestPluginState(data.conversationId, data.pluginId);
}

// ─── Plugin schemas (admin helpers) ──────────────────────────────────────────

export async function listPluginSchemas(): Promise<PluginSchema[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(pluginSchemas);
}

export async function createPluginSchema(data: InsertPluginSchema): Promise<PluginSchema> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  await db.insert(pluginSchemas).values(data);
  const rows = await db.select().from(pluginSchemas).where(eq(pluginSchemas.id, data.id)).limit(1);
  if (!rows[0]) throw new Error("Failed to retrieve created plugin schema");
  return rows[0];
}

export async function updatePluginStatus(
  id: string,
  status: "active" | "disabled" | "suspended",
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  await db.update(pluginSchemas).set({ status }).where(eq(pluginSchemas.id, id));
}

export async function getLatestPluginState(
  conversationId: string,
  pluginId: string,
): Promise<PluginState | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select()
    .from(pluginStates)
    .where(
      and(eq(pluginStates.conversationId, conversationId), eq(pluginStates.pluginId, pluginId)),
    )
    .orderBy(desc(pluginStates.version))
    .limit(1);
  return rows[0] ?? null;
}

export async function unfreezeConversation(conversationId: string): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  await db
    .update(conversations)
    .set({ status: "active" })
    .where(eq(conversations.id, conversationId));
}

// ─── Plugin failures ──────────────────────────────────────────────────────────

export async function createPluginFailure(data: InsertPluginFailure): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  await db.insert(pluginFailures).values(data);
}

// ─── Session freeze ───────────────────────────────────────────────────────────

export async function freezeConversation(
  conversationId: string,
  reason: string,
  userId = 0,
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  await db
    .update(conversations)
    .set({ status: "frozen" })
    .where(eq(conversations.id, conversationId));
  await db.insert(safetyEvents).values({
    id: nanoid(),
    userId,
    conversationId,
    eventType: "session_frozen",
    triggerContent: reason,
    action: "session_frozen",
  });
}
