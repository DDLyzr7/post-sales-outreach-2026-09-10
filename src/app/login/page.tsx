import { LoginForm } from "./login-form";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;

  return (
    <main className="flex flex-1 items-center justify-center px-6 py-16">
      <div className="w-full max-w-sm">
        <h1 className="font-display text-2xl font-semibold tracking-tight">Post-Sales Outreach</h1>
        <p className="mt-1 mb-8 text-sm text-muted">
          Sign in to see the accounts you are accountable for.
        </p>

        <div className="rounded-lg border border-line bg-surface p-6">
          <LoginForm next={next ?? "/"} />
        </div>

        <div className="mt-6 rounded-lg border border-line bg-surface-muted p-4 text-xs text-muted">
          <p className="mb-2 font-medium text-foreground">Sample users</p>
          <ul className="space-y-1 font-mono">
            <li>pm@example.com &middot; Riya Kapoor (PM, 3 accounts)</li>
            <li>cal@example.com &middot; Marcus Webb (CAL, 3 accounts)</li>
            <li>csm@example.com &middot; Elena Ortiz (CSM, 3 accounts)</li>
            <li>lead@example.com &middot; Dana Whitfield (admin, all 8)</li>
          </ul>
          <p className="mt-2">Password: the value of SEED_USER_PASSWORD in .env.local</p>
        </div>
      </div>
    </main>
  );
}
