import { eq } from "drizzle-orm";
import { pluginSchemas, type PluginSchema } from "../drizzle/schema";
import { getDb } from "./db";

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface CacheEntry {
  schema: PluginSchema | null;
  expiresAt: number;
}

// pluginId → cached schema (null means "known not to exist")
const cache = new Map<string, CacheEntry>();

/**
 * Returns true when the plugin exists in plugin_schemas with status='active'.
 * Results are cached for 5 minutes to avoid repeated DB lookups per request.
 */
export async function isPluginAllowed(pluginId: string): Promise<boolean> {
  const schema = await getPluginSchema(pluginId);
  return schema !== null;
}

/**
 * Returns the plugin schema for an active plugin, or null if not found / disabled.
 * Results are cached for 5 minutes (Rule: pluginAllowlist cache).
 */
export async function getPluginSchema(pluginId: string): Promise<PluginSchema | null> {
  const now = Date.now();
  const cached = cache.get(pluginId);

  if (cached && cached.expiresAt > now) {
    return cached.schema;
  }

  const db = await getDb();
  if (!db) {
    console.warn("[PluginAllowlist] Database unavailable, denying plugin:", pluginId);
    return null;
  }

  const rows = await db
    .select()
    .from(pluginSchemas)
    .where(eq(pluginSchemas.id, pluginId))
    .limit(1);

  const row = rows[0] ?? null;

  // Only cache active plugins as allowed; non-active statuses cache as null
  const result = row?.status === "active" ? row : null;

  cache.set(pluginId, { schema: result, expiresAt: now + CACHE_TTL_MS });

  return result;
}

/**
 * Clears the in-process allowlist cache.
 * Used in tests and can be called after plugin_schemas mutations.
 */
export function clearAllowlistCache(): void {
  cache.clear();
}
