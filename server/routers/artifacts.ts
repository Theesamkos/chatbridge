/**
 * Artifact Investigation Studio — server-side proxy router.
 *
 * Proxies Smithsonian Open Access API and Library of Congress API.
 * Responses are cached in-memory with a 24-hour TTL.
 * No database access — purely an HTTP proxy with caching.
 *
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
  source: "smithsonian" | "loc";
  culturalContext?: string;
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
  source: "smithsonian" | "loc";
  metadata: Record<string, unknown>;
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

// ─── Router ─────────────────────────────────────────────────────────────────

export const artifactsRouter = router({
  /**
   * Search artifacts across Smithsonian Open Access API (with LoC fallback).
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
        source: "smithsonian" | "loc" | "unavailable";
        page: number;
        error?: string;
      }> => {
        const cacheKey = `search:${input.query}:${input.dateRange ?? ""}:${input.culturalContext ?? ""}:${input.page}`;
        const cached = getCached<{
          artifacts: ArtifactSummary[];
          totalCount: number;
          source: "smithsonian" | "loc" | "unavailable";
          page: number;
          error?: string;
        }>(cacheKey);
        if (cached) return cached;

        // ── Smithsonian attempt ──
        try {
          const siUrl = new URL(
            "https://api.si.edu/openaccess/api/v1.0/search",
          );
          siUrl.searchParams.set("q", input.query);
          siUrl.searchParams.set("rows", "20");
          siUrl.searchParams.set("start", String(input.page * 20));
          siUrl.searchParams.set("api_key", "DEMO_KEY");

          const siRes = await fetch(siUrl.toString());
          if (!siRes.ok) throw new Error(`Smithsonian responded ${siRes.status}`);

          const siJson = (await siRes.json()) as {
            response?: {
              rows?: Array<{
                id?: string;
                title?: string;
                content?: {
                  freetext?: {
                    date?: Array<{ content?: string }>;
                    culturalContext?: Array<{ content?: string }>;
                  };
                  descriptiveNonRepeating?: {
                    online_media?: {
                      media?: Array<{ thumbnail?: string }>;
                    };
                  };
                };
              }>;
              rowCount?: number;
            };
          };

          const rows = siJson.response?.rows ?? [];
          const artifacts: ArtifactSummary[] = rows
            .filter(row => {
              const title = row.title ?? "";
              return isK12Safe(title);
            })
            .map(row => ({
              id: row.id ?? "",
              title: row.title ?? "Untitled",
              date: row.content?.freetext?.date?.[0]?.content ?? "Unknown",
              thumbnailUrl:
                row.content?.descriptiveNonRepeating?.online_media?.media?.[0]
                  ?.thumbnail ?? null,
              source: "smithsonian" as const,
              culturalContext:
                row.content?.freetext?.culturalContext?.[0]?.content,
            }));

          const result = {
            artifacts,
            totalCount: siJson.response?.rowCount ?? artifacts.length,
            source: "smithsonian" as const,
            page: input.page,
          };
          setCached(cacheKey, result);
          return result;
        } catch {
          // Smithsonian failed — try LoC fallback
        }

        // ── Library of Congress fallback ──
        try {
          const locUrl = new URL("https://www.loc.gov/search/");
          locUrl.searchParams.set("q", input.query);
          locUrl.searchParams.set("fo", "json");
          locUrl.searchParams.set("at", "results");
          locUrl.searchParams.set("c", "20");
          locUrl.searchParams.set("sp", String(input.page + 1));

          const locRes = await fetch(locUrl.toString());
          if (!locRes.ok) throw new Error(`LoC responded ${locRes.status}`);

          const locJson = (await locRes.json()) as {
            results?: Array<{
              id?: string;
              title?: string | string[];
              date?: string;
              image?: { thumb?: string };
              subject?: string[];
            }>;
          };

          const results = locJson.results ?? [];
          const artifacts: ArtifactSummary[] = results
            .filter(result => {
              const title = Array.isArray(result.title)
                ? result.title[0] ?? ""
                : result.title ?? "";
              return isK12Safe(title);
            })
            .map(result => {
              const title = Array.isArray(result.title)
                ? result.title[0] ?? "Untitled"
                : result.title ?? "Untitled";
              return {
                id: result.id ?? "",
                title,
                date: result.date ?? "Unknown",
                thumbnailUrl: result.image?.thumb ?? null,
                source: "loc" as const,
              };
            });

          const locResult = {
            artifacts,
            totalCount: artifacts.length,
            source: "loc" as const,
            page: input.page,
          };
          setCached(cacheKey, locResult);
          return locResult;
        } catch {
          // Both APIs failed
        }

        return {
          artifacts: [],
          totalCount: 0,
          source: "unavailable" as const,
          page: input.page,
          error: "External APIs temporarily unavailable",
        };
      },
    ),

  /**
   * Retrieve full metadata for a specific artifact by id and source.
   * Used to populate the detailed investigation view after the student selects an item.
   * Results are cached for 24 hours.
   */
  getDetail: publicProcedure
    .input(
      z.object({
        id: z.string(),
        source: z.enum(["smithsonian", "loc"]),
      }),
    )
    .query(async ({ input }): Promise<ArtifactDetail> => {
      const cacheKey = `detail:${input.source}:${input.id}`;
      const cached = getCached<ArtifactDetail>(cacheKey);
      if (cached) return cached;

      if (input.source === "smithsonian") {
        try {
          const siUrl = `https://api.si.edu/openaccess/api/v1.0/content/${encodeURIComponent(input.id)}?api_key=DEMO_KEY`;
          const siRes = await fetch(siUrl);
          if (!siRes.ok) throw new Error(`Smithsonian responded ${siRes.status}`);

          const siJson = (await siRes.json()) as {
            response?: {
              id?: string;
              title?: string;
              content?: {
                freetext?: {
                  date?: Array<{ content?: string }>;
                  physicalDescription?: Array<{ content?: string }>;
                  creditLine?: Array<{ content?: string }>;
                  notes?: Array<{ content?: string }>;
                };
                descriptiveNonRepeating?: {
                  title?: { content?: Array<{ content?: string }> };
                  online_media?: {
                    media?: Array<{ content?: string; thumbnail?: string }>;
                  };
                };
              };
            };
          };

          const content = siJson.response;
          if (!content) throw new Error("Empty Smithsonian response");

          let description =
            content.content?.freetext?.notes?.[0]?.content ??
            content.content?.descriptiveNonRepeating?.title?.content?.[0]
              ?.content ??
            null;

          if (description && !isK12Safe(description)) {
            description = "[Content filtered]";
          }

          const detail: ArtifactDetail = {
            id: content.id ?? input.id,
            title: content.title ?? "Untitled",
            date:
              content.content?.freetext?.date?.[0]?.content ?? "Unknown",
            medium:
              content.content?.freetext?.physicalDescription?.[0]?.content ??
              null,
            dimensions:
              content.content?.freetext?.physicalDescription?.[1]?.content ??
              null,
            provenance:
              content.content?.freetext?.creditLine?.[0]?.content ?? null,
            description,
            imageUrl:
              content.content?.descriptiveNonRepeating?.online_media
                ?.media?.[0]?.content ?? null,
            source: "smithsonian",
            metadata: content as Record<string, unknown>,
          };

          setCached(cacheKey, detail);
          return detail;
        } catch {
          // Return empty detail on failure
          return {
            id: input.id,
            title: "Unavailable",
            date: "Unknown",
            medium: null,
            dimensions: null,
            provenance: null,
            description: null,
            imageUrl: null,
            source: "smithsonian",
            metadata: {},
          };
        }
      }

      // ── Library of Congress ──
      try {
        const locUrl = `https://www.loc.gov/item/${encodeURIComponent(input.id)}/?fo=json`;
        const locRes = await fetch(locUrl);
        if (!locRes.ok) throw new Error(`LoC responded ${locRes.status}`);

        const locJson = (await locRes.json()) as {
          item?: {
            title?: string;
            date?: string;
            description?: string[];
            image_url?: string[];
            medium?: string;
            dimensions?: string;
            created_published?: string;
          };
        };

        const item = locJson.item;
        if (!item) throw new Error("Empty LoC response");

        let description = item.description?.[0] ?? null;
        if (description && !isK12Safe(description)) {
          description = "[Content filtered]";
        }

        const detail: ArtifactDetail = {
          id: input.id,
          title: item.title ?? "Untitled",
          date: item.date ?? "Unknown",
          medium: item.medium ?? null,
          dimensions: item.dimensions ?? null,
          provenance: item.created_published ?? null,
          description,
          imageUrl: item.image_url?.[0] ?? null,
          source: "loc",
          metadata: item as Record<string, unknown>,
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
          source: "loc",
          metadata: {},
        };
      }
    }),
});
