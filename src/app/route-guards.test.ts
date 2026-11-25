import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/*
 * Static check for D-025: Next.js layouts don't re-run between pages, so every staff page must
 * check the session itself, and every API route must either check it or be listed as public.
 */

const APP = import.meta.dirname;

function files(dir: string, name: RegExp): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return files(full, name);
    return name.test(entry.name) ? [full] : [];
  });
}

const rel = (file: string) => path.relative(APP, file);
const GUARD = /\brequireRole\(|\brequireSignedIn\(|<RolePlaceholder\b/;

/** Routes that need no session, with why. */
const PUBLIC_ROUTES: Record<string, string> = {
  "api/health/route.ts": "connection state for the sign-in screen (D-024)",
  "api/ping/route.ts": "internet probe target in e2e; returns nothing",
};

describe("route guards (D-025)", () => {
  const pages = files(path.join(APP, "(staff)"), /^page\.tsx$/);

  it("finds the staff pages", () => {
    expect(pages.length).toBeGreaterThanOrEqual(7);
  });

  it.each(pages.map(rel))("%s checks the session itself", (file) => {
    expect(readFileSync(path.join(APP, file), "utf8")).toMatch(GUARD);
  });

  it("every API route checks the session or is listed as public", () => {
    for (const file of files(path.join(APP, "api"), /^route\.ts$/).map(rel)) {
      if (file in PUBLIC_ROUTES) continue;
      expect(readFileSync(path.join(APP, file), "utf8"), file).toMatch(/\bcurrentSession\(|\brequireSignedIn\(|\brequireRole\(/);
    }
  });
});
