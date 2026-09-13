"use client";

import { useActionState } from "react";
import { disconnectMailbox, setSendingMode, type SettingsState } from "@/app/(app)/settings/actions";

const initial: SettingsState = { error: null, notice: null };

function Feedback({ state }: { state: SettingsState }) {
  if (state.error) return <p role="alert" className="text-xs text-bad">{state.error}</p>;
  if (state.notice) return <p role="status" className="text-xs text-ok">{state.notice}</p>;
  return null;
}

export function DisconnectMailboxButton() {
  const [state, formAction, pending] = useActionState(disconnectMailbox, initial);
  return (
    <form
      action={formAction}
      onSubmit={(event) => {
        if (!window.confirm("Disconnect your mailbox? Queued emails wait until you connect it again.")) event.preventDefault();
      }}
      className="space-y-1"
    >
      <button
        type="submit"
        disabled={pending}
        className="rounded-md border border-line-strong bg-surface px-3 py-1.5 text-xs font-medium hover:border-bad hover:text-bad disabled:opacity-60"
      >
        {pending ? "Disconnecting..." : "Disconnect"}
      </button>
      <Feedback state={state} />
    </form>
  );
}

const MODE_OPTIONS = [
  { value: "dry_run", label: "Test mode", detail: "Send records emails as sent. Nothing is delivered." },
  { value: "live", label: "Live", detail: "Emails go to real recipients from each author's mailbox." },
  { value: "paused", label: "Paused", detail: "Nothing new can be queued; queued emails wait." },
];

export function SendingModeForm({ current }: { current: string }) {
  const [state, formAction, pending] = useActionState(setSendingMode, initial);
  return (
    <form
      action={formAction}
      onSubmit={(event) => {
        const mode = new FormData(event.currentTarget).get("mode");
        if (mode === "live" && current !== "live" && !window.confirm("Switch sending to live? Emails will reach real clients.")) {
          event.preventDefault();
        }
      }}
      className="space-y-3"
    >
      <fieldset className="space-y-2">
        <legend className="sr-only">Sending mode</legend>
        {MODE_OPTIONS.map((option) => (
          <label key={option.value} className="flex items-start gap-2 text-sm">
            <input type="radio" name="mode" value={option.value} defaultChecked={current === option.value} className="mt-1" />
            <span>
              <span className="font-medium">{option.label}</span>
              <span className="block text-xs text-muted">{option.detail}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-60"
      >
        {pending ? "Saving..." : "Save sending mode"}
      </button>
      <Feedback state={state} />
    </form>
  );
}
