import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { E2E_PASSWORD, E2E_USERS } from "./fixtures";

/*
 * Front desk (scope §5 M2): find, register (with the duplicate check), view, edit, queue.
 * Tests run in parallel against one database, so every patient gets a made-up name that no
 * other test uses. All data is synthetic.
 */

const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

async function signIn(page: Page, staffId: string) {
  await page.goto("/login");
  await page.getByLabel("Staff ID or email").fill(staffId);
  await page.getByLabel("Password", { exact: true }).fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
}

async function expectNoAxeViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
}

/** A pronounceable made-up name, different on every run (no shared trigrams with other tests). */
function madeUpName(): string {
  const consonants = "bdfgklmnprstvz";
  const vowels = "aeiou";
  let name = "";
  for (let i = 0; i < 4; i++) {
    name += consonants[Math.floor(Math.random() * consonants.length)]! + vowels[Math.floor(Math.random() * vowels.length)]!;
  }
  return name[0]!.toUpperCase() + name.slice(1);
}

interface NewPatient {
  surname: string;
  firstName: string;
  dob: string;
  phone?: string;
}

async function fillRegistration(page: Page, patient: NewPatient) {
  await page.getByLabel("Surname").fill(patient.surname);
  await page.getByLabel("First name").fill(patient.firstName);
  await page.getByRole("radio", { name: "Female" }).check();
  await page.getByLabel("Date of birth").fill(patient.dob);
  if (patient.phone) await page.getByLabel(/^Phone number/).fill(patient.phone);
  await page.getByLabel("Next of kin name").fill("Synthetic Kin");
  await page.getByLabel("Relationship to patient").fill("sister");
  await page.getByRole("checkbox", { name: /they agree/ }).check();
}

/** Registers through the form and returns the new patient number. */
async function register(page: Page, patient: NewPatient): Promise<string> {
  await page.goto("/front-desk/patients/new");
  await fillRegistration(page, patient);
  await page.getByRole("button", { name: "Register patient" }).click();
  await expect(page).toHaveURL(new RegExp(`/front-desk/patients/${UUID}\\?registered=1$`));
  const number = await page.getByText(/^HSP-\d+$/).textContent();
  return number!;
}

