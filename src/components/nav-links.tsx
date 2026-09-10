"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function NavLinks({ links }: { links: { href: string; label: string }[] }) {
  const pathname = usePathname();

  return (
    <nav aria-label="Main" className="flex items-center gap-1 text-xs">
      {links.map((link) => {
        // Account pages belong to the Accounts section.
        const active =
          link.href === "/"
            ? pathname === "/" || pathname.startsWith("/accounts")
            : pathname.startsWith(link.href);
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? "page" : undefined}
            className={`rounded-md px-2.5 py-1.5 font-medium ${
              active ? "bg-accent-soft text-accent" : "text-muted hover:text-foreground"
            }`}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
