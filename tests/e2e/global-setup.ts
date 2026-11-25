import { chromium, type FullConfig } from "@playwright/test";
import { E2E_PASSWORD, E2E_USERS } from "./fixtures";

/**
 * Warm the server up with one real sign-in before the tests start. The webServer check only
 * proves the server answers; the first sign-in also loads password hashing, the server
 * actions and the database pool, which on a slow machine can take longer than an assertion.
 */
export default async function globalSetup(config: FullConfig) {
  const baseURL = String(config.projects[0]?.use.baseURL);
  const channel = process.env.PLAYWRIGHT_CHANNEL;
  const browser = await chromium.launch(channel ? { channel } : {});
  try {
    const page = await browser.newPage({ baseURL });
    await page.goto("/login");
    await page.getByLabel("Staff ID or email").fill(E2E_USERS.warmup.staffId);
    await page.getByLabel("Password", { exact: true }).fill(E2E_PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL(/\/front-desk$/, { timeout: 60_000 });
    for (const path of ["/account", "/locked"]) await page.goto(path);
  } finally {
    await browser.close();
  }
}
