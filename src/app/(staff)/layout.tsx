import type { ReactNode } from "react";
import { LogOut, Stethoscope } from "lucide-react";
import { Sidebar } from "@/components/Sidebar";
import { StatusChip } from "@/components/StatusChip";
import { Button } from "@/components/ui/button";
import { ConnectionProvider, LiveConnectionChip } from "@/components/connection/ConnectionProvider";
import { t } from "@/lib/i18n";
import { serverEnv } from "@/server/config/env";
import { requireSignedIn } from "@/server/http/guard";
import { currentIdleMs } from "@/server/services/auth/session";
import { signOut } from "./actions";
import { IdleLock } from "./_components/IdleLock";
import { LockedPage } from "./_components/LockedPage";
import { RoleSwitcher } from "./_components/RoleSwitcher";
import { navFor } from "./_components/nav";

export const dynamic = "force-dynamic";

/**
 * Every staff page sits behind this layout. A locked session renders only the lock screen,
 * never the page. The layout is not the enforcement point: each page also calls
 * requireRole()/requireSignedIn(), which refuse locked sessions (D-025).
 */
export default async function StaffLayout({ children }: { children: ReactNode }) {
  const session = await requireSignedIn({ allowLocked: true });
  const name = session.user.displayName;

  return (
    <ConnectionProvider>
      <div className="flex min-h-dvh flex-col">
        <header className="flex min-h-16 flex-wrap items-center justify-between gap-3 border-b border-border bg-surface px-4">
          <div className="flex items-center gap-3">
            <Stethoscope aria-hidden="true" className="size-6 text-primary" />
            <span className="font-semibold text-heading">{serverEnv().HOSPITAL_NAME}</span>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <LiveConnectionChip />
            <span className="font-semibold text-heading">{name}</span>
            <StatusChip tone="neutral">{t(`role.${session.role}`)}</StatusChip>
            <form action={signOut}>
              <Button type="submit" variant="secondary">
                <LogOut aria-hidden="true" />
                {t("staff.signOut")}
              </Button>
            </form>
          </div>
        </header>
        {session.status === "locked" ? (
          <LockedPage displayName={name} />
        ) : (
          <IdleLock idleMs={currentIdleMs()} displayName={name}>
            <div className="flex flex-1 flex-col md:flex-row">
              <Sidebar
                label={t("staff.nav")}
                items={navFor(session.role)}
                footer={<RoleSwitcher roles={session.user.roles} active={session.role} />}
              />
              <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-10">{children}</main>
            </div>
          </IdleLock>
        )}
      </div>
    </ConnectionProvider>
  );
}
