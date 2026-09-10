"use client";

import { useActionState } from "react";
import {
  assignOwner, removeOwner, setLifecycle, type ActionState,
} from "@/app/(app)/team/actions";
import { LIFECYCLE_LABEL, ROLE_SHORT } from "@/lib/format";
import type { AccountLifecycle, AssignmentRole, Teammate } from "@/lib/types";

const initial: ActionState = { error: null, notice: null };

const FIELD =
  "rounded-md border border-line-strong bg-surface px-2 py-1 text-xs outline-none focus:border-accent";
const BUTTON =
  "rounded-md border border-line-strong bg-surface px-2 py-1 text-xs font-medium hover:border-accent disabled:opacity-60";

function Feedback({ state }: { state: ActionState }) {
  if (state.error) {
    return (
      <p role="alert" className="w-full text-[11px] text-bad">
        {state.error}
      </p>
    );
  }
  if (state.notice) {
    return (
      <p role="status" className="w-full text-[11px] text-ok">
        {state.notice}
      </p>
    );
  }
  return null;
}

export function AddOwnerForm({ accountId, teammates }: { accountId: string; teammates: Teammate[] }) {
  const [state, formAction, pending] = useActionState(assignOwner, initial);

  return (
    <form action={formAction} className="flex flex-wrap items-center gap-1.5">
      <input type="hidden" name="account_id" value={accountId} />
      <select name="user_id" required defaultValue="" aria-label="Person to add" className={FIELD}>
        <option value="" disabled>
          Person
        </option>
        {teammates.map((t) => (
          <option key={t.id} value={t.id}>
            {t.full_name}
          </option>
        ))}
      </select>
      <select name="role" required defaultValue="" aria-label="Role on this account" className={FIELD}>
        <option value="" disabled>
          Role
        </option>
        {(Object.keys(ROLE_SHORT) as AssignmentRole[]).map((role) => (
          <option key={role} value={role}>
            {ROLE_SHORT[role]}
          </option>
        ))}
      </select>
      <label className="flex items-center gap-1 text-[11px] text-muted">
        <input type="checkbox" name="is_primary" />
        primary
      </label>
      <button type="submit" disabled={pending} className={BUTTON}>
        {pending ? "Adding..." : "Add"}
      </button>
      <Feedback state={state} />
    </form>
  );
}

export function RemoveOwnerButton({ assignmentId, label }: { assignmentId: string; label: string }) {
  const [state, formAction, pending] = useActionState(removeOwner, initial);

  return (
    <form action={formAction} className="inline-flex flex-wrap items-center gap-1">
      <input type="hidden" name="assignment_id" value={assignmentId} />
      <button
        type="submit"
        disabled={pending}
        aria-label={`Remove ${label}`}
        title={`Remove ${label}`}
        className="rounded px-1 text-xs text-muted hover:text-bad disabled:opacity-60"
      >
        {pending ? "..." : "Remove"}
      </button>
      {state.error ? <span className="text-[11px] text-bad">{state.error}</span> : null}
    </form>
  );
}

export function LifecycleForm({ accountId, current }: { accountId: string; current: AccountLifecycle }) {
  const [state, formAction, pending] = useActionState(setLifecycle, initial);

  return (
    <form action={formAction} className="flex flex-wrap items-center gap-1.5">
      <input type="hidden" name="account_id" value={accountId} />
      <select name="lifecycle_status" defaultValue={current} aria-label="Lifecycle" className={FIELD}>
        {(Object.keys(LIFECYCLE_LABEL) as AccountLifecycle[]).map((status) => (
          <option key={status} value={status}>
            {LIFECYCLE_LABEL[status]}
          </option>
        ))}
      </select>
      <button type="submit" disabled={pending} className={BUTTON}>
        {pending ? "Saving..." : "Save"}
      </button>
      <Feedback state={state} />
    </form>
  );
}
