/**
 * Artifact Investigation Studio — server-side proxy router.
 *
 * Proxies the Metropolitan Museum of Art Open Access API.
 * https://metmuseum.github.io/
 * No API key required — fully open, public domain images only.
 *
 * Responses are cached in-memory with a 24-hour TTL.
 * Rule 6: External API calls server-side only.
 */
import { z } from "zod";
import { publicProcedure, router } from "../_core/trpc";

// ─── Types ──────────────────────────────────────────────────────────────────

interface ArtifactSummary {
  id: string;
  title: string;
  date: string;
  thumbnailUrl: string | null;
  source: "met";
  culturalContext?: string;
  department?: string;
}

interface ArtifactDetail {
  id: string;
  title: string;
  date: string;
  medium: string | null;
  dimensions: string | null;
  provenance: string | null;
  description: string | null;
  imageUrl: string | null;
  source: "met";
  metadata: Record<string, unknown>;
}

// ─── Met Museum API shape ────────────────────────────────────────────────────

interface MetObject {
  objectID: number;
  title: string;
  objectDate: string;
  medium: string;
  dimensions: string;
  culture: string;
  period: string;
  department: string;
  primaryImage: string;
  primaryImageSmall: string;
  artistDisplayName: string;
  country: string;
  classification: string;
  isPublicDomain: boolean;
  creditLine: string;
  objectURL: string;
}

// ─── K-12 Content Filter ────────────────────────────────────────────────────

const K12_PROHIBITED = [
  "nude",
  "naked",
  "explicit",
  "sexual",
  "pornograph",
  "gore",
  "graphic violence",
  "erotic",
];

function isK12Safe(text: string): boolean {
  const lower = text.toLowerCase();
  return !K12_PROHIBITED.some(term => lower.includes(term));
}

// ─── In-Memory 24h Cache ────────────────────────────────────────────────────

const searchCache = new Map<string, { data: unknown; expiresAt: number }>();

function getCached<T>(key: string): T | null {
  const entry = searchCache.get(key);
  if (!entry || entry.expiresAt < Date.now()) return null;
  return entry.data as T;
}

function setCached(key: string, data: unknown): void {
  searchCache.set(key, { data, expiresAt: Date.now() + 24 * 60 * 60 * 1000 });
}

// ─── Met Museum helpers ──────────────────────────────────────────────────────

const MET_BASE = "https://collectionapi.metmuseum.org/public/collection/v1";
const PAGE_SIZE = 12;

async function metSearch(query: string, page: number): Promise<number[]> {
  const url = new URL(`${MET_BASE}/search`);
  url.searchParams.set("q", query);
  url.searchParams.set("hasImages", "true");
  url.searchParams.set("isPublicDomain", "true");

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`Met search responded ${res.status}`);

  const json = (await res.json()) as { total: number; objectIDs: number[] | null };
  const ids = json.objectIDs ?? [];
  return ids.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
}

async function metGetObject(objectID: number): Promise<MetObject | null> {
  const cacheKey = `met:obj:${objectID}`;
  const cached = getCached<MetObject>(cacheKey);
  if (cached) return cached;

  const res = await fetch(`${MET_BASE}/objects/${objectID}`);
  if (!res.ok) return null;

  const obj = (await res.json()) as MetObject;
  if (!obj.primaryImageSmall && !obj.primaryImage) return null;
  setCached(cacheKey, obj);
  return obj;
}

// ─── Router ─────────────────────────────────────────────────────────────────

