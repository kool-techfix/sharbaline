import { redirect } from "next/navigation";
import { currentSession } from "@/server/http/guard";
import { pathForStage } from "@/server/auth/stage";
import { ChangePasswordForm } from "./_components/ChangePasswordForm";

export const dynamic = "force-dynamic";

export default async function ChangePasswordPage() {
  const session = await currentSession();
  if (!session || session.status !== "pending_stage") redirect("/login");
  if (session.stage !== "password_change_required") redirect(pathForStage(session.stage, session.role));
  return <ChangePasswordForm />;
}
