import { describe, expect, it } from "vitest";
import { clientIpFrom } from "./client-ip";
import { connectionStateFrom } from "@/lib/connection";

describe("client IP from the proxy", () => {
  it("ignores X-Forwarded-For unless the proxy is trusted", () => {
    expect(clientIpFrom("10.0.0.5", false)).toBeNull();
  });

  it("uses the rightmost entry, the one our proxy appended", () => {
    expect(clientIpFrom("6.6.6.6, 192.168.10.23", true)).toBe("192.168.10.23");
    expect(clientIpFrom("192.168.10.23", true)).toBe("192.168.10.23");
  });

  it("rejects junk and unwraps IPv4-mapped addresses", () => {
    expect(clientIpFrom("not-an-ip", true)).toBeNull();
    expect(clientIpFrom("::ffff:192.168.1.4", true)).toBe("192.168.1.4");
    expect(clientIpFrom("[fe80::1]", true)).toBe("fe80::1");
  });
});

describe("connection state (scope §7.1)", () => {
  it("keeps the states distinct", () => {
    expect(connectionStateFrom(null)).toBe("server_unreachable");
    expect(connectionStateFrom({ server: "ok", internet: "down" })).toBe("working_offline");
    expect(connectionStateFrom({ server: "ok", internet: "up" })).toBe("online");
    expect(connectionStateFrom({ server: "ok", internet: "unknown" })).toBe("online");
  });
});
