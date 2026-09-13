"use client";

import { useActionState, useState } from "react";
import {
  cancelBroadcast, deleteBroadcast, launchBroadcast, saveBroadcast, type BroadcastState,
} from "@/app/(app)/broadcasts/actions";
import type { Audience } from "@/lib/db/broadcasts";

const initial: BroadcastState = { error: null, notice: null };

const FIELD =
  "w-full rounded-md border border-line-strong bg-surface px-3 py-2 text-sm outline-none focus:border-accent";
const BUTTON =
  "rounded-md border border-line-strong bg-surface px-3 py-1.5 text-xs font-medium hover:border-accent disabled:opacity-60";
const PRIMARY =
  "rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-60";

function Feedback({ state }: { state: BroadcastState }) {
  if (state.error) return <p role="alert" className="text-xs text-bad">{state.error}</p>;
  if (state.notice) return <p role="status" className="text-xs text-ok">{state.notice}</p>;
  return null;
}

function Checks({
  legend,
  name,
  options,
  selected,
}: {
  legend: string;
  name: string;
  options: { value: string; label: string }[];
  selected: string[] | undefined;
}) {
  return (
    <fieldset>
      <legend className="text-[11px] font-medium uppercase tracking-wide text-muted">{legend}</legend>
      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
        {options.map((option) => (
          <label key={option.value} className="flex items-center gap-1.5 text-xs">
            <input type="checkbox" name={name} value={option.value} defaultChecked={selected?.includes(option.value)} />
            {option.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** datetime-local has no time zone; convert in the browser so the server gets an instant. */
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

export function BroadcastEditor({
  campaign,
  products,
}: {
  campaign: { id: string; name: string; subject: string; body_text: string; audience: Audience; scheduled_at: string | null; updated_at: string };
  products: { key: string; name: string }[];
}) {
  const [state, formAction, pending] = useActionState(saveBroadcast, initial);
  const [when, setWhen] = useState(toLocalInput(campaign.scheduled_at));
  const a = campaign.audience;

  return (
    <form key={campaign.updated_at} action={formAction} className="space-y-4">
      <input type="hidden" name="campaign_id" value={campaign.id} />
      <input type="hidden" name="scheduled_at" value={when ? new Date(when).toISOString() : ""} />

      <div>
        <label htmlFor="bc-name" className="text-[11px] font-medium uppercase tracking-wide text-muted">Name (internal)</label>
        <input id="bc-name" name="name" defaultValue={campaign.name} maxLength={120} className={`mt-1 ${FIELD}`} />
      </div>
      <div>
        <label htmlFor="bc-subject" className="text-[11px] font-medium uppercase tracking-wide text-muted">Subject</label>
        <input id="bc-subject" name="subject" defaultValue={campaign.subject} maxLength={300} className={`mt-1 ${FIELD}`} />
      </div>
      <div>
        <label htmlFor="bc-body" className="text-[11px] font-medium uppercase tracking-wide text-muted">Body</label>
        <textarea
          id="bc-body"
          name="body"
          defaultValue={campaign.body_text}
          rows={12}
          maxLength={20000}
          className={`mt-1 font-sans leading-relaxed ${FIELD}`}
        />
        <p className="mt-1 text-[11px] text-muted">
          Merge fields: {"{{contact_first_name}}"} {"{{account_name}}"} {"{{sender_first_name}}"} {"{{sender_full_name}}"}.
          Each email goes from the account&apos;s primary owner. Replace every [[marker]] before launching.
        </p>
      </div>

      <div className="space-y-3 rounded-md border border-line bg-surface-muted p-3">
        <p className="text-xs font-medium">Audience. Leave a group empty to include everyone.</p>
        <Checks
          legend="Lifecycle"
          name="lifecycle"
          selected={a.lifecycle}
          options={[
            { value: "existing", label: "Existing customers" },
            { value: "churned", label: "Churned" },
            { value: "prospect", label: "Prospects and friend accounts" },
          ]}
        />
        <Checks
          legend="Tier"
          name="tiers"
          selected={a.tiers}
          options={[
            { value: "strategic", label: "Strategic" },
            { value: "enterprise", label: "Enterprise" },
            { value: "mid_market", label: "Mid-market" },
            { value: "smb", label: "SMB" },
          ]}
        />
        <Checks
          legend="Health"
          name="health"
          selected={a.health}
          options={[
            { value: "green", label: "Green" },
            { value: "yellow", label: "Yellow" },
            { value: "red", label: "Red" },
            { value: "unknown", label: "Unknown" },
          ]}
        />
        <Checks
          legend="Uses any of these products"
          name="product_keys"
          selected={a.product_keys}
          options={products.map((p) => ({ value: p.key, label: p.name }))}
        />
        <Checks
          legend="Contacts"
          name="contact_types"
          selected={a.contact_types}
          options={[
            { value: "engaged", label: "Engaged stakeholders" },
            { value: "committee", label: "Leadership committee" },
          ]}
        />
      </div>

      <div>
        <label htmlFor="bc-when" className="text-[11px] font-medium uppercase tracking-wide text-muted">
          Send time (optional)
        </label>
        <input
          id="bc-when"
          type="datetime-local"
          value={when}
          onChange={(event) => setWhen(event.target.value)}
          className={`mt-1 max-w-xs ${FIELD}`}
        />
        <p className="mt-1 text-[11px] text-muted">Empty sends as soon as it launches. Your local time.</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" disabled={pending} className={PRIMARY}>
          {pending ? "Saving..." : "Save and preview audience"}
        </button>
      </div>
      <Feedback state={state} />
    </form>
  );
}

export function LaunchBroadcastButton({
  campaignId,
  reach,
  testMode,
  disabledReason,
}: {
  campaignId: string;
  reach: number;
  testMode: boolean;
  disabledReason: string | null;
}) {
  const [state, formAction, pending] = useActionState(launchBroadcast, initial);
  return (
    <form
      action={formAction}
      onSubmit={(event) => {
        const question = testMode
          ? `Launch in test mode? ${reach} emails will be recorded as sent; nothing is delivered.`
          : `Launch now? ${reach} emails will go to real clients from their owners' mailboxes.`;
        if (!window.confirm(question)) event.preventDefault();
      }}
      className="space-y-1"
    >
      <input type="hidden" name="campaign_id" value={campaignId} />
      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" disabled={pending || !!disabledReason} className={PRIMARY}>
          {pending ? "Launching..." : testMode ? `Launch to ${reach} (test mode)` : `Launch to ${reach}`}
        </button>
        {disabledReason ? <span className="text-[11px] text-muted">{disabledReason}</span> : null}
      </div>
      <Feedback state={state} />
    </form>
  );
}

export function CancelBroadcastButton({ campaignId }: { campaignId: string }) {
  const [state, formAction, pending] = useActionState(cancelBroadcast, initial);
  return (
    <form
      action={formAction}
      onSubmit={(event) => {
        if (!window.confirm("Cancel this broadcast? Emails already sent stay sent; the rest won't go.")) event.preventDefault();
      }}
      className="space-y-1"
    >
      <input type="hidden" name="campaign_id" value={campaignId} />
      <button type="submit" disabled={pending} className={BUTTON}>
        {pending ? "Cancelling..." : "Cancel broadcast"}
      </button>
      <Feedback state={state} />
    </form>
  );
}

export function DeleteBroadcastButton({ campaignId }: { campaignId: string }) {
  const [state, formAction, pending] = useActionState(deleteBroadcast, initial);
  return (
    <form
      action={formAction}
      onSubmit={(event) => {
        if (!window.confirm("Delete this draft broadcast?")) event.preventDefault();
      }}
      className="space-y-1"
    >
      <input type="hidden" name="campaign_id" value={campaignId} />
      <button type="submit" disabled={pending} className="text-xs text-muted hover:text-bad disabled:opacity-60">
        {pending ? "Deleting..." : "Delete draft"}
      </button>
      <Feedback state={state} />
    </form>
  );
}
