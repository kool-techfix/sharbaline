import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CurrentSession } from "@/server/services/auth/session";

// The guard's decisions, with the session lookup and Next's redirect replaced: redirect()
// throws in Next too, so a thrown Redirect means "the page did not render".
class Redirect extends Error {
  constructor(readonly to: string) {
    super(`redirect ${to}`);
  }
}
const readSession = vi.fn<() => Promise<CurrentSession | null>>();
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Redirect(to);
  },
}));
vi.mock("@/server/services/auth/session", () => ({ readSession: () => readSession() }));
vi.mock("./cookies", () => ({ sessionTokenFromCookie: async () => "token" }));
vi.mock("./context", () => ({ requestContext: async () => ({ actor: { kind: "anonymous" } }) }));

const { LOCKED_PATH, requireRole, requireSignedIn } = await import("./guard");
const { ROLES } = await import("@/server/permissions/roles");
const { ROLE_HOME } = await import("@/server/auth/stage");

function session(status: CurrentSession["status"], role: CurrentSession["role"] = "doctor"): CurrentSession {
  return {
    sessionId: "s",
    status,
    stage: status === "pending_stage" ? "mfa_pending" : "active",
    role,
    user: { id: "u", displayName: "Test Staff", staffId: "test.staff", roles: [role] },
    expiresAt: new Date(),
    lastActivityAt: new Date(),
  };
}

async function redirectOf(promise: Promise<unknown>): Promise<string | null> {
  try {
    await promise;
    return null;
  } catch (error) {
    if (error instanceof Redirect) return error.to;
    throw error;
  }
}

beforeEach(() => readSession.mockReset());

describe("page guards (D-025)", () => {
  it("let an active session through", async () => {
    readSession.mockResolvedValue(session("active"));
    expect(await redirectOf(requireRole("doctor"))).toBeNull();
  });

  it("refuse an idle-locked session on every page, not only in the layout", async () => {
    readSession.mockResolvedValue(session("locked"));
    expect(await redirectOf(requireRole("doctor"))).toBe(LOCKED_PATH);
    expect(await redirectOf(requireSignedIn())).toBe(LOCKED_PATH);
  });

  it("let a locked session reach only the lock screen when explicitly allowed", async () => {
    readSession.mockResolvedValue(session("locked"));
    expect(await redirectOf(requireSignedIn({ allowLocked: true }))).toBeNull();
  });

  it("send signed-out, half-signed-in and other-role sessions away", async () => {
    readSession.mockResolvedValue(null);
    expect(await redirectOf(requireRole("doctor"))).toBe("/login?reason=signed_out");
    readSession.mockResolvedValue(session("revoked"));
    expect(await redirectOf(requireSignedIn({ allowLocked: true }))).toBe("/login?reason=signed_out");
    readSession.mockResolvedValue(session("pending_stage"));
    expect(await redirectOf(requireRole("doctor"))).toBe("/login");
    readSession.mockResolvedValue(session("active", "nurse"));
    expect(await redirectOf(requireRole("doctor"))).toBe("/nurse");
  });
});

describe("role pages × roles (generated)", () => {
  for (const page of ROLES) {
    for (const role of ROLES) {
      it(`${role} on the ${page} page: ${role === page ? "allowed" : `sent to ${ROLE_HOME[role]}`}`, async () => {
        readSession.mockResolvedValue(session("active", role));
        expect(await redirectOf(requireRole(page))).toBe(role === page ? null : ROLE_HOME[role]);
      });
    }
  }
});
