"use client";

import { useActionState, useRef, useState, useTransition } from "react";
import {
  discardDraft, findCollateralForDraft, redraft, sendEmail, startDraft, stopSending, updateDraft,
  type CollateralOption, type DraftActionState, type FindCollateralResult,
} from "@/app/(app)/drafts/actions";
import { collateralLine, insertBeforeSignOff } from "@/lib/collateral-links";
import { COLLATERAL_TYPE_LABEL } from "@/lib/format";

const initial: DraftActionState = { error: null, notice: null };

const FIELD =
  "w-full rounded-md border border-line-strong bg-surface px-3 py-2 text-sm outline-none focus:border-accent disabled:bg-surface-muted disabled:text-muted";
const BUTTON =
  "rounded-md border border-line-strong bg-surface px-3 py-1.5 text-xs font-medium hover:border-accent disabled:opacity-60";
const PRIMARY =
  "rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-60";

function Feedback({ state }: { state: DraftActionState }) {
  if (state.error) {
    return (
      <p role="alert" className="text-xs text-bad">
        {state.error}
      </p>
    );
  }
  if (state.notice) {
    return (
      <p role="status" className="text-xs text-ok">
        {state.notice}
      </p>
    );
  }
  return null;
}

/** "Draft with Claude" on a contact row, with an optional note for Claude. */
export function StartDraftForm({ accountId, contactId }: { accountId: string; contactId: string }) {
  const [state, formAction, pending] = useActionState(startDraft, initial);

  return (
    <form action={formAction} className="flex flex-col items-end gap-1">
      <input type="hidden" name="account_id" value={accountId} />
      <input type="hidden" name="contact_id" value={contactId} />
      <button type="submit" disabled={pending} className={PRIMARY}>
        {pending ? "Drafting..." : "Draft with Claude"}
      </button>
      <details className="text-right">
        <summary className="cursor-pointer text-[11px] text-muted hover:text-accent">
          Add a note for Claude
        </summary>
        <label className="sr-only" htmlFor={`note-${contactId}`}>Note for Claude</label>
        <textarea
          id={`note-${contactId}`}
          name="instruction"
          rows={3}
          maxLength={500}
          placeholder="e.g. mention the new approval workflow"
          className="mt-1 w-56 rounded-md border border-line-strong bg-surface px-2 py-1 text-xs outline-none focus:border-accent"
        />
      </details>
      {pending ? <p className="text-[11px] text-muted">Claude is writing. This takes a few seconds.</p> : null}
      {state.error ? <p role="alert" className="max-w-56 text-right text-[11px] text-bad">{state.error}</p> : null}
    </form>
  );
}

type Intent = "save" | "review" | "ready" | "unready";

const PENDING_LABEL: Record<Intent, string> = {
  save: "Saving...",
  review: "Claude is checking...",
  ready: "Checking...",
  unready: "Moving...",
};

