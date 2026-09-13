import { unsubscribe } from "./actions";

/**
 * The unsubscribe link in cold-path and broadcast emails. Public: the person
 * clicking isn't a user of the app. Opening the page changes nothing (mail
 * scanners open links on their own); the opt-out is recorded only when the button
 * is pressed.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function UnsubscribePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ done?: string }>;
}) {
  const { token } = await params;
  const { done } = await searchParams;
  const valid = UUID.test(token);

  return (
    <main className="flex flex-1 items-center justify-center px-6 py-16">
      <div className="w-full max-w-md rounded-lg border border-line bg-surface p-6">
        {done === "1" ? (
          <>
            <h1 className="font-display text-xl font-semibold tracking-tight">You&apos;re unsubscribed</h1>
            <p className="mt-2 text-sm text-muted">
              We won&apos;t email you about this again. If that was a mistake, reply to any of our emails and
              we&apos;ll sort it out.
            </p>
          </>
        ) : done === "0" || !valid ? (
          <>
            <h1 className="font-display text-xl font-semibold tracking-tight">This link isn&apos;t valid</h1>
            <p className="mt-2 text-sm text-muted">
              It may have been copied incompletely. Reply to the email you received and ask us to stop, and we will.
            </p>
          </>
        ) : (
          <form action={unsubscribe} className="space-y-4">
            <h1 className="font-display text-xl font-semibold tracking-tight">Stop these emails?</h1>
            <p className="text-sm text-muted">
              Press the button and we&apos;ll stop emailing this address about our products.
            </p>
            <input type="hidden" name="token" value={token} />
            <label className="block text-xs text-muted" htmlFor="reason">
              Anything you&apos;d like to tell us (optional)
            </label>
            <textarea
              id="reason"
              name="reason"
              rows={2}
              maxLength={300}
              className="w-full rounded-md border border-line-strong bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
            />
            <button type="submit" className="rounded-md bg-accent px-3 py-2 text-sm font-medium text-white hover:opacity-90">
              Unsubscribe
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
