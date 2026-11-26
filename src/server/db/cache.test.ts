import { describe, expect, it, vi } from "vitest";
import { currentClient } from "./cache";

function fakeClient() {
  return { $disconnect: vi.fn(() => Promise.resolve()) };
}

describe("currentClient", () => {
  it("builds a client when none is cached", () => {
    const made = fakeClient();
    const result = currentClient(undefined, "v1", () => made);
    expect(result).toEqual({ client: made, builtBy: "v1" });
  });

  it("keeps the cached client while the generated client is unchanged", () => {
    const cached = { client: fakeClient(), builtBy: "v1" };
    const create = vi.fn(fakeClient);
    expect(currentClient(cached, "v1", create)).toBe(cached);
    expect(create).not.toHaveBeenCalled();
    expect(cached.client.$disconnect).not.toHaveBeenCalled();
  });

  it("replaces the client and closes the old one after the client is regenerated", () => {
    const cached = { client: fakeClient(), builtBy: "v1" };
    const made = fakeClient();
    const result = currentClient(cached, "v2", () => made);
    expect(result).toEqual({ client: made, builtBy: "v2" });
    expect(cached.client.$disconnect).toHaveBeenCalledOnce();
  });

  it("doesn't throw when closing the old client fails", async () => {
    const old = { $disconnect: vi.fn(() => Promise.reject(new Error("already closed"))) };
    const result = currentClient({ client: old, builtBy: "v1" }, "v2", fakeClient);
    expect(result.builtBy).toBe("v2");
    await Promise.resolve();
  });
});
