"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { connectionStateFrom, type ConnectionState, type HealthResponse } from "@/lib/connection";
import { ConnectionChip } from "@/components/ConnectionChip";

interface ConnectionContextValue {
  state: ConnectionState;
  /** Check now (e.g. "Try connection again"). Resolves with the new state. */
  recheck: () => Promise<ConnectionState>;
  /** A request just failed at the network level: show "Server unreachable" immediately. */
  reportUnreachable: () => void;
}

const ConnectionContext = createContext<ConnectionContextValue | null>(null);

const POLL_MS = 30_000;
const TIMEOUT_MS = 5_000;

async function fetchHealth(): Promise<HealthResponse | null> {
  try {
    const response = await fetch("/api/health", { cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) });
    return response.ok ? ((await response.json()) as HealthResponse) : null;
  } catch {
    return null;
  }
}

/**
 * Tracks the connection states of scope §7.1 for this device. Optimistic "online" until the
 * first check: the page itself was just served by the server.
 */
export function ConnectionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ConnectionState>("online");

  const recheck = useCallback(async () => {
    const next = connectionStateFrom(await fetchHealth());
    setState(next);
    return next;
  }, []);

  const reportUnreachable = useCallback(() => setState("server_unreachable"), []);

  useEffect(() => {
    // Initial check and polling; setState happens after the fetch resolves, not synchronously.
    const first = setTimeout(() => void recheck(), 0);
    const timer = setInterval(() => void recheck(), POLL_MS);
    const onChange = () => void recheck();
    window.addEventListener("online", onChange);
    window.addEventListener("offline", onChange);
    window.addEventListener("focus", onChange);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
      window.removeEventListener("online", onChange);
      window.removeEventListener("offline", onChange);
      window.removeEventListener("focus", onChange);
    };
  }, [recheck]);

  const value = useMemo(() => ({ state, recheck, reportUnreachable }), [state, recheck, reportUnreachable]);
  return <ConnectionContext.Provider value={value}>{children}</ConnectionContext.Provider>;
}

export function useConnection(): ConnectionContextValue {
  const value = useContext(ConnectionContext);
  if (!value) throw new Error("useConnection must be used inside ConnectionProvider");
  return value;
}

export function LiveConnectionChip() {
  const { state } = useConnection();
  return <ConnectionChip state={state} />;
}