/** Subject and body, with save, Claude's check and mark-ready. */
export function DraftEditor({
  draftId,
  subject,
  body,
  from,
  to,
  ready,
  version,
}: {
  draftId: string;
  subject: string;
  body: string;
  from: string;
  to: string;
  ready: boolean;
  /** Changes whenever the saved draft changes, so the fields reload. */
  version: string;
}) {
  const [state, formAction, pending] = useActionState(updateDraft, initial);
  const [intent, setIntent] = useState<Intent>("save");
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  // Set once the owner puts the cursor in the body; until then links go before the sign-off.
  const cursorPlaced = useRef(false);
  const [addedIds, setAddedIds] = useState<string[]>([]);

  const addCollateral = (item: CollateralOption) => {
    const el = bodyRef.current;
    if (!el || el.value.includes(item.url)) return;
    const line = collateralLine({ title: item.title, asset_url: item.url });
    if (cursorPlaced.current) {
      const at = el.selectionStart ?? el.value.length;
      const before = el.value.slice(0, at);
      const after = el.value.slice(at);
      el.value = `${before}${before && !before.endsWith("\n") ? "\n" : ""}${line}${after.startsWith("\n") ? "" : "\n"}${after}`;
    } else {
      el.value = insertBeforeSignOff(el.value, line);
    }
    setAddedIds((ids) => [...new Set([...ids, item.id])]);
  };

  const submit = (value: Intent, label: string, className: string) => (
    <button
      type="submit"
      name="intent"
      value={value}
      disabled={pending}
      onClick={() => setIntent(value)}
      className={className}
    >
      {pending && intent === value ? PENDING_LABEL[value] : label}
    </button>
  );

  return (
    <form key={version} action={formAction} className="space-y-3">
      <input type="hidden" name="draft_id" value={draftId} />

      <dl className="grid gap-1 text-xs sm:grid-cols-[4rem_1fr]">
        <dt className="text-muted">From</dt>
        <dd className="font-mono">{from}</dd>
        <dt className="text-muted">To</dt>
        <dd className="font-mono">{to}</dd>
      </dl>

      <div>
        <label htmlFor="draft-subject" className="text-[11px] font-medium uppercase tracking-wide text-muted">
          Subject
        </label>
        <input
          id="draft-subject"
          name="subject"
          defaultValue={subject}
          maxLength={300}
          disabled={ready}
          className={`mt-1 ${FIELD}`}
        />
      </div>

      <div>
        <label htmlFor="draft-body" className="text-[11px] font-medium uppercase tracking-wide text-muted">
          Body
        </label>
        <textarea
          ref={bodyRef}
          id="draft-body"
          name="body"
          defaultValue={body}
          onSelect={() => {
            cursorPlaced.current = true;
          }}
          rows={16}
          maxLength={20000}
          disabled={ready}
          className={`mt-1 font-sans leading-relaxed ${FIELD}`}
        />
      </div>

      <input type="hidden" name="added_collateral_ids" value={addedIds.join(",")} />
      {ready ? null : <CollateralPicker draftId={draftId} onAdd={addCollateral} addedCount={addedIds.length} />}

      <div className="flex flex-wrap items-center gap-2">
        {ready ? (
          <>
            {submit("unready", "Back to draft", BUTTON)}
            {submit("review", "Check with Claude", BUTTON)}
          </>
        ) : (
          <>
            {submit("ready", "Save and mark ready", PRIMARY)}
            {submit("save", "Save", BUTTON)}
            {submit("review", "Save and check with Claude", BUTTON)}
          </>
        )}
      </div>
      <Feedback state={state} />
    </form>
  );
}

/**
 * "Add collateral": search the library (Skott first) for material a client can be
 * sent, or see suggestions for this contact, and drop its link into the body.
 * Lives inside the editor's form, so every control is type="button".
 */
