"use client";

import { useActionState } from "react";
import { setOptOut, type ContactActionState } from "@/app/(app)/accounts/actions";

const initial: ContactActionState = { error: null, notice: null };

/** "Record opt-out" for anyone on the account; "Clear opt-out" for the lead. */
export function OptOutForm({
  accountId,
  contactId,
  optedOut,
  canClear,
}: {
  accountId: string;
  contactId: string;
  optedOut: boolean;
  canClear: boolean;
}) {
  const [state, formAction, pending] = useActionState(setOptOut, initial);
  if (optedOut && !canClear) return null;

  return (
    <details className="text-right">
      <summary className="cursor-pointer text-[11px] text-muted hover:text-bad">
        {optedOut ? "Clear opt-out" : "Record opt-out"}
      </summary>
      <form action={formAction} className="mt-1 flex flex-col items-end gap-1">
        <input type="hidden" name="account_id" value={accountId} />
        <input type="hidden" name="contact_id" value={contactId} />
        <input type="hidden" name="opt_out" value={optedOut ? "false" : "true"} />
        {optedOut ? (
          <p className="max-w-56 text-[11px] text-muted">Only clear it if they asked to hear from us again.</p>
        ) : (
          <>
            <label className="sr-only" htmlFor={`optout-${contactId}`}>Reason</label>
            <input
              id={`optout-${contactId}`}
              name="reason"
              maxLength={300}
              placeholder="Why, e.g. asked to stop"
              className="w-56 rounded-md border border-line-strong bg-surface px-2 py-1 text-xs outline-none focus:border-accent"
            />
          </>
        )}
        <button
          type="submit"
          disabled={pending}
          className="rounded-md border border-line-strong px-2 py-1 text-[11px] font-medium hover:border-bad hover:text-bad disabled:opacity-60"
        >
          {pending ? "Saving..." : optedOut ? "Clear opt-out" : "Record opt-out"}
        </button>
        {state.error ? <p role="alert" className="max-w-56 text-[11px] text-bad">{state.error}</p> : null}
        {state.notice ? <p role="status" className="max-w-56 text-[11px] text-ok">{state.notice}</p> : null}
      </form>
    </details>
  );
}
