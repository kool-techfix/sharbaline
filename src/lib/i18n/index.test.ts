import { describe, expect, it } from "vitest";
import en from "@/messages/en.json";
import { t, tPlural } from ".";

describe("i18n", () => {
  it("returns catalogue text and fills variables", () => {
    expect(t("connection.online")).toBe("Online");
    expect(t("connection.lastSynced", { time: "09:42" })).toBe("Last synced 09:42");
  });

  it("picks plural forms", () => {
    expect(tPlural("connection.syncing", 1)).toBe("Syncing 1 change");
    expect(tPlural("connection.syncing", 3)).toBe("Syncing 3 changes");
  });

  it("has no empty messages and every plural has an #other form", () => {
    const entries = Object.entries(en as Record<string, string>);
    for (const [key, value] of entries) expect(value.trim(), key).not.toBe("");
    const pluralBases = new Set(entries.map(([k]) => k).filter((k) => k.includes("#")).map((k) => k.split("#")[0]));
    for (const base of pluralBases) expect(en).toHaveProperty(`${base}#other`);
  });
});
