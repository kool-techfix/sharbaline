import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { E2E_PASSWORD, E2E_USERS } from "./fixtures";

async function signIn(page: Page, staffId: string) {
  await page.goto("/login");
  await page.getByLabel("Staff ID or email").fill(staffId);
  await page.getByLabel("Password", { exact: true }).fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
}

test.describe("role navigation and switching (D-026)", () => {
  test("a multi-role user switches role with the keyboard, and pages follow the active role", async ({ page }) => {
    const user = E2E_USERS.nurseAndLab;
    await signIn(page, user.staffId);
    await expect(page).toHaveURL(/\/nurse$/, { timeout: 15_000 });

    const nav = page.getByRole("navigation", { name: "Main navigation" });
    await expect(nav.getByRole("link", { name: "Home" })).toHaveAttribute("aria-current", "page");
    await expect(page.getByText("Working as Nurse")).toBeVisible();
    expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual(
      [],
    );

    const switchButton = page.getByRole("button", { name: "Switch to Lab" });
    await switchButton.focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/lab$/);
    await expect(page.getByText("Working as Lab")).toBeVisible();

    // The old role's page now sends the user to the active role's home (server-side check).
    await page.goto("/nurse");
    await expect(page).toHaveURL(/\/lab$/);

    await page.getByRole("button", { name: "Switch to Nurse" }).click();
    await expect(page).toHaveURL(/\/nurse$/);
  });

  test("a single-role user sees no role switcher", async ({ page }) => {
    await signIn(page, E2E_USERS.frontDesk.staffId);
    await expect(page).toHaveURL(/\/front-desk$/, { timeout: 15_000 });
    await expect(page.getByRole("navigation", { name: "Main navigation" })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Switch to/ })).toHaveCount(0);
  });
});
