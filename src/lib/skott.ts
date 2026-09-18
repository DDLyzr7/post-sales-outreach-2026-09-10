/**
 * Skott, Lyzr's marketing and sales knowledge base, reached as an MCP server over
 * HTTP with two read-only tools:
 *
 *   list_kb    every item, grouped into sections (stops at 100 in some sections)
 *   search_kb  semantic search, reranked, with a 0-10 relevance score
 *
 * Items are links, never files. Server-only: the key never reaches the browser.
 * The feed job lists; collateral search and drafting search. Every call returns
 * null on any failure, so callers fall back to the library in Postgres.
 */

export type SkottItem = {
  id: string;
  title: string;
  /** Skott's type, e.g. case-study, one-pager, blog. */
  type: string;
  url: string;
  /** wordpress, sharepoint or pipeline-tracker. */
  source: string | null;
  /** yyyy-mm-dd, when Skott gives a date. */
  published_on: string | null;
};

export type SkottHit = SkottItem & { score: number | null };

type RawItem = {
  id?: unknown; title?: unknown; type?: unknown; url?: unknown;
  source?: unknown; fileSource?: unknown; date?: unknown;
  llmScore?: unknown; similarity?: unknown;
};

export function skottConfigured(): boolean {
  return !!process.env.SKOTT_MCP_URL && !!process.env.SKOTT_API_KEY;
}

const ENTITIES: Record<string, string> = { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", nbsp: " " };

/** WordPress titles arrive HTML-encoded ("Talent &#038; QA", "Leader&#8217;s"). */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code: string) => {
    if (code[0] === "#") {
      const n = code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : match;
    }
    return ENTITIES[code.toLowerCase()] ?? match;
  });
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** "Aug 7, 2026" -> "2026-08-07". Anything else -> null. */
function parseDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = /^([A-Za-z]{3})[a-z]*\.? (\d{1,2}), (\d{4})$/.exec(value.trim());
  if (!match) return null;
  const month = MONTHS.indexOf(match[1].toLowerCase());
  if (month < 0) return null;
  return `${match[3]}-${String(month + 1).padStart(2, "0")}-${match[2].padStart(2, "0")}`;
}

function toItem(raw: RawItem): SkottItem | null {
  if (typeof raw.id !== "string" || typeof raw.title !== "string" || typeof raw.url !== "string") return null;
  const title = decodeEntities(raw.title).trim();
  if (!raw.id || !title || !/^https?:\/\//i.test(raw.url)) return null;
  const source = typeof raw.source === "string" ? raw.source : typeof raw.fileSource === "string" ? raw.fileSource : null;
  return {
    id: raw.id,
    title,
    type: typeof raw.type === "string" ? raw.type : "other",
    url: raw.url.trim(),
    source,
    published_on: parseDate(raw.date),
  };
}

let requestId = 0;

/** One tools/call. The server answers as JSON or as a single server-sent event. */
async function callTool(name: string, args: Record<string, unknown>, timeoutMs: number): Promise<unknown> {
  const response = await fetch(process.env.SKOTT_MCP_URL!, {
    method: "POST",
    headers: {
      authorization: `Bearer ${process.env.SKOTT_API_KEY}`,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++requestId, method: "tools/call", params: { name, arguments: args } }),
    signal: AbortSignal.timeout(timeoutMs),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Skott ${name}: HTTP ${response.status}`);

  const raw = await response.text();
  const payload = (response.headers.get("content-type") ?? "").includes("text/event-stream")
    ? raw
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .at(-1) ?? ""
    : raw;

  const message = JSON.parse(payload) as {
    result?: { isError?: boolean; content?: { type: string; text?: string }[] };
    error?: { message?: string };
  };
  if (message.error) throw new Error(`Skott ${name}: ${message.error.message ?? "error"}`);
  const text = message.result?.content?.find((c) => c.type === "text")?.text;
  if (message.result?.isError || !text) throw new Error(`Skott ${name}: ${text ?? "empty result"}`);
  return JSON.parse(text);
}

/** The whole library, for the feed job. Throws, so a failed read writes nothing. */
export async function listSkott(): Promise<SkottItem[]> {
  if (!skottConfigured()) throw new Error("SKOTT_MCP_URL and SKOTT_API_KEY are not set in .env.local.");
  const data = (await callTool("list_kb", {}, 60_000)) as { sections?: { items?: RawItem[] }[] };
  if (!Array.isArray(data.sections)) throw new Error("Skott list_kb: no sections in the response.");

  const seen = new Set<string>();
  const items: SkottItem[] = [];
  for (const section of data.sections) {
    for (const raw of section.items ?? []) {
      const item = toItem(raw);
      if (item && !seen.has(item.id)) {
        seen.add(item.id);
        items.push(item);
      }
    }
  }
  return items;
}

/** Semantic search, best first. Null when Skott isn't configured, is slow or fails. */
export async function searchSkott(
  query: string,
  options: { limit?: number; timeoutMs?: number } = {},
): Promise<SkottHit[] | null> {
  if (!skottConfigured() || !query.trim()) return null;
  try {
    const data = (await callTool(
      "search_kb",
      { query: query.trim().slice(0, 500), limit: options.limit ?? 15 },
      options.timeoutMs ?? 20_000,
    )) as { results?: RawItem[] };

    return (data.results ?? []).flatMap((raw) => {
      const item = toItem(raw);
      if (!item) return [];
      const score = typeof raw.llmScore === "number" ? raw.llmScore : typeof raw.similarity === "number" ? raw.similarity * 10 : null;
      return [{ ...item, score }];
    });
  } catch (error) {
    // Search still works from the library; log so a bad key or an outage is visible.
    console.error("skott search failed:", error instanceof Error ? error.message : error);
    return null;
  }
}
