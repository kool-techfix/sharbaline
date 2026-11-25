import { ShieldCheck } from "lucide-react";
import { StatusChip } from "@/components/StatusChip";
import { t } from "@/lib/i18n";
import { requireSignedIn } from "@/server/http/guard";
import { hasActiveAuthenticator } from "@/server/services/auth/mfa";
import { OwnMfaSetup } from "./_components/OwnMfaSetup";

export const dynamic = "force-dynamic";

/** The signed-in user's own account. Shows only their own, non-clinical details. */
export default async function AccountPage() {
  const session = await requireSignedIn();
  const enrolled = await hasActiveAuthenticator(session.user.id);

  return (
    <section aria-labelledby="account-title" className="space-y-8">
      <header className="space-y-2">
        <h1 id="account-title" className="text-3xl font-bold">
          {t("account.title")}
        </h1>
        <p className="text-xl font-semibold text-heading">{session.user.displayName}</p>
        <dl className="grid max-w-md grid-cols-[auto_1fr] gap-x-4 gap-y-1">
          <dt className="font-semibold">{t("account.staffId")}</dt>
          <dd className="font-mono">{session.user.staffId}</dd>
          <dt className="font-semibold">{t("account.roles")}</dt>
          <dd>{session.user.roles.map((role) => t(`role.${role}`)).join(", ")}</dd>
        </dl>
      </header>
      <section aria-labelledby="mfa-title" className="space-y-3">
        <h2 id="mfa-title" className="text-xl font-bold">
          {t("account.mfa.title")}
        </h2>
        {enrolled ? (
          <div className="space-y-3">
            <StatusChip tone="info" icon={ShieldCheck}>
              {t("users.status.mfaOn")}
            </StatusChip>
            <p>{t("account.mfa.on")}</p>
          </div>
        ) : (
          <OwnMfaSetup />
        )}
      </section>
    </section>
  );
}
