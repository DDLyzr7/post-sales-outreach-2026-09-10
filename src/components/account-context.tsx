import { Badge, Card } from "@/components/ui";
import { formatDate } from "@/lib/format";
import type { AccountContext, AccountEngagement, PlanItem } from "@/lib/types";

/**
 * What Helix and Compass know about the account, shown under the status header.
 * Everything here is read-only in the app: it changes in Helix or Compass and
 * arrives with the next sync. It's for the owner's eyes; the drafting brief only
 * takes engagement names and stages from it (see src/lib/ai/brief.ts).
 */

const CURRENT_PROJECT = new Set(["in_progress", "on_hold", "draft"]);
const CURRENT_USE_CASE = new Set(["active", "stalled"]);

type Tone = "neutral" | "ok" | "warn" | "bad" | "accent" | "cold";

const HEALTH_TONE: Record<string, Tone> = { on_track: "ok", at_risk: "warn", off_track: "bad" };
const STAGE_TONE: Record<string, Tone> = { live: "ok", blocked: "bad", paused: "warn", expansion_candidate: "accent" };
const POSTURE_TONE: Record<string, Tone> = { strong: "ok", stable: "ok", uncertain: "warn", at_risk: "bad" };
const UPDATE_TONE: Record<string, Tone> = { positive: "ok", friction: "warn", escalation: "bad" };

function words(value: string | null): string {
  return (value ?? "").replace(/_/g, " ");
}

function Note({ label, children }: { label: string; children: string | null }) {
  if (!children) return null;
  return (
    <div>
      <dt className="text-[11px] font-medium uppercase tracking-wide text-muted">{label}</dt>
      <dd className="mt-0.5 whitespace-pre-line text-xs leading-relaxed">{children}</dd>
    </div>
  );
}

