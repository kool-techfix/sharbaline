import "server-only";
import { z } from "zod";

/**
 * Server environment, validated once. Read through serverEnv(), never process.env directly,
 * so a missing or malformed variable fails loudly at first use instead of deep in a request.
 * Error messages name the variables but never echo their values (they may be secrets).
 */

/** A base64 secret that decodes to at least `minBytes` bytes. */
const base64Key = (minBytes: number, exactBytes?: number) =>
  z
    .string()
    .trim()
    .refine((value) => {
      const bytes = Buffer.from(value, "base64");
      return exactBytes ? bytes.length === exactBytes : bytes.length >= minBytes;
    });

const booleanFlag = z
  .enum(["true", "false"])
  .default("false")
  .transform((v) => v === "true");

const schema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
    APP_ORIGIN: z.url({ protocol: /^https?$/ }),
    HOSPITAL_NAME: z.string().trim().min(1).max(120),

    /** HMAC key for throttle keys and recovery codes. Generate: openssl rand -base64 32 */
    AUTH_HMAC_KEY: base64Key(32),
    /** AES-256-GCM key for TOTP secrets: exactly 32 bytes. Generate: openssl rand -base64 32 */
    MFA_ENCRYPTION_KEY: base64Key(32, 32),
    MFA_ENCRYPTION_KEY_VERSION: z.coerce.number().int().min(1).default(1),
    /** Name shown in authenticator apps. Defaults to "HMS · <hospital name>". */
    TOTP_ISSUER: z.string().trim().min(1).max(60).optional(),

    /**
     * Trust X-Forwarded-For from the reverse proxy for the client IP. Only enable when the app
     * port is reachable solely through the proxy (Docker network); otherwise clients could spoof it.
     */
    TRUST_PROXY_HEADERS: booleanFlag,
    /** Something on the internet the server can reach when internet is up (e.g. the backup target). */
    INTERNET_PROBE_URL: z.url({ protocol: /^https?$/ }).optional(),

    /**
     * Shortens the 10-minute idle lock (e2e tests). Can only make it SHORTER, so it can never
     * weaken security even if set by mistake in production.
     */
    SESSION_IDLE_SECONDS_OVERRIDE: z.coerce.number().int().min(5).max(599).optional(),
  })
  // Production must use TLS on the LAN (scope §8). Loopback is exempt: browsers treat it as a
  // secure context, and production builds run there for e2e tests.
  .refine((env) => env.NODE_ENV !== "production" || isSecureOrigin(env.APP_ORIGIN), {
    path: ["APP_ORIGIN"],
    message: "must be https in production (http allowed only for localhost)",
  })
  // Without a probe the server cannot tell "Online" from "Working offline" (scope §7.1).
  .refine((env) => env.NODE_ENV !== "production" || env.INTERNET_PROBE_URL !== undefined, {
    path: ["INTERNET_PROBE_URL"],
    message: "is required in production",
  });

function isSecureOrigin(origin: string): boolean {
  const url = new URL(origin);
  return url.protocol === "https:" || ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
}

export type ServerEnv = z.infer<typeof schema>;

export function parseServerEnv(source: Record<string, string | undefined>): ServerEnv {
  const result = schema.safeParse(source);
  if (!result.success) {
    const names = [...new Set(result.error.issues.map((issue) => String(issue.path[0])))];
    throw new Error(`Invalid or missing environment variables: ${names.join(", ")}`);
  }
  return result.data;
}

let cached: ServerEnv | undefined;

export function serverEnv(): ServerEnv {
  cached ??= parseServerEnv(process.env);
  return cached;
}
