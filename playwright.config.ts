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
  webServer: {
    command: `pnpm build && pnpm start -p ${PORT}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
    env: { HMS_COMPONENT_GALLERY: "true", NEXT_TELEMETRY_DISABLED: "1" },
  },
});
