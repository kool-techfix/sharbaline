import "server-only";
import { z } from "zod";

/**
 * Server environment, validated once. Read through serverEnv(), never process.env directly,
 * so a missing or malformed variable fails loudly at first use instead of deep in a request.
 * Error messages name the variables but never echo their values (they may be secrets).
 */
const schema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
    APP_ORIGIN: z.url({ protocol: /^https?$/ }),
    HOSPITAL_NAME: z.string().trim().min(1).max(120),
  })
  // Production must use TLS on the LAN (scope §8). Loopback is exempt: browsers treat it as a
  // secure context, and production builds run there for e2e tests.
  .refine((env) => env.NODE_ENV !== "production" || isSecureOrigin(env.APP_ORIGIN), {
    path: ["APP_ORIGIN"],
    message: "must be https in production (http allowed only for localhost)",
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
