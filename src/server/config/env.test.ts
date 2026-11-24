import { describe, expect, it } from "vitest";
import { parseServerEnv } from "./env";

const valid = {
  NODE_ENV: "development",
  DATABASE_URL: "postgresql://hms_app:not-a-real-secret@localhost:54329/hms",
  APP_ORIGIN: "http://localhost:3000",
  HOSPITAL_NAME: "Demo Hospital",
  AUTH_HMAC_KEY: Buffer.alloc(32, 1).toString("base64"),
  MFA_ENCRYPTION_KEY: Buffer.alloc(32, 2).toString("base64"),
};
const production = { ...valid, NODE_ENV: "production", INTERNET_PROBE_URL: "https://example.org/" };

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
    expect(() => parseServerEnv({ ...production, APP_ORIGIN: "http://192.168.1.10" })).toThrow(/APP_ORIGIN/);
    expect(parseServerEnv(production).APP_ORIGIN).toBe("http://localhost:3000");
    expect(parseServerEnv({ ...production, APP_ORIGIN: "https://hms.local" }).APP_ORIGIN).toBe("https://hms.local");
  });

  it("requires an internet probe in production, so Working offline can be detected", () => {
    expect(() => parseServerEnv({ ...production, INTERNET_PROBE_URL: undefined })).toThrow(/INTERNET_PROBE_URL/);
  });

  it("requires a 32-byte MFA key and a 32+ byte HMAC key", () => {
    expect(() => parseServerEnv({ ...valid, MFA_ENCRYPTION_KEY: Buffer.alloc(16).toString("base64") })).toThrow(
      /MFA_ENCRYPTION_KEY/,
    );
    expect(() => parseServerEnv({ ...valid, AUTH_HMAC_KEY: "c2hvcnQ=" })).toThrow(/AUTH_HMAC_KEY/);
  });

  it("only lets the idle override shorten the timeout", () => {
    expect(() => parseServerEnv({ ...valid, SESSION_IDLE_SECONDS_OVERRIDE: "3600" })).toThrow(
      /SESSION_IDLE_SECONDS_OVERRIDE/,
    );
    expect(parseServerEnv({ ...valid, SESSION_IDLE_SECONDS_OVERRIDE: "8" }).SESSION_IDLE_SECONDS_OVERRIDE).toBe(8);
  });

  it("does not trust proxy headers unless told to", () => {
    expect(parseServerEnv(valid).TRUST_PROXY_HEADERS).toBe(false);
    expect(parseServerEnv({ ...valid, TRUST_PROXY_HEADERS: "true" }).TRUST_PROXY_HEADERS).toBe(true);
  });
});
