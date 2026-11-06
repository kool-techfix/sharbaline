import "server-only";
import { readFileSync } from "node:fs";
import path from "node:path";

let cached: ReadonlySet<string> | undefined;

/**
 * Bundled, offline list of common passwords (10+ characters; see data/COMMON-PASSWORDS-LICENSE.txt).
 * Loaded once per process. next.config.ts includes the file in the server build.
 */
export function commonPasswords(): ReadonlySet<string> {
  if (!cached) {
    const file = path.join(process.cwd(), "src/server/auth/data/common-passwords.txt");
    cached = new Set(readFileSync(file, "utf8").split("\n").filter(Boolean));
  }
  return cached;
}
