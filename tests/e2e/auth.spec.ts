import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { Secret, TOTP } from "otpauth";
import { E2E_IDLE_SECONDS, E2E_PASSWORD, E2E_RECOVERY_CODES, E2E_TOTP_SECRET, E2E_USERS } from "./fixtures";

const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

function totp(base32: string): string {
  return new TOTP({ secret: Secret.fromBase32(base32), digits: 6, period: 30, algorithm: "SHA1" }).generate();
}

async function enterCredentials(page: Page, staffId: string, password = E2E_PASSWORD) {
  await page.getByLabel("Staff ID or email").fill(staffId);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

async function expectNoAxeViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
}

test.describe("sign-in", () => {
  test("two-step sign-in: password, then authenticator code, lands on the role's page", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByText("Step 1 of 2")).toBeVisible();
    await expectNoAxeViolations(page);

    await enterCredentials(page, E2E_USERS.doctorEnrolled.staffId);

    // Focus moves to the new step's heading, so screen readers announce where the user is.
    await expect(page.getByRole("heading", { name: "Verify it's you" })).toBeFocused();
    await expectNoAxeViolations(page);

    // Paste-style entry with a space; the sixth digit submits automatically.
    const code = totp(E2E_TOTP_SECRET);
    await page.getByLabel("Verification code").fill(`${code.slice(0, 3)} ${code.slice(3)}`);

    await expect(page).toHaveURL(/\/doctor$/);
    await expect(page.getByRole("heading", { name: `Welcome, ${E2E_USERS.doctorEnrolled.displayName}` })).toBeVisible();
  });

  test("works with the keyboard alone", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByLabel("Staff ID or email")).toBeFocused();
    await page.keyboard.type(E2E_USERS.nurseKeyboard.staffId);
    await page.keyboard.press("Tab");
    await page.keyboard.type(E2E_PASSWORD);
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/nurse$/);
  });

  test("show/hide password toggle is a labelled 44px button", async ({ page }) => {
    await page.goto("/login");
    const password = page.getByLabel("Password", { exact: true });
    await password.fill("visible?");
    const toggle = page.getByRole("button", { name: "Show password" });
    expect((await toggle.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    await toggle.click();
    await expect(password).toHaveAttribute("type", "text");
    await expect(page.getByRole("button", { name: "Hide password" })).toHaveAttribute("aria-pressed", "true");
  });

  test("shows the lockout message, announced, after 5 wrong passwords", async ({ page }) => {
    await page.goto("/login");
    for (let i = 0; i < 5; i++) {
      await enterCredentials(page, E2E_USERS.nurseLockout.staffId, `wrong password ${i}`);
      // #signin-message: Next.js adds its own role="alert" route announcer to every page.
      await expect(page.locator("#signin-message")).toContainText(i < 4 ? "isn't right" : "Too many attempts");
    }
    // Even the right password is refused while locked, with the same message.
    await enterCredentials(page, E2E_USERS.nurseLockout.staffId);
    await expect(page.locator("#signin-message")).toContainText("Too many attempts");
    await expect(page).toHaveURL(/\/login/);
  });

  test("a recovery code works in place of the authenticator", async ({ page }) => {
    await page.goto("/login");
    await enterCredentials(page, E2E_USERS.doctorRecovery.staffId);
    await page.getByRole("button", { name: "Use a recovery code" }).click();
    await expect(page.getByRole("heading", { name: "Use a recovery code" })).toBeFocused();
    await page.getByLabel("Recovery code").fill(E2E_RECOVERY_CODES[0]!.toLowerCase());
    await page.getByRole("button", { name: "Use recovery code" }).click();
    // Only one code left: the user is warned before continuing.
    await expect(page.getByRole("status").filter({ hasText: "recovery code left" })).toBeVisible();
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page).toHaveURL(/\/doctor$/);
  });

  test("first sign-in for a required role enrols an authenticator and shows recovery codes once", async ({ page }) => {
    await page.goto("/login");
    await enterCredentials(page, E2E_USERS.pharmacistNew.staffId);
    await expect(page).toHaveURL(/\/mfa\/enroll$/);
    await expectNoAxeViolations(page);

    await page.getByRole("button", { name: "Show setup code" }).click();
    await expect(page.getByRole("img", { name: "QR code for setting up the authenticator app" })).toBeVisible();
    await page.getByText("Can't scan? Type this key into the app instead").click();
    const key = (await page.locator("details p").innerText()).replace(/\s/g, "");

    await page.getByLabel("2. Enter the 6-digit code the app shows").fill(totp(key));

    await expect(page.getByRole("heading", { name: "3. Save your recovery codes" })).toBeFocused();
    await expect(page.getByRole("list", { name: "3. Save your recovery codes" }).getByRole("listitem")).toHaveCount(8);
    const proceed = page.getByRole("button", { name: "Continue" });
    await expect(proceed).toBeDisabled();
    await page.getByLabel("I have saved these recovery codes").check();
    await proceed.click();
    await expect(page).toHaveURL(/\/pharmacy$/);
  });

  test("sign out returns to sign-in with a notice", async ({ page }) => {
    await page.goto("/login");
    await enterCredentials(page, E2E_USERS.frontDesk.staffId);
    await expect(page).toHaveURL(/\/front-desk$/);
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/login\?reason=signed_out$/);
    await expect(page.getByRole("status").filter({ hasText: "You've been signed out." })).toBeVisible();
    // The old session can't reach staff pages.
    await page.goto("/front-desk");
    await expect(page).toHaveURL(/\/login/);
  });

  test("staff pages are refused without a session, and to the wrong role", async ({ page }) => {
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/login/);
    await enterCredentials(page, E2E_USERS.frontDesk.staffId);
    await expect(page).toHaveURL(/\/front-desk$/);
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/front-desk$/);
  });
});

