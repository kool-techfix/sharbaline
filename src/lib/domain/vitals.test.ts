import { describe, expect, it } from "vitest";
import { parseMeasurement } from "./vitals";

describe("parseMeasurement", () => {
  it("treats an empty box as not measured", () => {
    expect(parseMeasurement("pulseBpm", "  ")).toEqual({ ok: true, value: null });
  });

  it("accepts values inside the range, with a decimal comma or point", () => {
    expect(parseMeasurement("temperatureC", "37.2")).toEqual({ ok: true, value: 37.2 });
    expect(parseMeasurement("temperatureC", "37,2")).toEqual({ ok: true, value: 37.2 });
    expect(parseMeasurement("weightKg", "0.3")).toEqual({ ok: true, value: 0.3 });
    expect(parseMeasurement("spo2Pct", "100")).toEqual({ ok: true, value: 100 });
  });

  it("catches typos outside the range", () => {
    expect(parseMeasurement("temperatureC", "378")).toEqual({ ok: false, problem: "range" });
    expect(parseMeasurement("spo2Pct", "101")).toEqual({ ok: false, problem: "range" });
    expect(parseMeasurement("pulseBpm", "19")).toEqual({ ok: false, problem: "range" });
  });

  it("refuses decimals where the measure is whole, and more than one decimal place", () => {
    expect(parseMeasurement("pulseBpm", "72.5")).toEqual({ ok: false, problem: "decimals" });
    expect(parseMeasurement("pulseBpm", "72.0")).toEqual({ ok: true, value: 72 });
    expect(parseMeasurement("temperatureC", "37.25")).toEqual({ ok: false, problem: "decimals" });
  });

  it("refuses anything that isn't a plain number", () => {
    for (const raw of ["abc", "-5", "37..2", "1e2", "37 C"]) {
      expect(parseMeasurement("temperatureC", raw)).toEqual({ ok: false, problem: "notNumber" });
    }
  });
});
