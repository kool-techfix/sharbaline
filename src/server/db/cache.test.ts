import { describe, expect, it, vi } from "vitest";
import { Prisma } from "@/generated/prisma/client";
import * as enums from "@/generated/prisma/enums";
import { currentClient, schemaFingerprint } from "./cache";

function fakeClient() {
  return { $disconnect: vi.fn(() => Promise.resolve()) };
}

describe("currentClient", () => {
  it("builds a client when none is cached", () => {
    const made = fakeClient();
    expect(currentClient(undefined, "v1", () => made)).toEqual({ client: made, schema: "v1" });
  });

  it("keeps the cached client while the schema is unchanged, whichever bundle asks", () => {
    // Pages and server actions each have their own copy of the generated client in production;
    // they must share one client rather than keep replacing each other's.
    const cached = { client: fakeClient(), schema: "v1" };
    const create = vi.fn(fakeClient);
    expect(currentClient(cached, "v1", create)).toBe(cached);
    expect(currentClient(cached, "v1", create)).toBe(cached);
    expect(create).not.toHaveBeenCalled();
    expect(cached.client.$disconnect).not.toHaveBeenCalled();
  });

  it("replaces the client and closes the old one after the schema changes", () => {
    const cached = { client: fakeClient(), schema: "v1" };
    const made = fakeClient();
    expect(currentClient(cached, "v2", () => made)).toEqual({ client: made, schema: "v2" });
    expect(cached.client.$disconnect).toHaveBeenCalledOnce();
  });

  it("doesn't throw when closing the old client fails", async () => {
    const old = { $disconnect: vi.fn(() => Promise.reject(new Error("already closed"))) };
    expect(currentClient({ client: old, schema: "v1" }, "v2", fakeClient).schema).toBe("v2");
    await Promise.resolve();
  });
});

describe("schemaFingerprint", () => {
  it("covers models, their fields and enum values, and is stable", () => {
    const fingerprint = schemaFingerprint(Prisma, enums);
    expect(fingerprint).toBe(schemaFingerprint({ ...Prisma }, { ...enums }));
    expect(fingerprint).toContain("BreakGlassEvent");
    expect(fingerprint).toContain("reasonDetails");
    expect(fingerprint).toContain("needs_follow_up");
  });

  it("changes when a field or an enum value is added", () => {
    const base = schemaFingerprint(Prisma, enums);
    const withField = schemaFingerprint({ ...Prisma, PatientScalarFieldEnum: { ...Prisma.PatientScalarFieldEnum, nickname: "nickname" } }, enums);
    const withValue = schemaFingerprint(Prisma, { ...enums, Sex: { ...enums.Sex, other: "other" } });
    expect(withField).not.toBe(base);
    expect(withValue).not.toBe(base);
  });
});
