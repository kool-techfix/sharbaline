import { describe, expect, it } from "vitest";
import { EMPTY_THROTTLE, isLocked, registerFailure, type ThrottleState } from "./lockout";

const at = (minutes: number) => new Date(Date.UTC(2026, 10, 6, 9, 0) + minutes * 60_000);

function fail(times: number, startMinute = 0): ThrottleState & { justLocked: boolean } {
  let state: ThrottleState & { justLocked: boolean } = { ...EMPTY_THROTTLE, justLocked: false };
  for (let i = 0; i < times; i++) state = registerFailure(state, at(startMinute + i * 0.1));
  return state;
}

describe("lockout (5 failures → 15 minutes)", () => {
  it("does not lock on the first four failures", () => {
    const state = fail(4);
    expect(state.failedCount).toBe(4);
    expect(state.justLocked).toBe(false);
    expect(isLocked(state, at(1))).toBe(false);
  });

  it("locks on the fifth failure for 15 minutes", () => {
    const state = fail(5);
    expect(state.justLocked).toBe(true);
    expect(isLocked(state, at(1))).toBe(true);
    expect(isLocked(state, at(15.3))).toBe(true);
    expect(isLocked(state, at(15.5))).toBe(false);
  });

  it("starts counting again after the lock expires", () => {
    const locked = fail(5);
    const after = registerFailure(locked, at(30));
    expect(after.failedCount).toBe(1);
    expect(after.justLocked).toBe(false);
  });

  it("forgets failures older than the 15-minute window", () => {
    const four = fail(4);
    const later = registerFailure(four, at(20));
    expect(later.failedCount).toBe(1);
  });
});