function CollateralPicker({
  draftId,
  onAdd,
  addedCount,
}: {
  draftId: string;
  onAdd: (item: CollateralOption) => void;
  addedCount: number;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<FindCollateralResult | null>(null);
  const [added, setAdded] = useState<string[]>([]);
  const [pending, startTransition] = useTransition();

  const find = (request: string) =>
    startTransition(async () => {
      setResult(await findCollateralForDraft(draftId, request));
    });

  if (!open) {
    return (
      <button
        type="button"
        className={BUTTON}
        onClick={() => {
          setOpen(true);
          find("");
        }}
      >
        Add collateral
      </button>
    );
  }

  return (
    <div className="rounded-md border border-line bg-surface-muted p-3">
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="collateral-find" className="sr-only">Find collateral</label>
        <input
          id="collateral-find"
          value={query}
          maxLength={300}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            // Enter would submit the draft form.
            if (event.key === "Enter") {
              event.preventDefault();
              find(query);
            }
          }}
          placeholder="e.g. banking customer support case study"
          className="min-w-[200px] flex-1 rounded-md border border-line-strong bg-surface px-2 py-1.5 text-xs outline-none focus:border-accent"
        />
        <button type="button" className={BUTTON} disabled={pending} onClick={() => find(query)}>
          {pending ? "Searching..." : "Search"}
        </button>
        <button type="button" className="text-[11px] text-muted hover:text-accent" onClick={() => setOpen(false)}>
          Close
        </button>
      </div>
      <p className="mt-1.5 text-[11px] text-muted">
        Only material a client can be sent: public lyzr.ai case studies, blueprints, playbooks, templates and blog
        posts. Adding one puts its link in the body{addedCount ? "; save to keep it" : ""}.
      </p>

      {pending && !result ? <p className="mt-2 text-xs text-muted">Finding material for this contact...</p> : null}
      {result?.error ? <p role="alert" className="mt-2 text-xs text-bad">{result.error}</p> : null}
      {result && !result.error ? (
        result.items.length ? (
          <ul className="mt-2 divide-y divide-line">
            {result.items.map((item) => {
              const done = added.includes(item.id);
              return (
                <li key={item.id} className="flex items-center gap-2 py-1.5">
                  <div className="min-w-0 flex-1">
                    <a href={item.url} target="_blank" rel="noreferrer" className="block truncate text-xs font-medium hover:text-accent">
                      {item.title}
                    </a>
                    <span className="text-[11px] text-muted">{COLLATERAL_TYPE_LABEL[item.content_type] ?? item.content_type}</span>
                  </div>
                  <button
                    type="button"
                    className={BUTTON}
                    disabled={done}
                    onClick={() => {
                      onAdd(item);
                      setAdded((ids) => [...ids, item.id]);
                    }}
                  >
                    {done ? "Added" : "Add"}
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="mt-2 text-xs text-muted">Nothing a client can be sent matches that. Try other words.</p>
        )
      ) : null}
    </div>
  );
}

/** Replace the draft with a fresh one from Claude, optionally with a new note. */
export function RedraftForm({ draftId, instruction }: { draftId: string; instruction: string | null }) {
  const [state, formAction, pending] = useActionState(redraft, initial);

  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="draft_id" value={draftId} />
      <label htmlFor="redraft-note" className="text-[11px] font-medium uppercase tracking-wide text-muted">
        Note for Claude
      </label>
      <textarea
        id="redraft-note"
        name="instruction"
        rows={3}
        maxLength={500}
        defaultValue={instruction ?? ""}
        placeholder="e.g. shorter, and lead with the audit guide"
        className="w-full rounded-md border border-line-strong bg-surface px-2 py-1.5 text-xs outline-none focus:border-accent"
      />
      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" disabled={pending} className={BUTTON}>
          {pending ? "Redrafting..." : "Redraft with Claude"}
        </button>
        <span className="text-[11px] text-muted">Replaces the subject and body, including your edits.</span>
      </div>
      <Feedback state={state} />
    </form>
  );
}

export function DiscardDraftButton({ draftId }: { draftId: string }) {
  const [state, formAction, pending] = useActionState(discardDraft, initial);

  return (
    <form
      action={formAction}
      onSubmit={(event) => {
        if (!window.confirm("Discard this draft? It can't be recovered.")) event.preventDefault();
      }}
      className="flex flex-col items-start gap-1"
    >
      <input type="hidden" name="draft_id" value={draftId} />
      <button type="submit" disabled={pending} className="text-xs text-muted hover:text-bad disabled:opacity-60">
        {pending ? "Discarding..." : "Discard draft"}
      </button>
      {state.error ? <p role="alert" className="text-[11px] text-bad">{state.error}</p> : null}
    </form>
  );
}

/** Send a ready email. The server re-runs every check before it queues. */
export function SendEmailForm({
  draftId,
  recipient,
  disabledReason,
  testMode,
}: {
  draftId: string;
  recipient: string;
  /** Shown instead of the button when the checks already say it can't send. */
  disabledReason: string | null;
  testMode: boolean;
}) {
  const [state, formAction, pending] = useActionState(sendEmail, initial);

  return (
    <form
      action={formAction}
      onSubmit={(event) => {
        const question = testMode
          ? `Send in test mode? It will be recorded as sent to ${recipient}, but nothing is delivered.`
          : `Send this email to ${recipient} now?`;
        if (!window.confirm(question)) event.preventDefault();
      }}
      className="space-y-2"
    >
      <input type="hidden" name="draft_id" value={draftId} />
      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" disabled={pending || !!disabledReason} className={PRIMARY}>
          {pending ? "Queueing..." : testMode ? "Send (test mode)" : "Send"}
        </button>
        {disabledReason ? <span className="text-[11px] text-muted">{disabledReason}</span> : null}
      </div>
      <Feedback state={state} />
    </form>
  );
}

export function StopSendingButton({ draftId }: { draftId: string }) {
  const [state, formAction, pending] = useActionState(stopSending, initial);

  return (
    <form action={formAction} className="space-y-1">
      <input type="hidden" name="draft_id" value={draftId} />
      <button type="submit" disabled={pending} className={BUTTON}>
        {pending ? "Stopping..." : "Stop sending"}
      </button>
      <Feedback state={state} />
    </form>
  );
}
