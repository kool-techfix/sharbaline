import Link from "next/link";
import { notFound } from "next/navigation";
import { t, tPlural } from "@/lib/i18n";
import { formatHospitalDate, formatHospitalTime } from "@/lib/time";
import { ValidationError } from "@/server/kernel/errors";
import { actorOf, requireRole } from "@/server/http/guard";
import { requestContext } from "@/server/http/context";
import { getUser } from "@/server/services/users/manage";
import { UserStatus } from "../_components/UserStatus";
import { AccountActions } from "./_components/AccountActions";
import { DetailsForm } from "./_components/DetailsForm";
import { RolesForm } from "./_components/RolesForm";

export const dynamic = "force-dynamic";

const when = (date: Date) => `${formatHospitalDate(date)} ${formatHospitalTime(date)}`;

export default async function UserPage({ params }: { params: Promise<{ userId: string }> }) {
  const session = await requireRole("admin");
  const { userId } = await params;
  const outcome = await getUser(await requestContext(actorOf(session)), { userId }).catch((error: unknown) => {
    if (error instanceof ValidationError) return null; // not a valid id: same as not found
    throw error;
  });
  if (!outcome?.ok) notFound();
  const user = outcome.value;

  return (
    <section aria-labelledby="user-title" className="space-y-8">
      <Link href="/admin/users" className="inline-flex min-h-11 items-center font-semibold text-primary underline">
        {t("users.back")}
      </Link>
      <header className="space-y-3">
        <h1 id="user-title" className="text-3xl font-bold">
          {user.displayName}
        </h1>
        <p className="font-mono text-lg">{user.staffId}</p>
        <UserStatus user={user} />
        <ul className="space-y-1 text-muted">
          <li>{t("users.detail.created", { date: when(user.createdAt) })}</li>
          <li>
            {user.lastSignInAt
              ? t("users.detail.lastSignIn", { date: when(user.lastSignInAt) })
              : t("users.detail.neverSignedIn")}
          </li>
          <li>{tPlural("users.detail.sessions", user.activeSessions)}</li>
          {user.mfa === "enrolled" ? <li>{tPlural("users.detail.recoveryCodes", user.recoveryCodesLeft)}</li> : null}
        </ul>
      </header>
      <div className="grid gap-8 lg:grid-cols-2">
        <DetailsForm userId={user.id} displayName={user.displayName} email={user.email} />
        <RolesForm key={user.roles.join(",")} userId={user.id} roles={user.roles} />
      </div>
      <AccountActions
        userId={user.id}
        disabled={user.disabled}
        locked={user.locked}
        mfaEnrolled={user.mfa === "enrolled"}
        isSelf={user.id === session.user.id}
      />
    </section>
  );
}
