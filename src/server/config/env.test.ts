import { describe, expect, it } from "vitest";
import { parseServerEnv } from "./env";

const valid = {
  NODE_ENV: "development",
  DATABASE_URL: "postgresql://hms_app:not-a-real-secret@localhost:54329/hms",
  APP_ORIGIN: "http://localhost:3000",
  HOSPITAL_NAME: "Demo Hospital",
};

describe("parseServerEnv", () => {
  it("accepts a complete development environment", () => {
    expect(parseServerEnv(valid).HOSPITAL_NAME).toBe("Demo Hospital");
  });

  it("names missing variables without echoing any values", () => {
    const attempt = () =>
      parseServerEnv({ ...valid, DATABASE_URL: "mysql://u:super-secret@x/y", HOSPITAL_NAME: undefined });
    expect(attempt).toThrow(/DATABASE_URL, HOSPITAL_NAME|HOSPITAL_NAME, DATABASE_URL/);
    expect(attempt).not.toThrow(/super-secret/);
  });

  it("requires https for APP_ORIGIN in production, except on localhost", () => {
    const lanHttp = { ...valid, NODE_ENV: "production", APP_ORIGIN: "http://192.168.1.10" };
    expect(() => parseServerEnv(lanHttp)).toThrow(/APP_ORIGIN/);
    expect(parseServerEnv({ ...valid, NODE_ENV: "production" }).APP_ORIGIN).toBe("http://localhost:3000");
    expect(
      parseServerEnv({ ...valid, NODE_ENV: "production", APP_ORIGIN: "https://hms.local" }).APP_ORIGIN,
    ).toBe("https://hms.local");
  });
});
