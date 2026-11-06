import type { Role } from "@/server/permissions/roles";

/** Who is acting. Sessions (Part B) produce `user`; login and health checks run as `anonymous`. */
export type Actor =
  | { kind: "user"; userId: string; role: Role; sessionId: string }
  | { kind: "anonymous" };

/** Per-request facts every service and audit entry needs. Contains no patient data. */
export interface RequestContext {
  actor: Actor;
  /** Opaque ID tying audit entries and log lines for one request together. */
  requestId: string;
  ip: string | null;
  deviceId: string | null;
}
