"use client";

import { useRouter } from "next/navigation";
import { LockScreen } from "./LockScreen";

/** Server found the session already locked (e.g. page reloaded while locked). */
export function LockedPage({ displayName }: { displayName: string }) {
  const router = useRouter();
  return <LockScreen displayName={displayName} onUnlocked={() => router.refresh()} />;
}
