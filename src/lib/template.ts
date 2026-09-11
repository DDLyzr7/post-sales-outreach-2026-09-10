/**
 * Template merge for drafts. Claude normally writes the draft; this is the
 * fallback when Claude is unavailable, and it never invents content: a variable
 * with no known value becomes a [[marker]] the owner has to fill in.
 */

const VARIABLE = /\{\{\s*([a-z0-9_]+)\s*\}\}/gi;

/** Unfilled template variables or [[notes for the owner]]. */
const PLACEHOLDER = /\{\{[^}]*\}\}|\[\[[^\]]*\]\]/g;

export function fillTemplate(template: string, values: Record<string, string | null | undefined>): string {
  return template.replace(VARIABLE, (_match, name: string) => {
    const value = values[name];
    return value ? value : `[[${name.replace(/_/g, " ")}]]`;
  });
}

/** Every distinct placeholder left in the text, in order of appearance. */
export function findPlaceholders(text: string): string[] {
  return [...new Set(text.match(PLACEHOLDER) ?? [])];
}
