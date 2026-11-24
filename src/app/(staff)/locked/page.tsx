import { redirect } from "next/navigation";
import { ROLE_HOME } from "@/server/auth/stage";
import { requireSignedIn } from "@/server/http/guard";

/**
 * Where pages send an idle-locked session. The staff layout shows the lock screen in place of
 * this page; once unlocked, the refresh lands back on the role's home.
 */
export default async function LockedRoute() {
  const session = await requireSignedIn({ allowLocked: true });
  if (session.status !== "locked") redirect(ROLE_HOME[session.role]);
  return null;
}
