import { uuidv7 } from "@/lib/ids";
import type { RequestContext } from "@/server/kernel/context";
import type { Role } from "@/server/permissions/roles";

/** A request context for a synthetic staff member in the given role. */
export function userContext(role: Role, overrides: Partial<RequestContext> = {}): RequestContext {
  return {
    actor: { kind: "user", userId: uuidv7(), role, sessionId: uuidv7() },
    requestId: `req-${uuidv7()}`,
    ip: "192.0.2.10", // TEST-NET-1 documentation address
    deviceId: uuidv7(),
    ...overrides,
  };
}

export function anonymousContext(overrides: Partial<RequestContext> = {}): RequestContext {
  return {
    actor: { kind: "anonymous" },
    requestId: `req-${uuidv7()}`,
    ip: "192.0.2.20",
    deviceId: null,
    ...overrides,
  };
}
