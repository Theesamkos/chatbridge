import {
  boolean,
  index,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 * Columns use camelCase to match both database fields and generated types.
 */
export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["student", "teacher", "admin"]).default("student").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

// ─── Plugin schemas (seeded, not user-created) ────────────────────────────────

export const pluginSchemas = mysqlTable("plugin_schemas", {
  id: varchar("id", { length: 64 }).primaryKey(),
  name: varchar("name", { length: 128 }).notNull(),
  description: text("description").notNull(),
  origin: varchar("origin", { length: 512 }).notNull(),
  iframeUrl: varchar("iframeUrl", { length: 512 }).notNull(),
  toolSchemas: json("toolSchemas").notNull(),
  manifest: json("manifest").notNull(),
  status: mysqlEnum("status", ["active", "disabled", "suspended"]).default("active").notNull(),
  allowedRoles: json("allowedRoles").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type PluginSchema = typeof pluginSchemas.$inferSelect;
export type InsertPluginSchema = typeof pluginSchemas.$inferInsert;

// ─── Conversations ────────────────────────────────────────────────────────────

export const conversations = mysqlTable(
  "conversations",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    userId: int("userId").notNull(),
    title: text("title"),
    activePluginId: varchar("activePluginId", { length: 64 }),
    status: mysqlEnum("status", ["active", "archived", "frozen"]).default("active").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    userIdIdx: index("conversations_userId_idx").on(table.userId),
    activePluginIdx: index("conversations_activePluginId_idx").on(table.activePluginId),
  }),
);

export type Conversation = typeof conversations.$inferSelect;
export type InsertConversation = typeof conversations.$inferInsert;

// ─── Messages ─────────────────────────────────────────────────────────────────

export const messages = mysqlTable(
  "messages",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    conversationId: varchar("conversationId", { length: 36 }).notNull(),
    role: mysqlEnum("role", ["user", "assistant", "tool_use", "tool_result", "system"]).notNull(),
    content: text("content").notNull(),
    toolName: varchar("toolName", { length: 128 }),
    toolCallId: varchar("toolCallId", { length: 128 }),
    moderationStatus: mysqlEnum("moderationStatus", ["pending", "passed", "flagged", "blocked"])
      .default("pending")
      .notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    conversationIdIdx: index("messages_conversationId_idx").on(table.conversationId),
    toolCallIdIdx: index("messages_toolCallId_idx").on(table.toolCallId),
  }),
);

export type Message = typeof messages.$inferSelect;
export type InsertMessage = typeof messages.$inferInsert;

// ─── Plugin states ────────────────────────────────────────────────────────────

export const pluginStates = mysqlTable(
  "plugin_states",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    conversationId: varchar("conversationId", { length: 36 }).notNull(),
    pluginId: varchar("pluginId", { length: 64 }).notNull(),
    state: json("state").notNull(),
    version: int("version").default(1).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    conversationPluginUnique: uniqueIndex("plugin_states_conversation_plugin_unique").on(
      table.conversationId,
      table.pluginId,
    ),
    conversationIdIdx: index("plugin_states_conversationId_idx").on(table.conversationId),
    pluginIdIdx: index("plugin_states_pluginId_idx").on(table.pluginId),
  }),
);

export type PluginState = typeof pluginStates.$inferSelect;
export type InsertPluginState = typeof pluginStates.$inferInsert;

// ─── Audit logs ───────────────────────────────────────────────────────────────

export const auditLogs = mysqlTable(
  "audit_logs",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    eventType: varchar("eventType", { length: 128 }).notNull(),
    userId: int("userId"),
    conversationId: varchar("conversationId", { length: 36 }),
    pluginId: varchar("pluginId", { length: 64 }),
    payload: json("payload").notNull(),
    severity: mysqlEnum("severity", ["info", "warning", "error", "critical"])
      .default("info")
      .notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    userIdIdx: index("audit_logs_userId_idx").on(table.userId),
    conversationIdIdx: index("audit_logs_conversationId_idx").on(table.conversationId),
    eventTypeIdx: index("audit_logs_eventType_idx").on(table.eventType),
  }),
);

export type AuditLog = typeof auditLogs.$inferSelect;
export type InsertAuditLog = typeof auditLogs.$inferInsert;

// ─── Safety events ────────────────────────────────────────────────────────────

export const safetyEvents = mysqlTable(
  "safety_events",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    userId: int("userId").notNull(),
    conversationId: varchar("conversationId", { length: 36 }).notNull(),
    eventType: mysqlEnum("eventType", [
      "input_blocked",
      "output_flagged",
      "injection_detected",
      "session_frozen",
      "content_filtered",
    ]).notNull(),
    triggerContent: text("triggerContent").notNull(),
    action: mysqlEnum("action", [
      "blocked",
      "sanitized",
      "flagged_for_review",
      "session_frozen",
    ]).notNull(),
    reviewedBy: int("reviewedBy"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    userIdIdx: index("safety_events_userId_idx").on(table.userId),
    conversationIdIdx: index("safety_events_conversationId_idx").on(table.conversationId),
  }),
);

export type SafetyEvent = typeof safetyEvents.$inferSelect;
export type InsertSafetyEvent = typeof safetyEvents.$inferInsert;

// ─── Plugin failures ──────────────────────────────────────────────────────────

export const pluginFailures = mysqlTable(
  "plugin_failures",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    pluginId: varchar("pluginId", { length: 64 }).notNull(),
    conversationId: varchar("conversationId", { length: 36 }).notNull(),
    failureType: mysqlEnum("failureType", [
      "timeout",
      "load_failure",
      "invalid_origin",
      "malformed_state",
      "tool_error",
      "circuit_breaker",
    ]).notNull(),
    errorDetail: text("errorDetail").notNull(),
    resolved: boolean("resolved").default(false).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    pluginIdIdx: index("plugin_failures_pluginId_idx").on(table.pluginId),
    conversationIdIdx: index("plugin_failures_conversationId_idx").on(table.conversationId),
  }),
);

export type PluginFailure = typeof pluginFailures.$inferSelect;
export type InsertPluginFailure = typeof pluginFailures.$inferInsert;
