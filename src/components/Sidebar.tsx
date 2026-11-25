"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export interface NavItem {
  href: string;
  label: string;
}

/** A link is current on its own page and on pages below it (e.g. /admin/users/123). */
function isCurrent(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Role-based navigation. The items come from the server for the session's active role; hiding
 * links is convenience only, every page checks the role itself (D-025).
 */
export function Sidebar({ label, items, footer }: { label: string; items: NavItem[]; footer?: ReactNode }) {
  const pathname = usePathname();
  // Only the most specific match is "current", so Home (/admin) isn't current on /admin/users.
  const current = items
    .filter((item) => isCurrent(pathname, item.href))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;

  return (
    <aside className="flex flex-col gap-6 border-border bg-surface px-3 py-4 md:w-60 md:shrink-0 md:border-r">
      <nav aria-label={label}>
        <ul className="flex flex-wrap gap-1 md:flex-col">
          {items.map((item) => (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={item.href === current ? "page" : undefined}
                className={cn(
                  "flex min-h-11 items-center rounded-md px-3 text-base font-semibold text-text hover:bg-primary-soft",
                  item.href === current && "bg-primary-soft text-primary",
                )}
              >
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      {footer}
    </aside>
  );
}
