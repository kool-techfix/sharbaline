import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { Secret, TOTP } from "otpauth";
import { E2E_PASSWORD, E2E_PATIENT, E2E_TOTP_SECRET, E2E_USERS } from "./fixtures";

/*
 * Break-glass (D-028, D-035): an admin opens one patient's clinical record with a reason, and a
 * different admin reviews it. The patient is synthetic and seeded by scripts/e2e/server.ts.
 */

const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const PATIENT_NAME = `${E2E_PATIENT.surname}, ${E2E_PATIENT.firstName}`;

const totp = () =>
  new TOTP({ secret: Secret.fromBase32(E2E_TOTP_SECRET), digits: 6, period: 30, algorithm: "SHA1" }).generate();

async function signInAdmin(page: Page, staffId: string) {
  await page.goto("/login");
  await page.getByLabel("Staff ID or email").fill(staffId);
  await page.getByLabel("Password", { exact: true }).fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByLabel("Verification code").fill(totp());
  await expect(page).toHaveURL(/\/admin$/, { timeout: 15_000 });
}

async function expectNoAxeViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
}

test.describe("break-glass", () => {
  test("an admin opens a clinical record with a reason; a different admin reviews it", async ({ page, browser }) => {
    test.setTimeout(120_000); // two admins sign in with MFA
    await signInAdmin(page, E2E_USERS.adminBreakGlass.staffId);
    const nav = page.getByRole("navigation", { name: "Main navigation" });

    // Find the patient: demographics are readable, the clinical record is locked.
    await nav.getByRole("link", { name: "Patients" }).click();
    const box = page.getByRole("searchbox", { name: "Find a patient" });
    await box.fill(E2E_PATIENT.surname);
    await box.press("Enter");
    await page.getByRole("link", { name: PATIENT_NAME }).click();
    await expect(page.getByRole("heading", { name: PATIENT_NAME, level: 1 })).toBeVisible();
    await expect(page.getByText(/^Admins don't see clinical records/)).toBeVisible();
    await expectNoAxeViolations(page);

    // The reason form explains what's missing, next to each field.
    await page.getByRole("button", { name: "Open clinical record (break-glass)" }).click();
    await expect(page.getByRole("heading", { name: "Why do you need this patient's clinical record?" })).toBeFocused();
    await page.getByRole("button", { name: "Open clinical record", exact: true }).click();
    await expect(page.getByText("Choose a reason.")).toBeVisible();
    await page.getByRole("radio", { name: "Patient or family request" }).check();
    await page.getByLabel("Explain the reason").fill("too short");
    await page.getByRole("button", { name: "Open clinical record", exact: true }).click();
    await expect(page.getByText("Write at least 10 characters about why you need the record.")).toBeVisible();
    await expect(page.getByLabel("Explain the reason")).toBeFocused();
    await expectNoAxeViolations(page);

    await page.getByLabel("Explain the reason").fill("Synthetic: daughter asked for a copy of the referral");
    await page.getByRole("button", { name: "Open clinical record", exact: true }).click();
    await expect(page.getByText(/^Break-glass access is open until \d{2}:\d{2}\./)).toBeVisible();
    await expect(page.getByText(/^No clinical records yet/)).toBeVisible();
    await expectNoAxeViolations(page);

    // Their own access can't be reviewed by them.
    await nav.getByRole("link", { name: "Break-glass reviews" }).click();
    const mine = page.getByRole("article").filter({ hasText: PATIENT_NAME });
    await expect(mine.getByText("You opened this record, so a different admin must review it.")).toBeVisible();
    await expect(mine.getByText("Patient or family request")).toBeVisible();
    await expect(mine.getByRole("button", { name: "Save review" })).toHaveCount(0);
    await expectNoAxeViolations(page);

    // A second admin reviews it.
    const reviewerContext = await browser.newContext();
    const reviewer = await reviewerContext.newPage();
    await signInAdmin(reviewer, E2E_USERS.adminReviewer.staffId);
    await expect(reviewer.getByRole("heading", { name: /break-glass access(es)? awaiting review$/ })).toBeVisible();
    await expectNoAxeViolations(reviewer);
    await reviewer.getByRole("link", { name: "Open break-glass reviews" }).click();
    const card = reviewer.getByRole("article").filter({ hasText: PATIENT_NAME });
    await expect(card.getByRole("heading", { name: `E2E Admin Breaker opened ${PATIENT_NAME}`, exact: false })).toBeVisible();
    await expect(card.getByText("Synthetic: daughter asked for a copy of the referral")).toBeVisible();
    await card.getByRole("radio", { name: "Needs follow-up" }).check();
    await card.getByRole("button", { name: "Save review" }).click();
    await expect(card.getByText("Add a comment saying what was wrong or what needs following up.")).toBeVisible();
    await expectNoAxeViolations(reviewer);
    await card.getByLabel("Comment").fill("Confirm the request came from the next of kin");
    await card.getByRole("button", { name: "Save review" }).click();
    await expect(card).toHaveCount(0);

    await reviewer.getByRole("link", { name: "Reviewed" }).click();
    const reviewed = reviewer.getByRole("article").filter({ hasText: PATIENT_NAME });
    await expect(reviewed.getByText("Needs follow-up")).toBeVisible();
    await expect(reviewed.getByText(/^Reviewed by E2E Admin Reviewer/)).toBeVisible();
    await expectNoAxeViolations(reviewer);
    await reviewerContext.close();

    // The first admin ends their access early: the record locks again.
    await page.getByRole("link", { name: `Open patient: ${PATIENT_NAME}`, exact: false }).click();
    await page.getByRole("button", { name: "End access now" }).click();
    await expect(page.getByRole("button", { name: "Open clinical record (break-glass)" })).toBeVisible();
  });

  test("other roles can't open the admin patient or review screens", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Staff ID or email").fill(E2E_USERS.labNoDesk.staffId);
    await page.getByLabel("Password", { exact: true }).fill(E2E_PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/lab$/, { timeout: 15_000 });
    for (const path of ["/admin/patients", "/admin/break-glass"]) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/lab$/);
    }
  });
});
