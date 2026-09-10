import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { COLLATERAL_TYPE_LABEL, FUNCTION_LABEL } from "@/lib/format";
import type { BusinessFunction, CollateralSearchPlan, ProductOption } from "@/lib/types";

/**
 * Turns a plain-language collateral request into terms the database ranks on.
 *
 * Claude only picks products, roles and content types from the lists it is
 * given, so its output can't name anything that doesn't exist. This returns null
 * whenever Claude can't help (no key, a refusal, an error or a timeout), and the
 * page falls back to a plain word search. Server-only: the key never reaches the
 * browser.
 */

const MODEL = "claude-opus-5";

const FUNCTIONS = Object.keys(FUNCTION_LABEL) as [BusinessFunction, ...BusinessFunction[]];
const CONTENT_TYPES = Object.keys(COLLATERAL_TYPE_LABEL) as [string, ...string[]];

const client = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ maxRetries: 1, timeout: 20_000 })
  : null;

function planSchema(productKeys: string[]) {
  return z.object({
    keywords: z
      .array(z.string())
      .describe("1-6 short topic words or phrases likely to appear in a title or summary. Not role titles or product names."),
    product_keys: productKeys.length
      ? z.array(z.enum(productKeys as [string, ...string[]]))
      : z.array(z.string()),
    functions: z.array(z.enum(FUNCTIONS)),
    content_types: z.array(z.enum(CONTENT_TYPES)),
  });
}

function systemPrompt(products: ProductOption[]): string {
  const productLines = products
    .map((p) => `- ${p.key}: ${p.name}${p.description ? ` - ${p.description}` : ""} (usually for: ${p.target_functions.join(", ") || "anyone"})`)
    .join("\n");

  return `You turn a post-sales teammate's request for marketing collateral into search terms for the collateral library. The material goes to people at client companies the team already works with.

Products:
${productLines || "- (none listed)"}

Roles, as business functions: hr (CHRO, people operations), marketing (CMO, growth), finance (CFO, controller), sales (CRO, sales leaders), operations (COO, operations leaders), it (CIO, CTO, IT), legal (general counsel, compliance, risk), product (product and e-commerce leaders), executive (CEO, founders), other.

Content types: ${CONTENT_TYPES.join(", ")}.

Fill in:
- keywords: the topics or pain points in the request.
- product_keys: products the request names or clearly implies.
- functions: the role of the person the material is for, when stated or implied. A CFO is finance.
- content_types: only when the request asks for a kind of material, such as a case study.

Leave a list empty rather than guess.`;
}

export async function planCollateralSearch(
  query: string,
  products: ProductOption[],
): Promise<CollateralSearchPlan | null> {
  if (!client) return null;
  const productKeys = products.map((p) => p.key);

  try {
    const response = await client.beta.messages.parse({
      model: MODEL,
      max_tokens: 16000,
      // If Claude Opus 5 declines, the API re-runs the request on Anthropic's
      // recommended fallback model instead of returning a refusal.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: {
        effort: "low",
        format: zodOutputFormat(planSchema(productKeys)),
      },
      system: systemPrompt(products),
      messages: [{ role: "user", content: query }],
    });

    if (response.stop_reason === "refusal" || !response.parsed_output) return null;

    const out = response.parsed_output;
    const known = new Set(productKeys);
    return {
      keywords: out.keywords.map((k) => k.trim()).filter(Boolean).slice(0, 8),
      product_keys: out.product_keys.filter((k) => known.has(k)),
      functions: out.functions,
      content_types: out.content_types,
    };
  } catch (error) {
    // Search still works without Claude; log so a bad key or an outage is visible.
    if (error instanceof Anthropic.APIError) {
      console.error(`collateral search: Claude returned ${error.status}: ${error.message}`);
    } else {
      console.error("collateral search: Claude unavailable:", error);
    }
    return null;
  }
}
