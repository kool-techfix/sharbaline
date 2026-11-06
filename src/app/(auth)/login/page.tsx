import { redirect } from "next/navigation";
import { t } from "@/lib/i18n";
import { isSignedOut } from "@/server/auth/session-rules";
import { ROLE_HOME, pathForStage } from "@/server/auth/stage";
import { currentSession } from "@/server/http/guard";
import { LoginFlow } from "./_components/LoginFlow";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ reason?: string }> }) {
  const session = await currentSession();
  let initialStep: "credentials" | "totp" = "credentials";
  let signedInHome: string | null = null;

  if (session && !isSignedOut(session.status)) {
    if (session.status === "pending_stage") {
      if (session.stage === "mfa_pending") initialStep = "totp";
      else redirect(pathForStage(session.stage, session.role));
    } else {
      // Already signed in (or locked). Not a server redirect: when a sign-in step sets the
      // session cookie, Next re-renders this page, and the flow may still need to show something
      // (e.g. the low-recovery-codes warning). LoginFlow navigates once it's done.
      signedInHome = ROLE_HOME[session.role];
    }
  }

  const { reason } = await searchParams;
  const notice = reason === "signed_out" ? t("auth.signIn.signedOut") : null;
  return <LoginFlow initialStep={initialStep} notice={notice} signedInHome={signedInHome} />;
}
