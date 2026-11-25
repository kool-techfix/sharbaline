import { beforeEach, describe, expect, it } from "vitest";
import { ipIsThrottled, recordIpFailure, resetIpThrottle } from "./ip-throttle";
import { AUTH_POLICY } from "./policy";

beforeEach(() => resetIpThrottle());

describe("per-IP sign-in throttle", () => {
  it("limits one address after the configured number of failures", () => {
    const now = Date.now();
    for (let i = 0; i < AUTH_POLICY.ipThrottle.maxFailures; i++) recordIpFailure("192.0.2.5", now);
    expect(ipIsThrottled("192.0.2.5", now)).toBe(true);
    expect(ipIsThrottled("192.0.2.6", now)).toBe(false);
  });

  it("never blocks requests with no known IP (one shared bucket would lock out the whole hospital)", () => {
    const now = Date.now();
    for (let i = 0; i < AUTH_POLICY.ipThrottle.maxFailures * 2; i++) recordIpFailure(null, now);
    expect(ipIsThrottled(null, now)).toBe(false);
  });
});
