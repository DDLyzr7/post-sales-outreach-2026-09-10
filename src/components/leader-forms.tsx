"use client";

import { useState, useTransition } from "react";
import { revealPerson, type RevealResult } from "@/app/(app)/accounts/[id]/leaders/actions";
import { StartDraftForm } from "@/components/draft-forms";
import { FUNCTION_LABEL } from "@/lib/format";
import type { BusinessFunction } from "@/lib/types";

export type CandidateView = {
  externalId: string;
  displayName: string;
  title: string | null;
  businessFunction: BusinessFunction;
  hasEmail: boolean;
  alreadyAdded: boolean;
  /** The contact, when this person is already on the account. */
  contactId: string | null;
  email: string | null;
};

const BUTTON =
  "rounded-md border border-line-strong bg-surface px-3 py-1.5 text-xs font-medium hover:border-accent disabled:opacity-60";

/** One Apollo search result: Find email reveals and adds them; then they can be emailed. */
function PersonRow({ accountId, candidate }: { accountId: string; candidate: CandidateView }) {
  const [result, setResult] = useState<RevealResult | null>(
    candidate.contactId && candidate.email
      ? { ok: true, contactId: candidate.contactId, fullName: candidate.displayName, title: candidate.title, email: candidate.email }
      : null,
  );
  const [pending, startTransition] = useTransition();
  const revealed = result?.ok ? result : null;

  return (
    <li className="flex flex-wrap items-start gap-3 px-3 py-3">
      <div className="min-w-0 flex-1 text-sm">
        <span className="font-medium">{revealed?.fullName ?? candidate.displayName}</span>
        <span className="ml-2 text-xs text-muted">{FUNCTION_LABEL[candidate.businessFunction]}</span>
        <p className="text-xs text-muted">{revealed?.title ?? candidate.title ?? "Title unknown"}</p>
        {revealed ? (
          <p className="mt-0.5 font-mono text-xs">
            {revealed.email} <span className="font-sans text-[11px] text-ok">· on the leadership side</span>
          </p>
        ) : null}
        {candidate.alreadyAdded && !revealed ? <p className="text-[11px] text-ok">Already on this account</p> : null}
        {result && !result.ok ? <p role="alert" className="text-[11px] text-bad">{result.error}</p> : null}
      </div>
      <div className="shrink-0">
        {revealed ? (
          <StartDraftForm accountId={accountId} contactId={revealed.contactId} label="Email them" />
        ) : candidate.alreadyAdded ? null : candidate.hasEmail ? (
          <button
            type="button"
            className={BUTTON}
            disabled={pending}
            onClick={() => startTransition(async () => setResult(await revealPerson(accountId, candidate.externalId)))}
          >
            {pending ? "Finding..." : "Find email"}
          </button>
        ) : (
          <span className="text-[11px] text-muted">No email in Apollo</span>
        )}
      </div>
    </li>
  );
}

export function PeopleResults({ accountId, candidates }: { accountId: string; candidates: CandidateView[] }) {
  return (
    <div className="space-y-2">
      <p className="text-[11px] text-muted">
        Find email uses Apollo credits (one reveal per person) and adds them to the leadership side as a cold contact.
        Email them opens a Claude draft; you review it, then send.
      </p>
      <ul className="divide-y divide-line rounded-md border border-line">
        {candidates.map((c) => (
          <PersonRow key={c.externalId} accountId={accountId} candidate={c} />
        ))}
      </ul>
    </div>
  );
}