test.describe("idle lock", () => {
  test("locks after inactivity, hides the page, and unlocks with the password", async ({ page }) => {
    await page.goto("/login");
    await enterCredentials(page, E2E_USERS.nurseIdle.staffId);
    const welcome = page.getByRole("heading", { name: `Welcome, ${E2E_USERS.nurseIdle.displayName}` });
    await expect(welcome).toBeVisible();

    const lockHeading = page.getByRole("heading", { name: "Screen locked" });
    await expect(lockHeading).toBeVisible({ timeout: (E2E_IDLE_SECONDS + 5) * 1000 });
    await expect(lockHeading).toBeFocused();
    await expect(welcome).toHaveCount(0); // unmounted, not just covered
    await expectNoAxeViolations(page);

    // A reload while locked still shows only the lock screen (the server locked it too).
    await page.reload();
    await expect(page.getByRole("heading", { name: "Screen locked" })).toBeVisible();
    await expect(welcome).toHaveCount(0);

    await page.getByLabel("Password", { exact: true }).fill("not my password");
    await page.getByRole("button", { name: "Unlock" }).click();
    await expect(page.locator("#unlock-message")).toContainText("isn't right");

    await page.getByLabel("Password", { exact: true }).fill(E2E_PASSWORD);
    await page.getByRole("button", { name: "Unlock" }).click();
    await expect(welcome).toBeVisible();
  });
});

test.describe("connection states on the sign-in screen (scope §7.1, D-021)", () => {
  test("Working offline: internet down, server reachable — sign-in still works", async ({ page }) => {
    await page.route("**/api/health", (route) =>
      route.fulfill({ json: { server: "ok", internet: "down", internetCheckedAt: null } }),
    );
    await page.goto("/login");
    await expect(page.getByRole("status").filter({ hasText: "Working offline" })).toBeVisible();
    await expect(page.getByLabel("Staff ID or email")).toBeEnabled();
    await expect(page.getByRole("button", { name: "Sign in" })).toBeEnabled();
  });

  test("Server unreachable: explains that sign-in needs the server, with a retry", async ({ page }) => {
    await page.goto("/login");
    await page.route("**/api/health", (route) => route.abort("connectionrefused"));
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect(page.getByRole("heading", { name: "Server unreachable" })).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: "Server unreachable" })).toBeVisible();
    await expect(page.getByText("New sign-in needs a connection to the hospital server.")).toBeVisible();
    await expectNoAxeViolations(page);

    await page.unroute("**/api/health");
    await page.getByRole("button", { name: "Try connection again" }).click();
    await expect(page.getByLabel("Staff ID or email")).toBeVisible();
  });
});
