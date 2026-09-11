import Anthropic from "@anthropic-ai/sdk";

/**
 * The one Anthropic client for the app. Server-only: ANTHROPIC_API_KEY must never
 * reach the browser, so nothing under src/lib/ai is imported by a client component.
 * Null when the key is missing, and every caller then falls back to working
 * without Claude.
 */

export const MODEL = "claude-opus-5";

// If Claude Opus 5 declines, the API re-runs the request on Anthropic's
// recommended fallback model instead of returning a refusal.
export const FALLBACK: { betas: string[]; fallbacks: "default" } = {
  betas: ["server-side-fallback-2026-07-01"],
  fallbacks: "default",
};

export const anthropic = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ maxRetries: 1, timeout: 60_000 })
  : null;

export function logClaudeError(feature: string, error: unknown) {
  if (error instanceof Anthropic.APIError) {
    console.error(`${feature}: Claude returned ${error.status}: ${error.message}`);
  } else {
    console.error(`${feature}: Claude unavailable:`, error);
  }
}