test.describe("front desk", () => {
  test("register a patient, add them to today's queue, then mark them as left", async ({ page }) => {
    test.setTimeout(90_000);
    const patient = { surname: madeUpName(), firstName: madeUpName(), dob: "1991-03-14", phone: "0803 000 1234" };
    await signIn(page, E2E_USERS.frontDeskRegister.staffId);
    await expect(page).toHaveURL(/\/front-desk$/, { timeout: 15_000 });
    const nav = page.getByRole("navigation", { name: "Main navigation" });
    await expect(nav.getByRole("link", { name: "Patients" })).toHaveAttribute("aria-current", "page");
    await expectNoAxeViolations(page);

    await page.getByRole("link", { name: "Register new patient" }).click();
    await expect(page.getByRole("heading", { name: "Register a new patient", level: 1 })).toBeVisible();
    await fillRegistration(page, patient);
    await expectNoAxeViolations(page);
    await page.getByRole("button", { name: "Register patient" }).click();

    await expect(page).toHaveURL(new RegExp(`/front-desk/patients/${UUID}\\?registered=1$`));
    await expect(page.getByText("Patient registered", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(`${patient.surname}, ${patient.firstName}`);
    await expect(page.getByText(/^HSP-\d+$/)).toBeVisible();
    await expect(page.getByText("0803 000 1234")).toBeVisible();
    await expect(page.getByText("Synthetic Kin · sister")).toBeVisible();
    await expectNoAxeViolations(page);

    await page.getByRole("button", { name: "Add to today's queue" }).click();
    await expect(page.getByText(/^Number \d+ in today's queue$/)).toBeVisible();
    await expect(page.getByText("Waiting", { exact: true })).toBeVisible();

    await nav.getByRole("link", { name: "Today's queue" }).click();
    await expect(page.getByRole("heading", { name: "Today's queue", level: 1 })).toBeVisible();
    const name = `${patient.surname}, ${patient.firstName}`;
    const row = page.getByRole("row").filter({ hasText: name });
    await expect(row.getByText("Waiting")).toBeVisible();
    await expectNoAxeViolations(page);

    await row.getByRole("button", { name: `Left without being seen: ${name}` }).click();
    await row.getByRole("button", { name: `Yes, mark as left: ${name}` }).click();
    await expect(row.getByText("Left", { exact: true })).toBeVisible();
    await expect(row.getByRole("button")).toHaveCount(0);
  });

  test("a likely duplicate is shown before registering, and going ahead needs confirmation", async ({ page }) => {
    test.setTimeout(90_000);
    const patient = { surname: madeUpName(), firstName: madeUpName(), dob: "1984-11-02" };
    await signIn(page, E2E_USERS.frontDeskDuplicate.staffId);
    await expect(page).toHaveURL(/\/front-desk$/, { timeout: 15_000 });
    const first = await register(page, patient);

    await page.goto("/front-desk/patients/new");
    await fillRegistration(page, patient);
    await page.getByRole("button", { name: "Register patient" }).click();

    const warning = page.getByRole("heading", { name: "This patient may already be registered" });
    await expect(warning).toBeFocused();
    await expect(page.getByText(first)).toBeVisible();
    await expect(page.getByRole("link", { name: `Open record: ${patient.surname}, ${patient.firstName}` })).toBeVisible();
    await expectNoAxeViolations(page);

    const goAhead = page.getByRole("button", { name: "Register as a new patient" });
    await expect(goAhead).toBeDisabled();
    await page.getByRole("checkbox", { name: /not any of the people above/ }).check();
    await goAhead.click();

    await expect(page).toHaveURL(new RegExp(`/front-desk/patients/${UUID}\\?registered=1$`));
    await expect(page.getByText(`Registered as a different person from ${first}`)).toBeVisible();
    await expect(page.getByText(/^HSP-\d+$/)).not.toHaveText(first);
  });

  test("search by number, name and a mistyped number; errors are shown per field; edit a record", async ({ page }) => {
    test.setTimeout(90_000);
    const patient = { surname: madeUpName(), firstName: madeUpName(), dob: "1975-07-21" };
    await signIn(page, E2E_USERS.frontDeskSearch.staffId);
    await expect(page).toHaveURL(/\/front-desk$/, { timeout: 15_000 });

    // An empty form: every required field explains itself, and focus goes to the first one.
    await page.goto("/front-desk/patients/new");
    await page.getByRole("button", { name: "Register patient" }).click();
    await expect(page.getByText("Enter the surname.")).toBeVisible();
    await expect(page.getByText("Choose female or male.")).toBeVisible();
    await expect(page.getByLabel("Surname")).toBeFocused();
    await expect(page.getByLabel("Surname")).toHaveAttribute("aria-invalid", "true");
    await expectNoAxeViolations(page);

    const number = await register(page, patient);
    const name = `${patient.surname}, ${patient.firstName}`;

    // Search never puts the query in the URL (rule 2).
    await page.goto("/front-desk");
    const box = page.getByRole("searchbox", { name: "Find a patient" });
    await box.fill(number);
    await box.press("Enter");
    await expect(page.getByText("1 patient found")).toBeVisible();
    await expect(page.getByRole("link", { name })).toBeVisible();
    await expect(page).toHaveURL(/\/front-desk$/);
    await expectNoAxeViolations(page);

    await box.fill(patient.surname.toLowerCase());
    await box.press("Enter");
    await expect(page.getByRole("link", { name })).toBeVisible();

    const lastDigit = Number(number.at(-1));
    await box.fill(`${number.slice(0, -1)}${(lastDigit + 1) % 10}`);
    await box.press("Enter");
    await expect(page.getByText(/patient number isn't valid/)).toBeVisible();

    // Edit: add a phone number.
    await box.fill(number);
    await box.press("Enter");
    await page.getByRole("link", { name }).click();
    await page.getByRole("link", { name: "Edit details" }).click();
    await expect(page.getByRole("heading", { name: "Edit patient details", level: 1 })).toBeVisible();
    await page.getByLabel(/^Phone number/).fill("08030009876");
    await expectNoAxeViolations(page);
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Changes saved.")).toBeVisible();
    await expect(page.getByText("0803 000 9876")).toBeVisible();
  });

  test("other roles can't open the front desk screens", async ({ page }) => {
    await signIn(page, E2E_USERS.labNoDesk.staffId);
    await expect(page).toHaveURL(/\/lab$/, { timeout: 15_000 });
    for (const path of ["/front-desk", "/front-desk/patients/new", "/front-desk/queue"]) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/lab$/);
    }
  });
});
