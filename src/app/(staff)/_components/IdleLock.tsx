"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { lockScreen, reportActivity } from "../actions";
import { LockScreen } from "./LockScreen";

const HEARTBEAT_MS = 30_000;
const TICK_MS = 1_000;
const CHANNEL = "hms-session";

type Message = { type: "activity"; at: number } | { type: "lock" } | { type: "unlock" };

/**
 * Locks the screen after `idleMs` without keyboard/pointer input (10 min; shorter only via the
 * e2e override). Only real user input counts: the heartbeat never extends the session.
 * - activity is reported to the server at most every 30 s, so the server-side lock agrees
 * - all tabs share activity and lock state (BroadcastChannel)
 * - the heartbeat picks up a lock or sign-out made elsewhere (admin revoke, disabled account)
 */
export function IdleLock({
  idleMs,
  displayName,
  children,
}: {
  idleMs: number;
  displayName: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const [locked, setLocked] = useState(false);
  const lastInput = useRef(0);
  const lastReport = useRef(0);
  const channel = useRef<BroadcastChannel | null>(null);
  const reportEveryMs = Math.min(30_000, Math.floor(idleMs / 2));

  const lockNow = useCallback((broadcast: boolean) => {
    setLocked(true);
    if (broadcast) {
      channel.current?.postMessage({ type: "lock" } satisfies Message);
      void lockScreen().catch(() => undefined);
    }
  }, []);

  useEffect(() => {
    lastInput.current = Date.now();
    lastReport.current = Date.now();
    const bc = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(CHANNEL);
    channel.current = bc;
    bc?.addEventListener("message", (event: MessageEvent<Message>) => {
      if (event.data.type === "activity") lastInput.current = Math.max(lastInput.current, event.data.at);
      if (event.data.type === "lock") setLocked(true);
      if (event.data.type === "unlock") {
        lastInput.current = Date.now();
        setLocked(false);
        router.refresh();
      }
    });
    return () => bc?.close();
  }, [router]);

  // User input → local timer, other tabs, and (throttled) the server.
  useEffect(() => {
    if (locked) return;
    const onInput = () => {
      const now = Date.now();
      lastInput.current = now;
      if (now - lastReport.current >= reportEveryMs) {
        lastReport.current = now;
        channel.current?.postMessage({ type: "activity", at: now } satisfies Message);
        void reportActivity().catch(() => undefined);
      }
    };
    const events = ["keydown", "pointerdown", "wheel", "touchstart"] as const;
    for (const name of events) window.addEventListener(name, onInput, { passive: true });
    const tick = setInterval(() => {
      if (Date.now() - lastInput.current >= idleMs) lockNow(true);
    }, TICK_MS);
    return () => {
      for (const name of events) window.removeEventListener(name, onInput);
      clearInterval(tick);
    };
  }, [locked, idleMs, reportEveryMs, lockNow]);

  // Heartbeat: notices revocation, disabling, or a lock from another device or tab.
  useEffect(() => {
    const beat = async () => {
      try {
        const response = await fetch("/api/session/status", { cache: "no-store" });
        const { state } = (await response.json()) as { state: "active" | "locked" | "signed_out" };
        // Full reload on purpose: it discards the client-side page cache, which may hold patient data.
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination
        if (state === "signed_out") window.location.assign("/login?reason=signed_out");
        else if (state === "locked") setLocked(true);
      } catch {
        // Server unreachable: the connection chip shows it; the local idle timer still runs.
      }
    };
    const timer = setInterval(beat, HEARTBEAT_MS);
    return () => clearInterval(timer);
  }, []);

  if (locked) {
    return (
      <LockScreen
        displayName={displayName}
        onUnlocked={() => {
          lastInput.current = Date.now();
          lastReport.current = Date.now();
          channel.current?.postMessage({ type: "unlock" } satisfies Message);
          setLocked(false);
          router.refresh();
        }}
      />
    );
  }
  return <>{children}</>;
}
