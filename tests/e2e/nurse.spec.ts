import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { E2E_NURSE_PATIENT, E2E_PASSWORD, E2E_USERS } from "./fixtures";

/*
 * Nurse (scope §5 M3, D-037): start a visit from today's queue, record vitals (a typo is caught),
 * correct an entry without losing the original, record an allergy, send the patient to the
 * doctor. The patient is synthetic, seeded into today's queue by scripts/e2e/server.ts.
 */

const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const PATIENT_NAME = `${E2E_NURSE_PATIENT.surname}, ${E2E_NURSE_PATIENT.firstName}`;

async function expectNoAxeViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
}

test("a nurse takes a queued patient through vitals, a correction and an allergy, then sends them on", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/login");
  await page.getByLabel("Staff ID or email").fill(E2E_USERS.nurseVisits.staffId);
  await page.getByLabel("Password", { exact: true }).fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/nurse$/, { timeout: 15_000 });

  // Today's queue on the nurse home.
  await expect(page.getByRole("heading", { name: "Today's queue", level: 2 })).toBeVisible();
  const row = page.getByRole("row").filter({ hasText: PATIENT_NAME });
  await expect(row.getByText("Waiting", { exact: true })).toBeVisible();
  await expectNoAxeViolations(page);
  await row.getByRole("button", { name: `Start visit for ${PATIENT_NAME}` }).click();

  await expect(page).toHaveURL(new RegExp(`/nurse/patients/${UUID}$`));
  await expect(page.getByRole("heading", { name: PATIENT_NAME, level: 1 })).toBeVisible();
  await expect(page.getByText("With nurse", { exact: true })).toBeVisible();
  // Nothing recorded yet: the header says so instead of implying "no allergies".
  await expect(page.getByText("Allergies not recorded")).toBeVisible();
  await expectNoAxeViolations(page);

  // A typo is caught in the form, next to the box, and focus goes there.
  const temperature = page.getByLabel("Temperature (°C)");
  await temperature.fill("378");
  await page.getByLabel("Pulse (beats/min)").fill("88");
  await page.getByLabel("Upper number (systolic, mmHg)").fill("120");
  await page.getByRole("button", { name: "Save vitals" }).click();
  await expect(page.getByText("Enter a number from 30 to 45. Check for a typo.")).toBeVisible();
  await expect(page.getByText("Enter both blood pressure numbers, or neither.")).toBeVisible();
  await expect(temperature).toBeFocused();
  await expectNoAxeViolations(page);

  await temperature.fill("37.8");
  await page.getByLabel("Lower number (diastolic, mmHg)").fill("80");
  await page.getByRole("button", { name: "Save vitals" }).click();
  await expect(page.getByText("Vitals saved.")).toBeVisible();
  const vitals = page.getByRole("table", { name: "Vitals recorded on this visit, newest first" });
  await expect(vitals.getByText("37.8 °C")).toBeVisible();
  await expect(vitals.getByText("120/80 mmHg")).toBeVisible();
  await expect(temperature).toHaveValue("");

  // Correct the entry: the original stays, marked entered in error, beside the correction.
  await vitals.getByRole("link", { name: /^Correct the vitals recorded at / }).click();
  await expect(page).toHaveURL(new RegExp(`/nurse/patients/${UUID}\\?correct=${UUID}$`));
  await expect(page.getByRole("heading", { name: /^Correct the vitals recorded at / })).toBeFocused();
  await page.getByLabel("Some values are wrong: enter the right ones").check();
  await page.getByLabel("Reason", { exact: true }).fill("Temperature mistyped");
  await page.getByLabel("Temperature (°C)").fill("37.5");
  await page.getByRole("button", { name: "Save correction" }).click();
  await expect(page.getByText("Correction saved. The original is shown as entered in error.")).toBeVisible();
  await expect(vitals.getByText("37.5 °C")).toBeVisible();
  await expect(vitals.getByText("37.8 °C")).toBeVisible();
  await expect(vitals.getByText("Entered in error")).toBeVisible();
  await expect(vitals.getByText("Reason: Temperature mistyped")).toHaveCount(2);
  // Only the correction can be corrected now.
  await expect(vitals.getByRole("link", { name: /^Correct the vitals recorded at / })).toHaveCount(1);
  await expectNoAxeViolations(page);

  // Record an allergy: it shows as a chip in the header straight away.
  await page.getByRole("button", { name: "Add an allergy" }).click();
  await expect(page.getByLabel("Allergic to")).toBeFocused();
  await page.getByLabel("Allergic to").fill("Penicillin");
  await page.getByLabel("Reaction (optional)").fill("Rash");
  await page.getByLabel("Severe", { exact: true }).check();
  await page.getByRole("button", { name: "Save allergy" }).click();
  await expect(page.getByText("Allergy to Penicillin recorded.")).toBeVisible();
  await expect(page.getByRole("list", { name: "Allergies" }).getByText("Allergy: Penicillin (Severe)")).toBeVisible();
  await expect(page.getByRole("button", { name: "Record no known allergies" })).toHaveCount(0);

  // Hand over: the queue now shows the patient waiting for a doctor.
  await page.getByRole("button", { name: "Send to doctor" }).click();
  await expect(page.getByText("Sent. The patient is now waiting for a doctor.")).toBeVisible();
  await expect(page.getByText("The patient has already gone on to the doctor.")).toBeVisible();
  await expectNoAxeViolations(page);

  await page.getByRole("link", { name: "Back to today's queue" }).click();
  await expect(page.getByRole("row").filter({ hasText: PATIENT_NAME }).getByText("Waiting for doctor")).toBeVisible();
});

test("only nurses reach the nurse screens", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Staff ID or email").fill(E2E_USERS.frontDeskSearch.staffId);
  await page.getByLabel("Password", { exact: true }).fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/front-desk$/, { timeout: 15_000 });
  for (const path of ["/nurse", "/nurse/patients", "/nurse/patients/00000000-0000-7000-8000-000000000000"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/front-desk$/);
  }
});
