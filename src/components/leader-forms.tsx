"use client";

import { useActionState, useState } from "react";
import { addLeaders, type LeadersState } from "@/app/(app)/accounts/[id]/leaders/actions";
import { FUNCTION_LABEL } from "@/lib/format";
import type { BusinessFunction } from "@/lib/types";

const initial: LeadersState = { error: null, notice: null };

export type CandidateView = {
  externalId: string;
  displayName: string;
  title: string | null;
  businessFunction: BusinessFunction;
  hasEmail: boolean;
  alreadyAdded: boolean;
};

export function AddLeadersForm({
  accountId,
  candidates,
  maxReveals,
}: {
  accountId: string;
  candidates: CandidateView[];
  maxReveals: number;
}) {
  const [state, formAction, pending] = useActionState(addLeaders, initial);
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const toggle = (id: string) =>
    setPicked((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="account_id" value={accountId} />
      <ul className="divide-y divide-line rounded-md border border-line">
        {candidates.map((c) => (
          <li key={c.externalId} className="flex items-start gap-3 px-3 py-2.5">
            <input
              type="checkbox"
              name="person_id"
              value={c.externalId}
              disabled={c.alreadyAdded || !c.hasEmail}
              checked={picked.has(c.externalId)}
              onChange={() => toggle(c.externalId)}
              aria-label={`Add ${c.displayName}`}
              className="mt-1"
            />
            <div className="min-w-0 text-sm">
              <span className="font-medium">{c.displayName}</span>
              <span className="ml-2 text-xs text-muted">{FUNCTION_LABEL[c.businessFunction]}</span>
              <p className="text-xs text-muted">{c.title ?? "Title unknown"}</p>
              {c.alreadyAdded ? <p className="text-[11px] text-ok">Already on this account</p> : null}
              {!c.hasEmail && !c.alreadyAdded ? <p className="text-[11px] text-muted">Apollo has no email for them</p> : null}
            </div>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="submit"
          disabled={pending || picked.size === 0 || picked.size > maxReveals}
          className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-60"
        >
          {pending ? "Adding..." : `Add ${picked.size || ""} selected`.replace("  ", " ")}
        </button>
        <span className="text-[11px] text-muted">
          Each person added uses Apollo credits to reveal their email. Up to {maxReveals} at a time.
        </span>
      </div>
      {state.error ? <p role="alert" className="text-xs text-bad">{state.error}</p> : null}
      {state.notice ? <p role="status" className="text-xs text-ok">{state.notice}</p> : null}
    </form>
  );
}