function PlanList({ label, items }: { label: string; items: PlanItem[] }) {
  if (!items.length) return null;
  return (
    <div>
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted">{label}</p>
      <ul className="mt-1 space-y-1.5">
        {items.map((item, index) => (
          <li key={index} className="text-xs">
            <span className="font-medium">{item.title}</span>
            {item.status ? <span className="text-muted"> · {words(item.status)}</span> : null}
            {item.owner ? <span className="text-muted"> · {item.owner}</span> : null}
            {item.due_date ? <span className="text-muted"> · due {formatDate(item.due_date)}</span> : null}
            {item.description ? <p className="mt-0.5 text-muted">{item.description}</p> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function EngagementRow({ item }: { item: AccountEngagement }) {
  const stage = item.kind === "use_case" ? item.stage : (item.stage ?? item.status);
  return (
    <li className="border-b border-line py-2 last:border-b-0">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium">{item.name}</span>
        <Badge tone={item.kind === "use_case" ? "accent" : "neutral"}>{item.kind === "use_case" ? "use case" : "project"}</Badge>
        {stage ? <Badge tone={STAGE_TONE[stage] ?? "neutral"}>{words(stage)}</Badge> : null}
        {item.kind === "project" && item.stage && item.status ? <span className="text-[11px] text-muted">{words(item.status)}</span> : null}
        {item.health ? <Badge tone={HEALTH_TONE[item.health] ?? "neutral"}>{words(item.health)}</Badge> : null}
      </div>
      <p className="mt-0.5 text-[11px] text-muted">
        {[
          item.owner_name,
          item.start_date || item.end_date ? `${formatDate(item.start_date)} to ${formatDate(item.end_date)}` : null,
        ]
          .filter(Boolean)
          .join(" · ")}
      </p>
      {item.blocker ? <p className="mt-0.5 text-[11px] text-bad">Blocked: {item.blocker}</p> : null}
      {item.description ? <p className="mt-0.5 line-clamp-2 text-[11px] text-muted">{item.description}</p> : null}
    </li>
  );
}

export function AccountContextPanel({
  context,
  engagements,
  industry,
  region,
}: {
  context: AccountContext | null;
  engagements: AccountEngagement[];
  industry: string | null;
  region: string | null;
}) {
  if (!context && !engagements.length) return null;

  const isCurrent = (e: AccountEngagement) =>
    e.kind === "use_case" ? CURRENT_USE_CASE.has(e.status ?? "") : CURRENT_PROJECT.has(e.status ?? "");
  const current = engagements.filter(isCurrent);
  const past = engagements.filter((e) => !isCurrent(e));
  const plan = context ? [...context.top_risks, ...context.open_decisions, ...context.next_actions] : [];

  return (
    <details open className="group mb-5">
      <summary className="flex cursor-pointer list-none flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-sm font-semibold">
          <span className="mr-1 inline-block text-muted transition-transform group-open:rotate-90">›</span>
          From Helix and Compass
        </h2>
        <span className="text-xs text-muted">
          {[industry, region].filter(Boolean).join(" · ")}
          {context ? ` · Compass updated ${formatDate(context.source_updated_at)}` : ""}
        </span>
      </summary>

      <div className="mt-3 grid gap-4 lg:grid-cols-3">
        {context ? (
          <Card className="p-4 lg:col-span-2">
            <div className="flex flex-wrap items-center gap-2">
              {context.health_label ? (
                <Badge tone={context.health_label === "Healthy" ? "ok" : context.health_label === "Churned" ? "neutral" : "warn"}>
                  {context.health_label}
                  {context.health_score !== null ? ` ${context.health_score}` : ""}
                </Badge>
              ) : null}
              {context.renewal_posture && context.renewal_posture !== "unknown" ? (
                <Badge tone={POSTURE_TONE[context.renewal_posture] ?? "neutral"}>renewal {words(context.renewal_posture)}</Badge>
              ) : null}
              {context.lifecycle_stages.map((stage) => (
                <Badge key={stage}>{words(stage)}</Badge>
              ))}
              {context.motion ? <Badge>{context.motion}</Badge> : null}
              {context.agents_deployed ? (
                <span className="text-[11px] text-muted">
                  {context.agents_deployed} agent{context.agents_deployed === 1 ? "" : "s"} deployed
                  {context.live_use_cases ? ` · ${context.live_use_cases} live use case${context.live_use_cases === 1 ? "" : "s"}` : ""}
                </span>
              ) : null}
            </div>

            <dl className="mt-3 grid gap-3 md:grid-cols-2">
              <Note label="Client brief">{context.client_brief}</Note>
              <Note label="Current state">{context.current_state}</Note>
              <Note label="Health">{context.health_narrative}</Note>
              <Note label="Expansion opportunity">{context.expansion_opportunity}</Note>
              <Note label="Upsell notes">{context.upsell_notes}</Note>
              <Note label="Recommended strategy">{context.recommended_strategy}</Note>
              <Note label="Delivery concern">{context.delivery_concern}</Note>
              <Note label="Commercial concern">{context.commercial_concern}</Note>
              <Note label="CS notes">{context.cs_notes}</Note>
            </dl>

            {plan.length ? (
              <div className="mt-4 grid gap-3 border-t border-line pt-3 md:grid-cols-3">
                <PlanList label="Top risks" items={context.top_risks} />
                <PlanList label="Open decisions" items={context.open_decisions} />
                <PlanList label="Committed next actions" items={context.next_actions} />
              </div>
            ) : null}

            {context.recent_updates.length ? (
              <div className="mt-4 border-t border-line pt-3">
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted">Recent updates</p>
                <ul className="mt-1 space-y-1.5">
                  {context.recent_updates.slice(0, 5).map((update, index) => (
                    <li key={index} className="flex gap-2 text-xs">
                      <span className="w-20 shrink-0 text-muted">{formatDate(update.event_at)}</span>
                      <span className="min-w-0">
                        {update.sentiment && update.sentiment !== "neutral" ? (
                          <Badge tone={UPDATE_TONE[update.sentiment] ?? "neutral"}>{update.sentiment}</Badge>
                        ) : null}{" "}
                        {update.summary}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </Card>
        ) : null}

        <Card className={`p-4 ${context ? "" : "lg:col-span-3"}`}>
          <h3 className="text-sm font-semibold">Work with us</h3>
          <p className="mt-0.5 text-[11px] text-muted">Helix projects and Compass use cases.</p>
          {current.length ? (
            <ul className="mt-2">
              {current.map((item) => (
                <EngagementRow key={item.id} item={item} />
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-xs text-muted">Nothing in progress.</p>
          )}
          {past.length ? (
            <details className="mt-2">
              <summary className="cursor-pointer text-[11px] font-medium text-accent">
                {past.length} completed or closed
              </summary>
              <ul className="mt-1">
                {past.map((item) => (
                  <EngagementRow key={item.id} item={item} />
                ))}
              </ul>
            </details>
          ) : null}
        </Card>
      </div>
    </details>
  );
}
