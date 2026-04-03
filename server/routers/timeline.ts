/**
 * Timeline Router
 * Fetches real historical events from the Wikipedia "On This Day" REST API.
 * No API key required — Wikipedia's public REST API is free and open.
 * Endpoint: https://en.wikipedia.org/api/rest_v1/feed/onthisday/events/{month}/{day}
 *
 * For topic-based queries we sample multiple dates across the year and filter
 * events by keyword relevance, then return a shuffled set of 6-8 events with
 * their correct chronological order stored server-side.
 */

import { z } from "zod";
import { publicProcedure, router } from "../_core/trpc";
import { TRPCError } from "@trpc/server";

// ─── Types ────────────────────────────────────────────────────────────────────

interface WikiEvent {
  year: number;
  text: string;
  pages?: Array<{
    title: string;
    thumbnail?: { source: string };
    extract?: string;
  }>;
}

interface TimelineEvent {
  id: string;
  title: string;
  year: number;
  description: string;
  imageUrl?: string;
}

// ─── Topic → keyword mapping ──────────────────────────────────────────────────
// Maps topic names to search keywords and date ranges for filtering Wikipedia events.

const TOPIC_CONFIG: Record<
  string,
  { keywords: string[]; minYear: number; maxYear: number; sampleDates: [number, number][] }
