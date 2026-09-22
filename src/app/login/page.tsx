import { LoginForm } from "./login-form";
import { signInWithMicrosoft } from "./actions";
import { passwordSignInEnabled, safeNextPath } from "@/lib/auth";

function MicrosoftMark() {
  return (
    <svg aria-hidden width="16" height="16" viewBox="0 0 16 16">
      <rect x="0" y="0" width="7.5" height="7.5" fill="#F25022" />
      <rect x="8.5" y="0" width="7.5" height="7.5" fill="#7FBA00" />
      <rect x="0" y="8.5" width="7.5" height="7.5" fill="#00A4EF" />
      <rect x="8.5" y="8.5" width="7.5" height="7.5" fill="#FFB900" />
    </svg>
  );
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next, error } = await searchParams;
  const nextPath = safeNextPath(next);
  const showPassword = passwordSignInEnabled();

  return (
    <main className="flex flex-1 items-center justify-center px-6 py-16">
      <div className="w-full max-w-sm">
        <h1 className="font-display text-2xl font-semibold tracking-tight">Post-Sales Outreach</h1>
        <p className="mt-1 mb-8 text-sm text-muted">
          Sign in with your Lyzr Microsoft account to see the accounts you are accountable for.
        </p>

        <div className="rounded-lg border border-line bg-surface p-6">
          {error ? (
            <p role="alert" className="mb-4 rounded-md bg-bad-soft px-3 py-2 text-xs text-bad">
              {error}
            </p>
          ) : null}

          <form action={signInWithMicrosoft}>
            <input type="hidden" name="next" value={nextPath} />
            <button
              type="submit"
              className="flex w-full items-center justify-center gap-2 rounded-md border border-line-strong bg-surface px-3 py-2 text-sm font-medium hover:border-accent"
            >
              <MicrosoftMark />
              Continue with Microsoft
            </button>
          </form>

          {showPassword ? (
            <>
              <div className="my-5 flex items-center gap-3 text-[11px] uppercase tracking-wide text-muted">
                <span className="h-px flex-1 bg-line" />
                or sign in with a password
                <span className="h-px flex-1 bg-line" />
              </div>
              <LoginForm next={nextPath} />
            </>
          ) : null}
        </div>
      </div>
    </main>
  );
}
