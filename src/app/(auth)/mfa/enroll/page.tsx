import { redirect } from "next/navigation";
import { currentSession } from "@/server/http/guard";
import { isSignedOut } from "@/server/auth/session-rules";
import { ROLE_HOME, pathForStage } from "@/server/auth/stage";
import { EnrollFlow } from "./_components/EnrollFlow";

export const dynamic = "force-dynamic";

export default async function EnrollPage() {
  const session = await currentSession();
  if (!session || isSignedOut(session.status)) redirect("/login");
  if (session.status !== "pending_stage") {
    // Enrollment just finished: confirming it sets the session cookie, which makes Next re-render
    // this page. Keep rendering the flow so the recovery codes (shown once) stay on screen;
    // EnrollFlow leaves when the user continues.
    return <EnrollFlow signedInHome={ROLE_HOME[session.role]} />;
  }
  if (session.stage !== "mfa_enrollment_required") redirect(pathForStage(session.stage, session.role));
  return <EnrollFlow signedInHome={null} />;
}