export const artifactsRouter = router({
  /**
   * Search artifacts via the Metropolitan Museum of Art Open Access API.
   * Results are filtered for K-12 appropriateness and cached for 24 hours.
   */
  search: publicProcedure
    .input(
      z.object({
        query: z.string().min(1).max(200),
        dateRange: z.string().optional(),
        culturalContext: z.string().optional(),
        page: z.number().int().min(0).default(0),
      }),
    )
    .query(
      async ({
        input,
      }): Promise<{
        artifacts: ArtifactSummary[];
        totalCount: number;
        source: "met" | "unavailable";
        page: number;
        error?: string;
      }> => {
        const cacheKey = `search:met:${input.query}:${input.culturalContext ?? ""}:${input.page}`;
        const cached = getCached<{
          artifacts: ArtifactSummary[];
          totalCount: number;
          source: "met" | "unavailable";
          page: number;
          error?: string;
        }>(cacheKey);
        if (cached) return cached;

        try {
          const q = input.culturalContext
            ? `${input.query} ${input.culturalContext}`
            : input.query;

          const objectIDs = await metSearch(q, input.page);

          const settled = await Promise.allSettled(
            objectIDs.map(id => metGetObject(id)),
          );

          const artifacts: ArtifactSummary[] = [];
          for (const r of settled) {
            if (r.status !== "fulfilled" || !r.value) continue;
            const obj = r.value;
            if (!isK12Safe(obj.title) || !isK12Safe(obj.medium ?? "")) continue;
            artifacts.push({
              id: String(obj.objectID),
              title: obj.title || "Untitled",
              date: obj.objectDate || "Unknown",
              thumbnailUrl: obj.primaryImageSmall || obj.primaryImage || null,
              source: "met",
              culturalContext: obj.culture || obj.country || undefined,
              department: obj.department || undefined,
            });
          }

          const result = {
            artifacts,
            totalCount: artifacts.length,
            source: "met" as const,
            page: input.page,
          };
          setCached(cacheKey, result);
          return result;
        } catch {
          return {
            artifacts: [],
            totalCount: 0,
            source: "unavailable" as const,
            page: input.page,
            error: "Met Museum API temporarily unavailable",
          };
        }
      },
    ),

  /**
   * Retrieve full metadata for a specific Met Museum artifact by numeric object ID.
   */
  getDetail: publicProcedure
    .input(
      z.object({
        id: z.string(),
        source: z.enum(["met"]),
      }),
    )
    .query(async ({ input }): Promise<ArtifactDetail> => {
      const cacheKey = `detail:met:${input.id}`;
      const cached = getCached<ArtifactDetail>(cacheKey);
      if (cached) return cached;

      try {
        const objectID = parseInt(input.id, 10);
        if (isNaN(objectID)) throw new Error("Invalid object ID");

        const obj = await metGetObject(objectID);
        if (!obj) throw new Error("Object not found");

        const descParts: string[] = [];
        if (obj.artistDisplayName) descParts.push(`Created by ${obj.artistDisplayName}.`);
        if (obj.period) descParts.push(`Period: ${obj.period}.`);
        if (obj.classification) descParts.push(`Classification: ${obj.classification}.`);
        if (obj.culture) descParts.push(`Culture: ${obj.culture}.`);

        let description: string | null = descParts.length > 0 ? descParts.join(" ") : null;
        if (description && !isK12Safe(description)) {
          description = "[Content filtered]";
        }

        const detail: ArtifactDetail = {
          id: String(obj.objectID),
          title: obj.title || "Untitled",
          date: obj.objectDate || "Unknown",
          medium: obj.medium || null,
          dimensions: obj.dimensions || null,
          provenance: obj.creditLine || null,
          description,
          imageUrl: obj.primaryImage || obj.primaryImageSmall || null,
          source: "met",
          metadata: {
            department: obj.department,
            culture: obj.culture,
            period: obj.period,
            country: obj.country,
            classification: obj.classification,
            artistDisplayName: obj.artistDisplayName,
            objectURL: obj.objectURL,
          },
        };

        setCached(cacheKey, detail);
        return detail;
      } catch {
        return {
          id: input.id,
          title: "Unavailable",
          date: "Unknown",
          medium: null,
          dimensions: null,
          provenance: null,
          description: null,
          imageUrl: null,
          source: "met",
          metadata: {},
        };
      }
    }),
});
