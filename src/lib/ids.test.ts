import { describe, expect, it } from "vitest";
import { UUID_PATTERN, uuidv7 } from "./ids";

describe("uuidv7", () => {
  it("produces RFC 9562 version-7 UUIDs", () => {
    const id = uuidv7();
    expect(id).toMatch(UUID_PATTERN);
    expect(id[14]).toBe("7");
    expect(["8", "9", "a", "b"]).toContain(id[19]);
  });

  it("encodes the timestamp so IDs sort by creation time", () => {
    const earlier = uuidv7(Date.UTC(2026, 0, 1));
    const later = uuidv7(Date.UTC(2026, 0, 1, 0, 0, 0, 1));
    expect(earlier < later).toBe(true);
    expect(uuidv7(0).startsWith("00000000-0000-7")).toBe(true);
  });

  it("does not repeat", () => {
    const ids = new Set(Array.from({ length: 5_000 }, () => uuidv7(1_700_000_000_000)));
    expect(ids.size).toBe(5_000);
  });
});
