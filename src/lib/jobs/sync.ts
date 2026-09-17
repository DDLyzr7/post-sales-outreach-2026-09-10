import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchCompass, type CompassAccount, type CompassPlanItem } from "@/lib/cortex/compass";
import { fetchHelix, type HelixClient, type HelixContact } from "@/lib/cortex/helix";
import { functionFromTitle } from "@/lib/providers/apollo";
import type { AccountLifecycle, AccountTier, AssignmentRole, HealthStatus } from "@/lib/types";

/**
 * The Cortex sync. Reads Helix and Compass in full, then mirrors them into
 * account, account_source, account_context, account_engagement, account_assignment
 * and contact. Both reads finish before anything is written, so a failed read
 * changes nothing.
 *
 * - Accounts: a Compass account and a Helix client are one account when
 *   cortex_sync.account_matches pairs them, or when their names match. Once linked
 *   in account_source they stay linked, even if a name changes.
 * - Lifecycle comes from Compass's status, then Helix's, then the policy default.
 * - Owners: the Compass CSM becomes the primary owner and PMs of current Helix
 *   projects become co-owners, matched to app users by email. People who haven't
 *   signed in yet are picked up by the first sync after they do. The sync only
 *   retires owners it added itself; owners the lead added stay.
 * - Contacts: client people from Compass and from Helix projects, matched by email
 *   within the account. The sync never touches an opt-out, never deletes a contact,
 *   and only overwrites names and titles on contacts it created.
 * - Accounts that disappear upstream are left alone and counted.
 */

type SyncPolicy = {
  lifecycle: { compass: Record<string, AccountLifecycle>; helix: Record<string, AccountLifecycle>; default: AccountLifecycle };
  health: { compass: Record<string, HealthStatus>; helix: Record<string, HealthStatus> };
  tier: Record<string, AccountTier>;
  owners: {
    compass_csm: { role: AssignmentRole; primary: boolean };
    compass_project_manager?: { role: AssignmentRole; primary: boolean };
    compass_sales_rep?: { role: AssignmentRole; primary: boolean };
    helix_project_manager: { role: AssignmentRole; primary: boolean };
  };
  helix_latest_project_manager_if_none_current?: boolean;
  /** Owner name (lowercase) -> email, for names Compass gives without an email. */
  people?: Record<string, string>;
  ignore_names?: string[];
  active_project_statuses: string[];
  internal_email_domains: string[];
  recent_updates_kept: number;
  account_matches: Record<string, string>;
};

export type SyncJobSummary = {
  helixClients: number;
  compassAccounts: number;
  accounts: { created: number; updated: number; merged: number; withoutOwner: number; lifecycleChanged: number; inBoth: number; compassOnly: number; helixOnly: number };
  engagements: number;
  contacts: { created: number; updated: number };
  owners: {
    added: number;
    retired: number;
    /** Owner rows waiting for that person's first sign-in. */
    pending: number;
    notSignedUp: string[];
    /** Compass owner names that matched no known email; fix with cortex_sync.people. */
    unresolvedNames: string[];
  };
  /** Accounts that no longer appear upstream. Left in place. */
  missingUpstream: number;
  /** Accounts nobody in Helix or Compass owns, and no owner added by the lead. */
  withoutOwner: string[];
  /** Names seen on only one side, so the lead can pair them in account_matches. */
  unpaired: { compass: string[]; helix: string[] };
  warnings: string[];
};

type Merged = { compass: CompassAccount | null; helix: HelixClient | null };

type AccountRow = {
  id: string;
  source_system: string;
  external_id: string | null;
  lifecycle_status: AccountLifecycle;
  domain: string | null;
  deleted_at: string | null;
};

type ContactRow = {
  id: string;
  account_id: string;
  email: string | null;
  source: string;
  title: string | null;
  phone: string | null;
  business_function: string;
  relationship_status: string;
};

type AssignmentRow = {
  id: string;
  account_id: string;
  user_id: string;
  role: AssignmentRole;
  is_primary: boolean;
  deleted_at: string | null;
  source_system: string | null;
};

