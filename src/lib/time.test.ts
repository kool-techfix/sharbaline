import { describe, expect, it } from "vitest";
import { formatHospitalDate, formatHospitalTime, hospitalDateKey } from "./time";

describe("hospital time (Africa/Lagos, UTC+1, no DST)", () => {
  it("shows UTC instants in Lagos time", () => {
    expect(formatHospitalTime(new Date("2026-11-06T08:42:00Z"))).toBe("09:42");
  });

  it("rolls the calendar date at Lagos midnight, not UTC midnight", () => {
    const lateUtc = new Date("2026-11-06T23:30:00Z"); // 00:30 on 7 Nov in Lagos
    expect(hospitalDateKey(lateUtc)).toBe("2026-11-07");
    expect(formatHospitalDate(lateUtc)).toBe("7 Nov 2026");
  });
});
