import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 3100);
const baseURL = `http://localhost:${PORT}`;

/*
 * E2E runs against a production build (`next build && next start`), the way the hospital
 * runs it. Viewport is the primary target, a 1366×768 laptop.
 * PLAYWRIGHT_CHANNEL=chrome uses the installed Google Chrome instead of Playwright's
 * Chromium (needed on macOS 12, which current Playwright Chromium no longer supports).
 */
export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  // Signs in once before any test, so the cold start (password hashing, server actions,
  // database pool) isn't charged to whichever test happens to run first.
  globalSetup: "./tests/e2e/global-setup.ts",
  // A production build on a modest hospital laptop, with several workers signing in at once
  // (each sign-in is a deliberately slow Argon2 check): 10 s per assertion, 60 s per test.
  // Only the waiting changes; every assertion stays the same.
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "laptop-1366",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1366, height: 768 },
        ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}),
      },
    },
  ],
  // Builds, then starts a throwaway database + seeded synthetic accounts + `next start`
  // (scripts/e2e/server.ts). Never reuses a dev server: e2e needs its own accounts and keys.
  webServer: {
    command: `pnpm build && tsx --conditions=react-server scripts/e2e/server.ts`,
    url: `${baseURL}/api/ping`,
    reuseExistingServer: false,
    timeout: 300_000,
    env: { E2E_PORT: String(PORT), NEXT_TELEMETRY_DISABLED: "1" },
  },
});