type DesiredContact = {
  full_name: string;
  email: string;
  title: string | null;
  phone: string | null;
  external_id: string | null;
  stakeholder_role: string | null;
  influence_level: string | null;
  sentiment: string | null;
  last_interaction_at: string | null;
};

const LIST_CAP = 25;
const SUFFIX = /(incorporated|inc|llc|ltd|limited|corp|corporation|company|group|holdings|plc|gmbh|pvt|private)$/;

/** Lowercase letters and digits only, with trailing company suffixes removed. */
export function normaliseName(name: string | null | undefined): string {
  let key = (name ?? "").toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]/g, "");
  for (let i = 0; i < 3; i += 1) {
    const next = key.replace(SUFFIX, "");
    if (next === key || next.length < 3) break;
    key = next;
  }
  return key;
}

function day(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = /^\d{4}-\d{2}-\d{2}/.exec(value);
  return match ? match[0] : null;
}

function text(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed ? trimmed : null;
}

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Awaits a Supabase query and throws on error, so a failed write stops the run. */
async function must<T = unknown>(label: string, query: PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await query;
  if (error) throw new Error(`${label}: ${error.message}`);
  return data as T;
}

/** An ISO timestamp, or null for anything that doesn't parse. Compass omits the zone; it's UTC. */
function instant(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(/[zZ]|[+-]\d{2}:?\d{2}$/.test(value) ? value : `${value}Z`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function planItems(items: CompassPlanItem[] | undefined) {
  return (items ?? []).map((item) => ({
    title: item.title,
    description: text(item.description),
    status: text(item.status),
    owner: text(item.owner),
    due_date: day(item.due_date),
  }));
}

export async function runSyncJob(service: SupabaseClient): Promise<SyncJobSummary> {
  const runStartedAt = new Date().toISOString();

  const policyRow = await must<{ value: SyncPolicy } | null>(
    "app_policy",
    service.from("app_policy").select("value").eq("key", "cortex_sync").maybeSingle(),
  );
  if (!policyRow) throw new Error("app_policy.cortex_sync is missing; push migration 20260917000100.");
  const policy = policyRow.value;

  // 1. Read both systems before writing anything.
  const [{ clients, contactsByProject }, compassAccounts] = await Promise.all([fetchHelix(), fetchCompass()]);

  const summary: SyncJobSummary = {
    helixClients: clients.length,
    compassAccounts: compassAccounts.length,
    accounts: { created: 0, updated: 0, merged: 0, withoutOwner: 0, lifecycleChanged: 0, inBoth: 0, compassOnly: 0, helixOnly: 0 },
    engagements: 0,
    contacts: { created: 0, updated: 0 },
    owners: { added: 0, retired: 0, pending: 0, notSignedUp: [], unresolvedNames: [] },
    missingUpstream: 0,
    withoutOwner: [],
    unpaired: { compass: [], helix: [] },
    warnings: [],
  };

  // 2. Pair Compass accounts with Helix clients.
  type Link = { source_system: "helix" | "compass"; external_id: string; account_id: string };
  const links = await must<Link[]>(
    "account_source",
    service.from("account_source").select("source_system, external_id, account_id").in("source_system", ["helix", "compass"]),
  );
  const linked = new Map(links.map((l) => [`${l.source_system}:${l.external_id}`, l.account_id]));

  const helixById = new Map(clients.map((c) => [c.id, c]));
  const helixByName = new Map<string, HelixClient>();
  for (const client of clients) {
    const key = normaliseName(client.name);
    if (key && !helixByName.has(key)) helixByName.set(key, client);
  }
  const helixByAccount = new Map<string, HelixClient>();
  for (const client of clients) {
    const accountId = linked.get(`helix:${client.id}`);
    if (accountId) helixByAccount.set(accountId, client);
  }

  const claimed = new Set<string>();
  const merged: Merged[] = [];
  for (const account of compassAccounts) {
    const accountId = linked.get(`compass:${account.account_id}`);
    const explicit = policy.account_matches?.[account.account_id];
    let helix: HelixClient | undefined;
    if (explicit) {
      helix = helixById.get(explicit);
      if (!helix) summary.warnings.push(`account_matches names Helix client ${explicit}, which Helix didn't return.`);
    }
    helix ??= accountId ? helixByAccount.get(accountId) : undefined;
    helix ??= helixByName.get(normaliseName(account.identity?.name ?? account.account));
    if (helix && claimed.has(helix.id)) {
      summary.warnings.push(`Helix client ${helix.name} matches more than one Compass account; paired with the first.`);
      helix = undefined;
    }
    if (helix) claimed.add(helix.id);
    merged.push({ compass: account, helix: helix ?? null });
  }
  for (const client of clients) {
    if (!claimed.has(client.id)) merged.push({ compass: null, helix: client });
  }

  // 3. Every account row the sync has written, including ones deleted in the app.
  // Matching on (source_system, external_id) too means a run that stopped between
  // inserting an account and linking it doesn't insert a duplicate next time.
  const syncedAccounts = await must<AccountRow[]>(
    "account",
    service
      .from("account")
      .select("id, source_system, external_id, lifecycle_status, domain, deleted_at")
      .in("source_system", ["helix", "compass"]),
  );
  const accountById = new Map(syncedAccounts.map((row) => [row.id, row]));
  const accountByKey = new Map(syncedAccounts.map((row) => [`${row.source_system}:${row.external_id}`, row.id]));
  const linkedIds = [...new Set(links.map((l) => l.account_id))];

  // 4. Accounts and their source links.
  const now = new Date().toISOString();
  const seenAccountIds = new Set<string>();
  // A Helix client newly paired with a Compass account that was already synced on
  // its own: its old Helix-only account id -> the Compass account it joins.
  const mergeInto = new Map<string, { keep: string; label: string }>();
  const accountFor = new Map<Merged, string>();

  for (const entry of merged) {
    const { compass, helix } = entry;
    if (compass && helix) summary.accounts.inBoth += 1;
    else if (compass) summary.accounts.compassOnly += 1;
    else summary.accounts.helixOnly += 1;

    const compassLinked = compass ? linked.get(`compass:${compass.account_id}`) : undefined;
    const helixLinked = helix ? linked.get(`helix:${helix.id}`) : undefined;
    if (compassLinked && helixLinked && compassLinked !== helixLinked) {
      mergeInto.set(helixLinked, { keep: compassLinked, label: `${compass!.account} / ${helix!.name}` });
    }
    let accountId =
      compassLinked ??
      helixLinked ??
      (compass ? accountByKey.get(`compass:${compass.account_id}`) : undefined) ??
      (helix ? accountByKey.get(`helix:${helix.id}`) : undefined);
    const current = accountId ? accountById.get(accountId) : undefined;
    if (current?.deleted_at) {
      summary.warnings.push(`${compass?.account ?? helix!.name} was deleted in the app, so the sync skips it.`);
      continue;
    }

    const compassStatus = text(compass?.identity?.status)?.toLowerCase();
    const helixStatus = text(helix?.status)?.toLowerCase();
    const lifecycle: AccountLifecycle =
      (compassStatus ? policy.lifecycle.compass[compassStatus] : undefined) ??
      (helixStatus ? policy.lifecycle.helix[helixStatus] : undefined) ??
      policy.lifecycle.default;

    const activeProjects = (helix?.projects ?? []).filter((p) => policy.active_project_statuses.includes(p.status ?? ""));
    const helixHealth = (["red", "yellow", "green"] as HealthStatus[]).find((level) =>
      activeProjects.some((p) => policy.health.helix[p.healthStatus ?? ""] === level),
    );
    const health: HealthStatus = compass
      ? (policy.health.compass[compass.health?.band ?? ""] ?? "unknown")
      : (helixHealth ?? "unknown");

    const tierKey = [helix?.segment, compass?.identity?.segment, compass?.identity?.account_tier]
      .map((value) => (value ?? "").toLowerCase())
      .find((value) => policy.tier[value]);

    const arr = compass?.commercials?.arr_usd;
    const fields: Record<string, unknown> = {
      source_system: compass ? "compass" : "helix",
      external_id: compass ? compass.account_id : helix!.id,
      synced_at: now,
      name: text(compass?.identity?.name) ?? text(compass?.account) ?? helix!.name,
      domain: text(helix?.domain)?.toLowerCase() ?? current?.domain ?? null,
      industry: text(compass?.identity?.industry) ?? text(helix?.industry),
      region: text(helix?.region),
      health_status: health,
      lifecycle_status: lifecycle,
      ...(tierKey ? { tier: policy.tier[tierKey] } : {}),
      ...(compass
        ? {
            renewal_date: day(compass.commercials?.renewal_date),
            contract_start: day(compass.commercials?.contract_start_date),
            contract_end: day(compass.commercials?.contract_end_date),
            arr_cents: typeof arr === "number" && arr >= 0 ? Math.round(arr * 100) : null,
          }
        : {}),
    };

    if (accountId && current) {
      await must("account update", service.from("account").update(fields).eq("id", accountId));
      summary.accounts.updated += 1;
      if (current.lifecycle_status !== lifecycle) summary.accounts.lifecycleChanged += 1;
    } else {
      const row = await must<{ id: string }>(
        "account insert",
        service.from("account").insert(fields).select("id").single(),
      );
      accountId = row.id;
      summary.accounts.created += 1;
    }

    accountFor.set(entry, accountId);
    seenAccountIds.add(accountId);
  }
  const synced = merged.filter((entry) => accountFor.has(entry));

  const sourceRows = synced.flatMap((entry) => {
    const accountId = accountFor.get(entry)!;
    return [
      ...(entry.compass
        ? [{ source_system: "compass", external_id: entry.compass.account_id, account_id: accountId, source_name: entry.compass.account, synced_at: now }]
        : []),
      ...(entry.helix
        ? [{ source_system: "helix", external_id: entry.helix.id, account_id: accountId, source_name: entry.helix.name, synced_at: now }]
        : []),
    ];
  });
  for (const rows of chunks(sourceRows, 200)) {
    await must("account_source", service.from("account_source").upsert(rows, { onConflict: "source_system,external_id" }));
  }

  // The Helix link now points at the Compass account. The old Helix-only account
  // is deleted when nothing app-side hangs off it: no emails, no opt-outs and no
  // owners the lead added. Its projects move over with the links above, and its
  // contacts and PM owners are rebuilt on the kept account below. Otherwise it's
  // left for the lead to merge by hand.
  for (const [duplicate, { keep, label }] of mergeInto) {
    if (seenAccountIds.has(duplicate)) continue;
    const [emails, optedOut, manualOwners, otherLinks] = await Promise.all([
      service.from("email_activity").select("id", { count: "exact", head: true }).eq("account_id", duplicate),
      service.from("contact").select("id", { count: "exact", head: true }).eq("account_id", duplicate).eq("is_opted_out", true),
      service.from("account_assignment").select("id", { count: "exact", head: true }).eq("account_id", duplicate).is("source_system", null).is("deleted_at", null),
      service.from("account_source").select("external_id", { count: "exact", head: true }).eq("account_id", duplicate),
    ]);
    const blockers = [
      emails.count ? `${emails.count} email(s)` : null,
      optedOut.count ? `${optedOut.count} opted-out contact(s)` : null,
      manualOwners.count ? `${manualOwners.count} owner(s) added by the lead` : null,
      otherLinks.count ? "other source links" : null,
      emails.error || optedOut.error || manualOwners.error || otherLinks.error ? "a failed check" : null,
    ].filter(Boolean);
    if (blockers.length) {
      summary.warnings.push(`${label} are now paired, but the Helix-only account has ${blockers.join(", ")}, so it wasn't merged into ${keep}. Merge by hand.`);
      continue;
    }
    await must("account merge", service.from("account").delete().eq("id", duplicate));
    summary.accounts.merged += 1;
  }

  summary.missingUpstream = linkedIds.filter(
    (id) => accountById.get(id)?.deleted_at === null && !seenAccountIds.has(id) && !mergeInto.has(id),
  ).length;
  if (summary.accounts.compassOnly + summary.accounts.helixOnly > 0) {
    summary.unpaired.compass = merged.filter((m) => m.compass && !m.helix).map((m) => `${m.compass!.account} (${m.compass!.account_id})`).slice(0, LIST_CAP);
    summary.unpaired.helix = merged.filter((m) => m.helix && !m.compass).map((m) => `${m.helix!.name} (${m.helix!.id})`).slice(0, LIST_CAP);
  }

  // 5. Compass context.
  const contextRows = synced
    .filter((m) => m.compass)
    .map((m) => {
      const c = m.compass!;
      const s = c.strategy ?? {};
      return {
        account_id: accountFor.get(m)!,
        health_score: typeof c.health?.score === "number" ? Math.round(c.health.score) : null,
        health_label: text(c.health?.label),
        health_narrative: text(c.health?.narrative),
        renewal_posture: text(s.renewal_posture),
        motion: text(c.identity?.motion),
        is_plg: c.identity?.is_plg ?? null,
        lifecycle_stages: c.identity?.lifecycle_stages ?? [],
        project_stage: text(c.identity?.project_stage),
        agents_deployed: c.agents?.total_deployed ?? null,
        live_use_cases: c.agents?.live_use_cases ?? null,
        client_brief: text(s.client_brief),
        current_state: text(s.current_state),
        expansion_opportunity: text(s.main_expansion_opportunity),
        recommended_strategy: text(s.recommended_strategy),
        delivery_concern: text(s.main_delivery_concern),
        commercial_concern: text(s.main_commercial_concern),
        cs_notes: text(s.cs_notes),
        upsell_notes: text(s.upsell_notes),
        top_risks: planItems(c.account_plan?.top_risks),
        open_decisions: planItems(c.account_plan?.open_decisions),
        next_actions: planItems(c.account_plan?.committed_next_actions),
        recent_updates: (c.updates ?? [])
          .filter((u) => text(u.summary))
          .sort((a, b) => (b.event_at ?? "").localeCompare(a.event_at ?? ""))
          .slice(0, policy.recent_updates_kept)
          .map((u) => ({ summary: text(u.summary), sentiment: text(u.sentiment), event_at: instant(u.event_at) })),
        source_updated_at: instant(c.last_updated),
        synced_at: now,
      };
    });
  for (const rows of chunks(contextRows, 100)) {
    await must("account_context", service.from("account_context").upsert(rows, { onConflict: "account_id" }));
  }
  await must("account_context cleanup", service.from("account_context").delete().lt("synced_at", runStartedAt));

  // 6. Engagements: Helix projects and Compass use cases. Stale ones are deleted;
  // nothing references them.
  const engagementRows = synced.flatMap((m) => {
    const accountId = accountFor.get(m)!;
    return [
      ...(m.helix?.projects ?? []).map((p) => ({
        account_id: accountId,
        source_system: "helix",
        external_id: p.id,
        kind: "project",
        name: p.name,
        description: text(p.description),
        status: text(p.status),
        stage: text(p.projectPhase),
        health: text(p.healthStatus),
        owner_name: text(p.projectManager?.name),
        blocker: null,
        start_date: day(p.startDate),
        end_date: day(p.endDate),
        source_updated_at: instant(p.updatedAt),
        synced_at: now,
      })),
      ...(m.compass?.use_cases ?? []).map((u) => ({
        account_id: accountId,
        source_system: "compass",
        external_id: u.use_case_id,
        kind: "use_case",
        name: u.name,
        description: text(u.business_goal),
        status: text(u.status),
        stage: text(u.stage),
        health: null,
        owner_name: text(u.owner),
        blocker: text(u.current_blocker),
        start_date: null,
        end_date: day(u.target_date),
        source_updated_at: instant(u.updated_at),
        synced_at: now,
      })),
    ];
  });
  for (const rows of chunks(engagementRows, 200)) {
    await must("account_engagement", service.from("account_engagement").upsert(rows, { onConflict: "source_system,external_id" }));
  }
  summary.engagements = engagementRows.length;
  await must(
    "account_engagement cleanup",
    service.from("account_engagement").delete().in("source_system", ["helix", "compass"]).lt("synced_at", runStartedAt),
  );

  const accountIds = [...seenAccountIds];

  // 7. Owners. Everyone Helix and Compass name gets access: the Compass CSM as
  // primary, and Compass's project manager and sales rep plus Helix project
  // managers as co-owners. People who haven't signed in go to account_pending_owner,
  // which app.claim_pending_owners turns into assignments at their first sign-in.
  const users = await must<{ id: string; email: string; full_name: string }[]>(
    "app_user",
    service.from("app_user").select("id, email, full_name").eq("is_active", true).is("deleted_at", null),
  );
  const userByEmail = new Map(users.map((u) => [u.email.toLowerCase(), u.id]));
  const internalDomains = policy.internal_email_domains.map((d) => d.toLowerCase());
  const isInternal = (email: string) => internalDomains.includes(email.split("@")[1] ?? "");

  // One address per person: april@lyzr.com and april@lyzr.ai are the same mailbox
  // name, so prefer the earlier domain in internal_email_domains.
  const knownEmails = new Set<string>();
  const directory: { email: string; name: string }[] = [];
  const addPerson = (email: string | null | undefined, name: string | null | undefined) => {
    const address = text(email)?.toLowerCase();
    if (!address || !isInternal(address)) return;
    knownEmails.add(address);
    if (text(name)) directory.push({ email: address, name: text(name)! });
  };
  for (const u of users) addPerson(u.email, u.full_name);
  for (const client of clients) for (const project of client.projects) addPerson(project.projectManager?.email, project.projectManager?.name);
  for (const account of compassAccounts) addPerson(account.owners?.csm_email, account.owners?.csm);

  const canonical = (email: string): string => {
    const [local, domain] = email.split("@");
    const preferred = internalDomains.find((d) => knownEmails.has(`${local}@${d}`));
    return preferred && internalDomains.indexOf(preferred) < internalDomains.indexOf(domain) ? `${local}@${preferred}` : email;
  };
  const nameKey = (name: string) => name.toLowerCase().replace(/\(.*?\)/g, " ").replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim();

  const unresolved = new Map<string, Set<string>>();
  const resolveName = (raw: string | null | undefined, accountName: string): { email: string; name: string } | null => {
    const name = text(raw);
    if (!name) return null;
    const key = nameKey(name);
    if (!key || policy.ignore_names?.includes(key)) return null;
    const mapped = policy.people?.[key];
    if (mapped) return { email: canonical(mapped.toLowerCase()), name };

    const byFull = new Set(directory.filter((p) => nameKey(p.name) === key).map((p) => canonical(p.email)));
    let matches = byFull;
    if (!matches.size && !key.includes(" ")) {
      matches = new Set(
        directory
          .filter((p) => nameKey(p.name).split(" ")[0] === key || p.email.split("@")[0].split(".")[0] === key)
          .map((p) => canonical(p.email)),
      );
    }
    if (matches.size === 1) return { email: [...matches][0], name };
    unresolved.set(name, (unresolved.get(name) ?? new Set()).add(accountName));
    return null;
  };

  const assignments: AssignmentRow[] = [];
  for (const ids of chunks(accountIds, 100)) {
    assignments.push(
      ...(await must<AssignmentRow[]>(
        "account_assignment",
        service.from("account_assignment").select("id, account_id, user_id, role, is_primary, deleted_at, source_system").in("account_id", ids),
      )),
    );
  }

  const pendingRows: { account_id: string; email: string; full_name: string | null; role: AssignmentRole; is_primary: boolean; source_system: string; synced_at: string }[] = [];
  const notSignedUp = new Set<string>();
  const withoutOwner: string[] = [];

  for (const m of synced) {
    const accountId = accountFor.get(m)!;
    const accountName = m.compass?.account ?? m.helix!.name;
    type Want = { email: string; full_name: string | null; role: AssignmentRole; is_primary: boolean; source_system: "compass" | "helix" };
    const wanted = new Map<string, Want>();
    const want = (
      person: { email: string | null | undefined; name: string | null | undefined } | null,
      rule: { role: AssignmentRole; primary: boolean },
      source: Want["source_system"],
    ) => {
      const address = text(person?.email)?.toLowerCase();
      if (!address || !isInternal(address)) return;
      const email = canonical(address);
      const key = `${email}:${rule.role}`;
      const prior = wanted.get(key);
      wanted.set(key, {
        email,
        full_name: prior?.full_name ?? text(person?.name),
        role: rule.role,
        is_primary: (prior?.is_primary ?? false) || rule.primary,
        source_system: prior?.source_system ?? source,
      });
    };

    const owners = m.compass?.owners;
    want({ email: owners?.csm_email, name: owners?.csm }, policy.owners.compass_csm, "compass");
    if (policy.owners.compass_project_manager) {
      want(resolveName(owners?.project_manager, accountName), policy.owners.compass_project_manager, "compass");
    }
    if (policy.owners.compass_sales_rep) {
      want(resolveName(owners?.sales_rep, accountName), policy.owners.compass_sales_rep, "compass");
    }
    const projects = m.helix?.projects ?? [];
    const current = projects.filter((p) => policy.active_project_statuses.includes(p.status ?? ""));
    const latest = [...projects]
      .filter((p) => p.projectManager?.email)
      .sort((x, y) => (y.updatedAt ?? "").localeCompare(x.updatedAt ?? ""))[0];
    const pmProjects = current.length
      ? current
      : policy.helix_latest_project_manager_if_none_current && latest
        ? [latest]
        : [];
    for (const project of pmProjects) {
      want({ email: project.projectManager?.email, name: project.projectManager?.name }, policy.owners.helix_project_manager, "helix");
    }

    const rows = assignments.filter((a) => a.account_id === accountId);
    if (!wanted.size && !rows.some((r) => !r.deleted_at && !r.source_system)) withoutOwner.push(accountName);
    const signedIn = [...wanted.values()].filter((w) => userByEmail.has(w.email));
    const wantedUserRole = new Map(signedIn.map((w) => [`${userByEmail.get(w.email)}:${w.role}`, w]));
    const primarySignedIn = signedIn.some((w) => w.is_primary);

    for (const w of wanted.values()) {
      if (userByEmail.has(w.email)) continue;
      notSignedUp.add(w.email);
      pendingRows.push({ account_id: accountId, email: w.email, full_name: w.full_name, role: w.role, is_primary: w.is_primary, source_system: w.source_system, synced_at: now });
    }

    for (const w of signedIn) {
      const userId = userByEmail.get(w.email)!;
      const row = rows.find((r) => r.user_id === userId && r.role === w.role);
      if (!row) {
        await must(
          "assignment insert",
          service.from("account_assignment").insert({ account_id: accountId, user_id: userId, role: w.role, is_primary: w.is_primary, source_system: w.source_system }),
        );
        summary.owners.added += 1;
      } else if (row.deleted_at || row.is_primary !== w.is_primary) {
        // A row the lead added keeps its null source, so the sync never retires it.
        await must(
          "assignment update",
          service.from("account_assignment").update({ deleted_at: null, is_primary: w.is_primary }).eq("id", row.id),
        );
        if (row.deleted_at) summary.owners.added += 1;
      }
    }

    for (const row of rows) {
      if (row.deleted_at) continue;
      const stillWanted = wantedUserRole.get(`${row.user_id}:${row.role}`);
      if (row.source_system && !stillWanted) {
        await must(
          "assignment retire",
          service.from("account_assignment").update({ deleted_at: now, is_primary: false }).eq("id", row.id),
        );
        summary.owners.retired += 1;
      } else if (primarySignedIn && row.is_primary && !stillWanted?.is_primary) {
        // One primary owner per account: the synced one wins.
        await must("assignment demote", service.from("account_assignment").update({ is_primary: false }).eq("id", row.id));
      }
    }
  }

  for (const rows of chunks(pendingRows, 200)) {
    await must("account_pending_owner", service.from("account_pending_owner").upsert(rows, { onConflict: "account_id,email,role" }));
  }
  await must("account_pending_owner cleanup", service.from("account_pending_owner").delete().lt("synced_at", runStartedAt));

  summary.owners.pending = pendingRows.length;
  summary.owners.notSignedUp = [...notSignedUp].sort().slice(0, LIST_CAP);
  summary.owners.unresolvedNames = [...unresolved]
    .map(([name, accounts]) => `${name} (${[...accounts].join(", ")})`)
    .sort()
    .slice(0, LIST_CAP);
  summary.accounts.withoutOwner = withoutOwner.length;
  summary.withoutOwner = withoutOwner.sort().slice(0, LIST_CAP);

  // 8. Contacts.
  const internal = new Set(policy.internal_email_domains.map((d) => d.toLowerCase()));
  const isClientEmail = (email: string) => {
    const domain = email.split("@")[1];
    return !!domain && !internal.has(domain);
  };

  const contacts: ContactRow[] = [];
  for (const ids of chunks(accountIds, 100)) {
    contacts.push(
      ...(await must<ContactRow[]>(
        "contact",
        service
          .from("contact")
          .select("id, account_id, email, source, title, phone, business_function, relationship_status")
          .in("account_id", ids)
          .is("deleted_at", null),
      )),
    );
  }

  for (const m of synced) {
    const accountId = accountFor.get(m)!;
    const desired = new Map<string, DesiredContact>();

    for (const c of m.compass?.contacts ?? []) {
      const email = text(c.email)?.toLowerCase();
      if (!email || !isClientEmail(email) || !text(c.name)) continue;
      desired.set(email, {
        full_name: text(c.name)!,
        email,
        title: text(c.title),
        phone: null,
        external_id: c.contact_id,
        stakeholder_role: text(c.stakeholder_role),
        influence_level: text(c.influence_level),
        sentiment: text(c.sentiment),
        last_interaction_at: instant(c.last_interaction_at),
      });
    }
    for (const project of m.helix?.projects ?? []) {
      for (const c of contactsByProject.get(project.id) ?? ([] as HelixContact[])) {
        const email = text(c.email)?.toLowerCase();
        if (!email || !isClientEmail(email) || !text(c.name)) continue;
        const prior = desired.get(email);
        if (prior) {
          prior.title ??= text(c.title);
          prior.phone ??= text(c.phone);
          continue;
        }
        desired.set(email, {
          full_name: text(c.name)!,
          email,
          title: text(c.title),
          phone: text(c.phone),
          external_id: null,
          stakeholder_role: null,
          influence_level: null,
          sentiment: null,
          last_interaction_at: null,
        });
      }
    }

    const existing = new Map(
      contacts.filter((c) => c.account_id === accountId && c.email).map((c) => [c.email!.toLowerCase(), c]),
    );
    const inserts = [];
    for (const d of desired.values()) {
      const row = existing.get(d.email);
      const stakeholder = {
        stakeholder_role: d.stakeholder_role,
        influence_level: d.influence_level,
        sentiment: d.sentiment,
        last_interaction_at: d.last_interaction_at,
        synced_at: now,
      };
      if (!row) {
        inserts.push({
          account_id: accountId,
          type: "engaged",
          source: "internal_sync",
          full_name: d.full_name,
          email: d.email,
          title: d.title,
          phone: d.phone,
          external_id: d.external_id,
          business_function: functionFromTitle(d.title),
          relationship_status: d.stakeholder_role === "champion" ? "champion" : "active",
          ...stakeholder,
        });
        continue;
      }
      const ours = row.source === "internal_sync";
      await must(
        "contact update",
        service
          .from("contact")
          .update({
            ...stakeholder,
            ...(ours ? { full_name: d.full_name, external_id: d.external_id } : {}),
            title: ours ? (d.title ?? row.title) : (row.title ?? d.title),
            phone: row.phone ?? d.phone,
            ...(row.business_function === "other" && d.title ? { business_function: functionFromTitle(d.title) } : {}),
            ...(row.relationship_status === "unknown" ? { relationship_status: d.stakeholder_role === "champion" ? "champion" : "active" } : {}),
          })
          .eq("id", row.id),
      );
      summary.contacts.updated += 1;
    }
    if (inserts.length) {
      await must("contact insert", service.from("contact").insert(inserts));
      summary.contacts.created += inserts.length;
    }
  }

  return summary;
}
