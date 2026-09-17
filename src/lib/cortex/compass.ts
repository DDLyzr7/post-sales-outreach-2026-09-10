/**
 * Compass, the Cortex subtool that holds customer success data: lifecycle status,
 * the CSM, health, commercials, use cases, contacts and the account plan.
 * Server-only: the key never reaches the browser, and only the sync job calls this.
 *
 *   GET /api/v1/workspace/accounts?page=&page_size=   Authorization: Bearer <key>
 */

export type CompassPlanItem = { title: string; description?: string | null; status?: string | null; owner?: string | null; due_date?: string | null };

export type CompassAccount = {
  account_id: string;
  account: string;
  last_updated?: string | null;
  identity: {
    name?: string | null;
    industry?: string | null;
    segment?: string | null;
    account_tier?: string | null;
    status?: string | null;
    lifecycle_stages?: string[] | null;
    project_stage?: string | null;
    motion?: string | null;
    is_plg?: boolean | null;
  };
  owners: {
    csm?: string | null;
    csm_email?: string | null;
    sales_rep?: string | null;
    project_manager?: string | null;
  };
  health: {
    status?: string | null;
    label?: string | null;
    band?: string | null;
    score?: number | null;
    narrative?: string | null;
  };
  commercials: {
    arr_usd?: number | null;
    contract_start_date?: string | null;
    contract_end_date?: string | null;
    renewal_date?: string | null;
  };
  agents?: { total_deployed?: number | null; live_use_cases?: number | null } | null;
  use_cases?: {
    use_case_id: string;
    name: string;
    stage?: string | null;
    status?: string | null;
    business_goal?: string | null;
    owner?: string | null;
    current_blocker?: string | null;
    target_date?: string | null;
    updated_at?: string | null;
  }[];
  strategy?: {
    client_brief?: string | null;
    current_state?: string | null;
    main_delivery_concern?: string | null;
    main_commercial_concern?: string | null;
    main_expansion_opportunity?: string | null;
    renewal_posture?: string | null;
    recommended_strategy?: string | null;
    cs_notes?: string | null;
    upsell_notes?: string | null;
  } | null;
  account_plan?: { top_risks?: CompassPlanItem[]; open_decisions?: CompassPlanItem[]; committed_next_actions?: CompassPlanItem[] } | null;
  updates?: { summary?: string | null; sentiment?: string | null; event_at?: string | null }[];
  contacts?: {
    contact_id: string;
    name: string;
    email?: string | null;
    title?: string | null;
    stakeholder_role?: string | null;
    influence_level?: string | null;
    sentiment?: string | null;
    last_interaction_at?: string | null;
  }[];
};

type Page = { accounts: CompassAccount[]; page: number; total_pages: number; has_more: boolean };

const PAGE_SIZE = 50;
const MAX_PAGES = 50;

export function compassConfigured(): boolean {
  return !!process.env.COMPASS_API_KEY && !!process.env.COMPASS_BASE_URL;
}

export async function fetchCompass(): Promise<CompassAccount[]> {
  if (!compassConfigured()) throw new Error("COMPASS_BASE_URL and COMPASS_API_KEY must be set.");

  const accounts = new Map<string, CompassAccount>();
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const url = new URL("/api/v1/workspace/accounts", process.env.COMPASS_BASE_URL);
    url.searchParams.set("page", String(page));
    url.searchParams.set("page_size", String(PAGE_SIZE));
    const response = await fetch(url, {
      headers: { authorization: `Bearer ${process.env.COMPASS_API_KEY}`, accept: "application/json" },
      signal: AbortSignal.timeout(30_000),
      cache: "no-store",
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`Compass accounts returned ${response.status}: ${body.slice(0, 200)}`);
    }
    const json = (await response.json()) as Page;
    for (const account of json.accounts ?? []) accounts.set(account.account_id, account);
    if (!json.has_more) break;
  }
  return [...accounts.values()];
}
