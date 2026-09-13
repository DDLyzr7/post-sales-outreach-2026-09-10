import { createClient } from "@/lib/supabase/server";
import type { ContactType } from "@/lib/types";

/**
 * Report reads. Each is a SECURITY INVOKER function: RLS applies inside, and the
 * functions return only the caller's own numbers unless the caller is the
 * post-sales lead. Nothing here filters by user.
 */

export type PersonReport = {
  user_id: string;
  full_name: string;
  title: string | null;
  accounts_owned: number;
  emails_in_window: number;
  active_weeks: number;
  weekly_counts: number[];
  emailed_30d: number;
  emailed_60d: number;
  quiet_accounts: number;
  never_emailed: number;
  replies: number;
  bounces: number;
};

export type MaterialItem = {
  email_id: string;
  sent_at: string;
  sender_id: string | null;
  sender_name: string | null;
  account_id: string;
  account_name: string;
  contact_name: string | null;
  contact_type: ContactType | null;
  collateral_id: string;
  collateral_title: string;
  product_names: string[];
  verdict: "relevant" | "off_target" | "untagged";
};

export type CampaignReport = {
  campaign_id: string;
  name: string;
  status: string;
  started_at: string | null;
  completed_at: string | null;
  recipients: number;
  queued: number;
  sent: number;
  replied: number;
  bounced: number;
  failed: number;
  skipped: number;
  skip_reasons: Record<string, number>;
};

export async function getReports(weeks: number, materialDays: number) {
  const supabase = await createClient();
  const [people, material, campaigns] = await Promise.all([
    supabase.rpc("report_people", { p_weeks: weeks }),
    supabase.rpc("report_material", { p_days: materialDays }),
    supabase.rpc("report_campaigns"),
  ]);
  const error = people.error ?? material.error ?? campaigns.error;
  if (error) throw error;
  return {
    people: (people.data ?? []) as PersonReport[],
    material: (material.data ?? []) as MaterialItem[],
    campaigns: (campaigns.data ?? []) as CampaignReport[],
  };
}