> = {
  "American Civil War": {
    keywords: ["civil war", "union", "confederate", "lincoln", "slavery", "emancipation", "gettysburg", "appomattox", "fort sumter", "reconstruction"],
    minYear: 1861,
    maxYear: 1865,
    sampleDates: [[4,12],[1,1],[7,1],[9,22],[11,19],[4,9],[12,6],[3,4],[5,1],[6,1]],
  },
  "American Revolution": {
    keywords: ["revolution", "colonial", "independence", "british", "continental", "washington", "lexington", "concord", "valley forge", "treaty of paris", "boston"],
    minYear: 1770,
    maxYear: 1783,
    sampleDates: [[7,4],[4,19],[3,5],[12,16],[6,17],[10,19],[9,3],[2,1],[5,1],[8,1]],
  },
  "Ancient Rome": {
    keywords: ["rome", "roman", "caesar", "emperor", "senate", "republic", "augustus", "pompeii", "colosseum", "constantine", "gladiator"],
    minYear: -500,
    maxYear: 476,
    sampleDates: [[3,15],[1,16],[8,24],[6,1],[9,1],[10,1],[11,1],[12,1],[2,1],[4,1]],
  },
  "World War II": {
    keywords: ["world war", "nazi", "hitler", "allied", "d-day", "pearl harbor", "hiroshima", "normandy", "holocaust", "surrender", "atomic"],
    minYear: 1939,
    maxYear: 1945,
    sampleDates: [[9,1],[6,6],[12,7],[8,6],[5,8],[8,15],[1,1],[2,1],[3,1],[4,1]],
  },
  "Space Race": {
    keywords: ["nasa", "space", "moon", "apollo", "sputnik", "astronaut", "orbit", "rocket", "shuttle", "satellite", "cosmonaut"],
    minYear: 1957,
    maxYear: 1972,
    sampleDates: [[7,20],[10,4],[4,12],[2,20],[6,16],[3,18],[1,27],[4,24],[5,25],[9,1]],
  },
  "French Revolution": {
    keywords: ["french revolution", "bastille", "napoleon", "republic", "guillotine", "robespierre", "marie antoinette", "liberty", "reign of terror"],
    minYear: 1789,
    maxYear: 1799,
    sampleDates: [[7,14],[8,26],[9,21],[1,21],[10,16],[11,9],[6,20],[4,5],[3,1],[5,1]],
  },
  "Cold War": {
    keywords: ["cold war", "soviet", "nuclear", "berlin wall", "cuban missile", "nato", "arms race", "iron curtain", "communism", "détente", "reagan", "gorbachev"],
    minYear: 1947,
    maxYear: 1991,
    sampleDates: [[11,9],[10,4],[10,22],[8,13],[3,5],[6,25],[1,1],[7,1],[9,1],[12,1]],
  },
  "Industrial Revolution": {
    keywords: ["industrial", "steam engine", "factory", "railroad", "invention", "textile", "coal", "iron", "watt", "edison", "telegraph", "locomotive"],
    minYear: 1760,
    maxYear: 1900,
    sampleDates: [[1,1],[3,1],[5,1],[7,1],[9,1],[11,1],[2,1],[4,1],[6,1],[8,1]],
  },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function fetchWikiEventsForDate(month: number, day: number): Promise<WikiEvent[]> {
  const url = `https://en.wikipedia.org/api/rest_v1/feed/onthisday/events/${month}/${day}`;
  const res = await fetch(url, {
    headers: { "User-Agent": "ChatBridge-TutorMeAI/1.0 (educational; contact: admin@chatbridge.app)" },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) return [];
  const data = await res.json() as { events?: WikiEvent[] };
  return data.events ?? [];
}

function scoreEvent(event: WikiEvent, keywords: string[]): number {
  const text = event.text.toLowerCase();
  return keywords.reduce((score, kw) => score + (text.includes(kw) ? 1 : 0), 0);
}

function slugify(text: string, year: number, idx: number): string {
  return `${text.slice(0, 20).toLowerCase().replace(/[^a-z0-9]/g, "_")}_${year}_${idx}`;
}

async function fetchTopicEvents(topicName: string): Promise<TimelineEvent[]> {
  const config = TOPIC_CONFIG[topicName];
  if (!config) throw new Error(`Unknown topic: ${topicName}`);

  const { keywords, minYear, maxYear, sampleDates } = config;
  const allEvents: WikiEvent[] = [];

  // Fetch events from multiple dates in parallel (max 5 concurrent)
  const batches = sampleDates.slice(0, 6);
  const results = await Promise.allSettled(
    batches.map(([m, d]) => fetchWikiEventsForDate(m, d))
  );
  results.forEach(r => {
    if (r.status === "fulfilled") allEvents.push(...r.value);
  });

  // Filter by year range and keyword relevance
  const scored = allEvents
    .filter(e => e.year >= minYear && e.year <= maxYear)
    .map(e => ({ event: e, score: scoreEvent(e, keywords) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score);

  // Deduplicate by year (keep highest scored per year)
  const byYear = new Map<number, WikiEvent>();
  for (const { event } of scored) {
    if (!byYear.has(event.year)) byYear.set(event.year, event);
  }

  const unique = Array.from(byYear.values()).sort((a, b) => a.year - b.year);

  // Need at least 4 events for a playable game; if not enough, return empty to trigger fallback
  if (unique.length < 4) return [];

  // Take 6-8 events spread across the time range
  const selected = unique.length <= 8 ? unique : selectSpread(unique, 6);

  return selected.map((e, idx) => {
    const page = e.pages?.[0];
    return {
      id: slugify(e.text, e.year, idx),
      title: e.text.length > 80 ? e.text.slice(0, 77) + "…" : e.text,
      year: e.year,
      description: page?.extract
        ? page.extract.slice(0, 200) + (page.extract.length > 200 ? "…" : "")
        : e.text,
      imageUrl: page?.thumbnail?.source,
    };
  });
}

/** Pick `count` events spread evenly across the array */
function selectSpread<T>(arr: T[], count: number): T[] {
  if (arr.length <= count) return arr;
  const step = (arr.length - 1) / (count - 1);
  return Array.from({ length: count }, (_, i) => arr[Math.round(i * step)]);
}

// ─── Fallback hardcoded data (used when Wikipedia returns insufficient results) ─

const FALLBACK_TOPICS: Record<string, TimelineEvent[]> = {
  "American Civil War": [
    { id: "acw1", title: "Battle of Fort Sumter", year: 1861, description: "Confederate forces attack the Union garrison, starting the Civil War." },
    { id: "acw2", title: "Emancipation Proclamation", year: 1863, description: "Lincoln declares enslaved people in Confederate states to be free." },
    { id: "acw3", title: "Battle of Gettysburg", year: 1863, description: "Three-day battle that turned the tide in favor of the Union." },
    { id: "acw4", title: "Sherman's March to the Sea", year: 1864, description: "Union forces sweep through Georgia, destroying Confederate infrastructure." },
    { id: "acw5", title: "Surrender at Appomattox", year: 1865, description: "Lee surrenders to Grant, effectively ending the Civil War." },
    { id: "acw6", title: "13th Amendment Ratified", year: 1865, description: "Constitutional amendment abolishing slavery throughout the United States." },
  ],
  "American Revolution": [
    { id: "ar1", title: "Boston Massacre", year: 1770, description: "British soldiers kill five colonists, fueling anti-British sentiment." },
    { id: "ar2", title: "Boston Tea Party", year: 1773, description: "Colonists dump British tea into Boston Harbor to protest taxation." },
    { id: "ar3", title: "Battles of Lexington and Concord", year: 1775, description: "First military engagements of the Revolutionary War." },
    { id: "ar4", title: "Declaration of Independence", year: 1776, description: "The thirteen colonies formally declare independence from Britain." },
    { id: "ar5", title: "Winter at Valley Forge", year: 1777, description: "Continental Army endures brutal winter, emerging stronger and more disciplined." },
    { id: "ar6", title: "Treaty of Paris", year: 1783, description: "Britain recognizes American independence, ending the Revolutionary War." },
  ],
  "Ancient Rome": [
    { id: "rome1", title: "Assassination of Julius Caesar", year: -44, description: "Caesar is killed by senators on the Ides of March, triggering civil war." },
    { id: "rome2", title: "Augustus Becomes First Emperor", year: -27, description: "Octavian becomes Augustus, founding the Roman Empire." },
    { id: "rome3", title: "Eruption of Mount Vesuvius", year: 79, description: "Pompeii and Herculaneum are buried under volcanic ash." },
    { id: "rome4", title: "Colosseum Completed", year: 80, description: "The Flavian Amphitheatre opens, seating 50,000 spectators." },
    { id: "rome5", title: "Constantine's Conversion", year: 312, description: "Emperor Constantine converts to Christianity, transforming the Empire." },
    { id: "rome6", title: "Fall of the Western Roman Empire", year: 476, description: "Odoacer deposes Romulus Augustulus, ending Western Rome." },
  ],
  "World War II": [
    { id: "ww2_1", title: "Germany Invades Poland", year: 1939, description: "Nazi Germany launches a blitzkrieg invasion, triggering declarations of war." },
    { id: "ww2_2", title: "Battle of Britain", year: 1940, description: "The RAF defeats the Luftwaffe, preventing a German invasion of Britain." },
    { id: "ww2_3", title: "Attack on Pearl Harbor", year: 1941, description: "Japan's surprise attack brings the United States into the war." },
    { id: "ww2_4", title: "D-Day Invasion", year: 1944, description: "Allied forces land at Normandy in the largest seaborne invasion in history." },
    { id: "ww2_5", title: "V-E Day", year: 1945, description: "Germany surrenders unconditionally, ending the war in Europe." },
    { id: "ww2_6", title: "Atomic Bombs on Japan", year: 1945, description: "The US drops atomic bombs on Hiroshima and Nagasaki, ending the Pacific war." },
  ],
  "Space Race": [
    { id: "sr1", title: "Sputnik Launched", year: 1957, description: "The Soviet Union launches the first artificial satellite into orbit." },
    { id: "sr2", title: "Yuri Gagarin in Space", year: 1961, description: "Gagarin becomes the first human to orbit Earth." },
    { id: "sr3", title: "John Glenn Orbits Earth", year: 1962, description: "Glenn becomes the first American to orbit Earth." },
    { id: "sr4", title: "Apollo 1 Fire", year: 1967, description: "Three astronauts die in a launchpad fire, setting back the moon program." },
    { id: "sr5", title: "Moon Landing — Apollo 11", year: 1969, description: "Neil Armstrong and Buzz Aldrin become the first humans on the Moon." },
    { id: "sr6", title: "Apollo 17 — Last Moon Mission", year: 1972, description: "The final crewed lunar landing mission returns to Earth." },
  ],
  "French Revolution": [
    { id: "fr1", title: "Storming of the Bastille", year: 1789, description: "Parisians storm the Bastille prison, marking the start of the Revolution." },
    { id: "fr2", title: "Declaration of the Rights of Man", year: 1789, description: "The National Assembly adopts foundational principles of liberty and equality." },
    { id: "fr3", title: "Execution of Louis XVI", year: 1793, description: "King Louis XVI is guillotined, ending the French monarchy." },
    { id: "fr4", title: "Reign of Terror", year: 1793, description: "Robespierre leads a period of mass executions of perceived enemies." },
    { id: "fr5", title: "Fall of Robespierre", year: 1794, description: "Robespierre is arrested and executed, ending the Reign of Terror." },
    { id: "fr6", title: "Napoleon's Coup", year: 1799, description: "Napoleon seizes power in the 18 Brumaire coup, ending the Revolution." },
  ],
  "Cold War": [
    { id: "cw1", title: "Truman Doctrine", year: 1947, description: "US commits to containing Soviet expansion worldwide." },
    { id: "cw2", title: "Berlin Blockade", year: 1948, description: "Soviets blockade West Berlin; Allies respond with a massive airlift." },
    { id: "cw3", title: "Korean War Begins", year: 1950, description: "North Korea invades South Korea, drawing in US and UN forces." },
    { id: "cw4", title: "Cuban Missile Crisis", year: 1962, description: "US and USSR come to the brink of nuclear war over missiles in Cuba." },
    { id: "cw5", title: "Berlin Wall Falls", year: 1989, description: "East Germany opens the Berlin Wall, symbolizing the end of the Cold War." },
    { id: "cw6", title: "Soviet Union Dissolves", year: 1991, description: "The USSR formally ceases to exist, ending the Cold War era." },
  ],
  "Industrial Revolution": [
    { id: "ir1", title: "Watt's Steam Engine Patent", year: 1769, description: "James Watt patents an improved steam engine, powering the Industrial Revolution." },
    { id: "ir2", title: "First Factory System", year: 1771, description: "Richard Arkwright opens the first water-powered cotton mill in Cromford." },
    { id: "ir3", title: "First Steam Locomotive", year: 1804, description: "Richard Trevithick demonstrates the first steam-powered railway locomotive." },
    { id: "ir4", title: "Luddite Movement", year: 1811, description: "Workers smash machinery in protest against industrialization." },
    { id: "ir5", title: "First Public Railway", year: 1825, description: "The Stockton and Darlington Railway opens as the first public steam railway." },
    { id: "ir6", title: "Transcontinental Railroad Completed", year: 1869, description: "The US transcontinental railroad is finished, connecting the continent." },
  ],
};

// ─── Router ───────────────────────────────────────────────────────────────────

export const timelineRouter = router({
  /**
   * Fetch historical events for a given topic from Wikipedia's On This Day API.
   * Falls back to curated data if Wikipedia returns insufficient results.
   */
  getEvents: publicProcedure
    .input(z.object({ topic: z.string().min(1).max(200) }))
    .query(async ({ input }) => {
      const { topic } = input;
      const availableTopics = Object.keys(TOPIC_CONFIG);

      if (!TOPIC_CONFIG[topic]) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Unknown topic: "${topic}". Available topics: ${availableTopics.join(", ")}`,
        });
      }

      let events: TimelineEvent[] = [];
      let source: "wikipedia" | "curated" = "wikipedia";

      try {
        events = await fetchTopicEvents(topic);
      } catch (err) {
        console.warn(`[Timeline] Wikipedia API failed for topic "${topic}":`, err);
      }

      // Fall back to curated data if Wikipedia didn't return enough
      if (events.length < 4) {
        events = FALLBACK_TOPICS[topic] ?? [];
        source = "curated";
      }

      if (events.length === 0) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `No events found for topic: "${topic}"`,
        });
      }

      // Correct chronological order (server-side ground truth)
      const correctOrder = [...events].sort((a, b) => a.year - b.year).map(e => e.id);

      return {
        topic,
        events,
        correctOrder,
        source,
        availableTopics,
      };
    }),

  /**
   * List all available topics.
   */
  listTopics: publicProcedure.query(() => {
    return {
      topics: Object.keys(TOPIC_CONFIG),
    };
  }),
});
