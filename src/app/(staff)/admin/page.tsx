import Link from "next/link";
import { ShieldAlert, ShieldCheck, Users, Search } from "lucide-react";
import { t, tPlural } from "@/lib/i18n";
import { requestContext } from "@/server/http/context";
import { actorOf, requireRole } from "@/server/http/guard";
import { listBreakGlass } from "@/server/services/break-glass/break-glass";

export const dynamic = "force-dynamic";

const linkClass =
  "inline-flex min-h-11 items-center gap-2 rounded-md border border-primary bg-surface px-4 font-semibold text-primary hover:bg-primary-soft";

/** Admin home: break-glass accesses waiting for review first, then the everyday tools. */
export default async function AdminHomePage() {
  const session = await requireRole("admin");
  const outcome = await listBreakGlass(await requestContext(actorOf(session)), { status: "awaiting" });
  const awaiting = outcome.ok ? outcome.value.awaitingCount : 0;

  return (
    <section aria-labelledby="welcome" className="space-y-6">
      <div>
        <h1 id="welcome" className="text-3xl font-bold">
          {t("staff.placeholderTitle", { name: session.user.displayName })}
        </h1>
        <p className="mt-2 text-muted">{t("admin.home.intro")}</p>
      </div>

      <section
        aria-labelledby="bg-summary"
        className={
          awaiting > 0
            ? "space-y-3 rounded-md border border-warning-text bg-warning-bg p-5 text-warning-text"
            : "space-y-3 rounded-md border border-border bg-surface p-5"
        }
      >
        <h2 id="bg-summary" className="flex items-center gap-2 text-xl font-bold">
          {awaiting > 0 ? <ShieldAlert aria-hidden="true" className="size-6" /> : <ShieldCheck aria-hidden="true" className="size-6" />}
          {awaiting > 0 ? tPlural("admin.home.awaiting", awaiting) : t("admin.home.awaitingNone")}
        </h2>
        <Link href="/admin/break-glass" className={linkClass}>
          {t("admin.home.review")}
        </Link>
      </section>

      <div className="flex flex-wrap gap-3">
        <Link href="/admin/patients" className={linkClass}>
          <Search aria-hidden="true" className="size-5" />
          {t("admin.home.patients")}
        </Link>
        <Link href="/admin/users" className={linkClass}>
          <Users aria-hidden="true" className="size-5" />
          {t("admin.home.users")}
        </Link>
      </div>
    </section>
  );
}
