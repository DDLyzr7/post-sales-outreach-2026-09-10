import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/db/queries";
import { signOut } from "@/app/login/actions";
import { Badge } from "@/components/ui";
import { NavLinks } from "@/components/nav-links";
import { ROLE_LABEL } from "@/lib/format";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const links = [
    { href: "/", label: "Accounts" },
    { href: "/targets", label: "My targets" },
    // Hidden from everyone but the lead; the page and its writes are refused for them anyway.
    ...(user.is_admin ? [{ href: "/team", label: "Team coverage" }] : []),
  ];

  return (
    <>
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex w-full max-w-[1400px] flex-wrap items-center justify-between gap-4 px-6 py-3">
          <div className="flex flex-wrap items-center gap-5">
            <Link href="/" className="text-sm font-semibold tracking-tight">
              Post-Sales Outreach
            </Link>
            <NavLinks links={links} />
          </div>

          <div className="flex items-center gap-3 text-xs">
            <span className="text-muted">
              {user.full_name}
              {user.title ? ` · ${user.title}` : ""}
            </span>
            {user.is_admin ? (
              <Badge tone="accent" title="Sees every account by policy, not by assignment">
                Post-sales lead
              </Badge>
            ) : user.default_role ? (
              <Badge title={ROLE_LABEL[user.default_role]}>
                {user.default_role.toUpperCase()}
              </Badge>
            ) : null}
            <form action={signOut}>
              <button type="submit" className="text-muted hover:text-accent">
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>

      <main className="flex-1">{children}</main>
    </>
  );
}
