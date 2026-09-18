import type { CollateralFact } from "@/lib/types";

/**
 * How collateral goes into an email: as a plain link in the body (no tracking).
 * A piece of collateral counts as "in the email" when its link is in the body,
 * so draft_context.collateral_ids always matches what the recipient will see.
 */

/** Claude marks where a link goes with {{link:<collateral id>}}. */
const LINK_TOKEN = /\{\{\s*link:\s*([0-9a-f-]{36})\s*\}\}/gi;

type Linkable = Pick<CollateralFact, "collateral_id" | "title" | "asset_url">;

/** One line for an added piece of collateral: "Title: https://..." */
export function collateralLine(item: Pick<Linkable, "title" | "asset_url">): string {
  return `${item.title}: ${item.asset_url}`;
}

/** Inserts text as its own paragraph before the sign-off (the last paragraph). */
export function insertBeforeSignOff(body: string, text: string): string {
  const paragraphs = body.trimEnd().split(/\n{2,}/);
  if (paragraphs.length < 2) return `${body.trimEnd()}\n\n${text}`;
  paragraphs.splice(paragraphs.length - 1, 0, text);
  return paragraphs.join("\n\n");
}

/**
 * Turns Claude's {{link:id}} markers into the collateral's link and drops markers
 * for anything not on the list. Collateral Claude says it mentioned but left no
 * marker for gets a "Title: link" line before the sign-off.
 */
export function placeLinks(
  body: string,
  mentionedIds: string[],
  items: Linkable[],
): { body: string; collateralIds: string[] } {
  const byId = new Map(items.map((item) => [item.collateral_id, item]));
  const placed = new Set<string>();

  let out = body.replace(LINK_TOKEN, (_match, id: string) => {
    const item = byId.get(id.toLowerCase());
    if (!item) return "";
    placed.add(item.collateral_id);
    return item.asset_url;
  });

  for (const id of mentionedIds) {
    const item = byId.get(id);
    if (item && !placed.has(id) && !out.includes(item.asset_url)) {
      out = insertBeforeSignOff(out, collateralLine(item));
      placed.add(id);
    }
  }

  out = out.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return { body: out, collateralIds: linkedCollateralIds(out, items) };
}

/** The collateral whose link is in the body, in list order. */
export function linkedCollateralIds(body: string, items: Pick<Linkable, "collateral_id" | "asset_url">[]): string[] {
  return [...new Set(items.filter((item) => body.includes(item.asset_url)).map((item) => item.collateral_id))];
}

/** Hosts of every link in the text, lowercased. */
export function linkHosts(text: string): string[] {
  const hosts = new Set<string>();
  for (const match of text.matchAll(/https?:\/\/([^\s/:?#@]+)/gi)) hosts.add(match[1].toLowerCase());
  return [...hosts];
}
