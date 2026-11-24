import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/** Records every request that leaves our own origin. The app must work with no internet. */
function trackExternalRequests(page: Page, baseURL: string): string[] {
  const origin = new URL(baseURL).origin;
  const external: string[] = [];
  page.on("request", (request) => {
    const url = request.url();
    if (url.startsWith("data:") || url.startsWith("blob:")) return;
    if (new URL(url).origin !== origin) external.push(url);
  });
  return external;
}

test.describe("foundation", () => {
  test("home page loads entirely from the local server", async ({ page, baseURL }) => {
    const external = trackExternalRequests(page, baseURL!);
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await page.waitForLoadState("networkidle");
    expect(external).toEqual([]);
  });

  test("responses carry the security headers", async ({ request }) => {
    const response = await request.get("/");
    const headers = response.headers();
    expect(headers["content-security-policy"]).toContain("default-src 'self'");
    expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["referrer-policy"]).toBe("no-referrer");
    expect(headers["x-powered-by"]).toBeUndefined();
  });

  test("self-hosted Inter font is used", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => document.fonts.ready);
    const loaded = await page.evaluate(() =>
      [...document.fonts].some((f) => f.family.replace(/"/g, "") === "Inter" && f.status === "loaded"),
    );
    expect(loaded).toBe(true);
  });

  for (const path of ["/", "/dev/components"]) {
    test(`${path} has no WCAG 2.1 AA violations`, async ({ page }) => {
      await page.goto(path);
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze();
      expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
    });
  }

  test("buttons are keyboard reachable, show focus, and are at least 44px tall", async ({ page }) => {
    await page.goto("/dev/components");
    await page.keyboard.press("Tab");
    const focused = page.locator(":focus");
    await expect(focused).toHaveRole("button");
    const outline = await focused.evaluate((el) => getComputedStyle(el).outlineStyle);
    expect(outline).not.toBe("none");

    for (const button of await page.getByRole("button").all()) {
      const box = await button.boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
  });

  test("connection chips show text for every state, not just colour", async ({ page }) => {
    await page.goto("/dev/components");
    for (const label of ["Online", "Working offline", "Server unreachable", "Syncing 3 changes"]) {
      await expect(page.getByRole("status").filter({ hasText: label })).toBeVisible();
    }
  });
});
