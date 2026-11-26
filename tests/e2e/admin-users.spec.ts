import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { Secret, TOTP } from "otpauth";
import { E2E_PASSWORD, E2E_TOTP_SECRET, E2E_USERS } from "./fixtures";

const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

const totp = (base32: string) =>
  new TOTP({ secret: Secret.fromBase32(base32.replace(/\s+/g, "")), digits: 6, period: 30, algorithm: "SHA1" }).generate();

async function signIn(page: Page, staffId: string, password = E2E_PASSWORD) {
  await page.goto("/login");
  await page.getByLabel("Staff ID or email").fill(staffId);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

async function expectNoAxeViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
}

test.describe("admin user management", () => {
  test("create an account, hand over the temporary password, change roles, switch it off and on", async ({ page }) => {
    test.setTimeout(90_000); // a long flow: sign-in with MFA, then a full account lifecycle
    await signIn(page, E2E_USERS.adminEnrolled.staffId);
    await page.getByLabel("Verification code").fill(totp(E2E_TOTP_SECRET));
    await expect(page).toHaveURL(/\/admin$/, { timeout: 15_000 });

    await page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Users" }).click();
    await expect(page.getByRole("heading", { name: "Users", level: 1 })).toBeVisible();
    await expect(page.getByRole("link", { name: "E2E Admin", exact: true })).toBeVisible();
    await expectNoAxeViolations(page);

    await page.getByRole("link", { name: "Add user" }).click();
    await page.getByLabel("Staff ID").fill("e2e.created");
    await page.getByLabel("Full name").fill("E2E Created Nurse");
    await page.getByRole("checkbox", { name: "Nurse" }).check();
    await expectNoAxeViolations(page);
    await page.getByRole("button", { name: "Create account" }).click();

    await expect(page.getByRole("heading", { name: "Account created" })).toBeFocused();
    const tempPassword = (await page.locator(".select-all").first().textContent())?.trim() ?? "";
    expect(tempPassword.length).toBeGreaterThanOrEqual(10);
    await page.getByRole("checkbox", { name: "I have handed this password over" }).check();
    await page.getByRole("button", { name: "Open the account" }).click();
    await expect(page.getByRole("heading", { name: "E2E Created Nurse", level: 1 })).toBeVisible();
    await expect(page.getByText("Temporary password", { exact: true })).toBeVisible();
    await expectNoAxeViolations(page);

    await page.getByRole("checkbox", { name: "Lab" }).check();
    await page.getByRole("button", { name: "Save roles" }).click();
    await expect(page.getByText("Roles saved.")).toBeVisible();

    await page.getByRole("button", { name: "Switch off account" }).click();
    await page.getByRole("button", { name: "Confirm: Switch off account" }).click();
    await expect(page.getByText("Account switched off.")).toBeVisible();
    await expect(page.getByText("Switched off", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Switch account back on" }).click();
    await page.getByRole("button", { name: "Confirm: Switch account back on" }).click();
    await expect(page.getByText("Account switched back on.")).toBeVisible();

    // The new account signs in with the temporary password and must choose its own.
    await page.context().clearCookies();
    await signIn(page, "e2e.created", tempPassword);
    await expect(page).toHaveURL(/\/change-password$/, { timeout: 15_000 });
  });

  test("other roles can't open the user pages", async ({ page }) => {
    await signIn(page, E2E_USERS.frontDesk.staffId);
    await expect(page).toHaveURL(/\/front-desk$/, { timeout: 15_000 });
    await expect(page.getByRole("link", { name: "Users" })).toHaveCount(0);
    for (const path of ["/admin/users", "/admin/users/new"]) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/front-desk$/);
    }
  });
});

test.describe("My account", () => {
  test("a nurse sets up an optional authenticator, then sign-in asks for a code", async ({ page }) => {
    await signIn(page, E2E_USERS.nurseMfaSetup.staffId);
    await expect(page).toHaveURL(/\/nurse$/, { timeout: 15_000 });
    await page.getByRole("link", { name: "My account" }).click();
    await expect(page.getByRole("heading", { name: "My account" })).toBeVisible();
    await expectNoAxeViolations(page);

    await page.getByRole("button", { name: "Set up authenticator" }).click();
    await page.getByLabel("Password", { exact: true }).fill(E2E_PASSWORD);
    await page.getByRole("button", { name: "Continue" }).click();

    await page.getByText("Can't scan? Type this key into the app instead").click();
    const manualKey = (await page.locator("details .select-all").textContent()) ?? "";
    await page.getByLabel("2. Enter the 6-digit code the app shows").fill(totp(manualKey));

    await expect(page.getByRole("heading", { name: "3. Save your recovery codes" })).toBeFocused();
    await page.getByRole("checkbox", { name: "I have saved these recovery codes" }).check();
    await page.getByRole("button", { name: "Done" }).click();
    await expect(page.getByText("Authenticator on")).toBeVisible();

    await page.getByRole("button", { name: "Sign out" }).click();
    await signIn(page, E2E_USERS.nurseMfaSetup.staffId);
    await expect(page.getByRole("heading", { name: "Verify it's you" })).toBeVisible();
  });
});
