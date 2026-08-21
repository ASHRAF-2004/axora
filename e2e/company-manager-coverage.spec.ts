import { expect, test } from "@playwright/test";
import sharp from "sharp";
import {
  signInAsDemoOwner,
  signInAsDemoRole,
  type DemoRoleSession,
} from "./helpers/auth";

const demoCam = {
  id: "20222222-2222-4222-8222-222222222222",
  email: "agent.fixture@axora.invalid",
  name: "Agent fixture",
  role: "CLIENT_ACCOUNT_MANAGER",
  accountKind: "PLATFORM",
  scopeType: "PLATFORM",
} satisfies DemoRoleSession;

async function validCompanyLogo() {
  return sharp({
    create: {
      width: 128,
      height: 128,
      channels: 4,
      background: { r: 11, g: 45, b: 82, alpha: 1 },
    },
  }).png().toBuffer();
}

test("company manager coverage remains usable on mobile with reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 390, height: 844 });
  await signInAsDemoOwner(page);
  await page.goto("/companies/co-youruni");

  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.getByRole("link", { name: "Manager coverage and handover" }).click();
  await expect(page).toHaveURL(/\/companies\/co-youruni\/assignment$/);
  const coverage = page.getByText("Manager coverage and handover", { exact: true }).first();
  await expect(coverage).toBeVisible();
  await expect(page.getByText("Coverage gap requires owner action", { exact: true }).first())
    .toBeVisible();
  expect(await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )).toBeLessThanOrEqual(2);
});

test("direct company creation and lead creation are distinct responsive forms", async ({ page }) => {
  await signInAsDemoOwner(page);
  await page.goto("/companies/new");

  const form = page.locator("form").filter({ has: page.getByLabel("Display name") });
  await expect(form).toBeVisible();
  for (const field of [
    "commandId",
    "name",
    "legalName",
    "industry",
    "companyInformation",
    "websiteUrl",
    "logo",
    "mainContactName",
    "billingCycle",
    "notes",
  ]) {
    await expect(form.locator(`[name="${field}"]`)).toHaveCount(1);
  }
  for (const removedField of [
    "registrationNumber",
    "businessEmail",
    "countryCode",
    "phone",
    "phoneNumber",
    "region",
    "country",
    "preferredContactTime",
    "mainContactEmail",
    "mainContactPhone",
    "billingContactName",
    "billingContactEmail",
    "billingContactPhone",
    "billingAddress",
  ]) {
    await expect(form.locator(`[name="${removedField}"]`)).toHaveCount(0);
  }
  await expect(form.getByRole("button", { name: "Create company" })).toBeVisible();

  await page.goto("/companies/leads/new");
  const leadForm = page.locator("form").filter({ has: page.getByLabel("Trading or display name") });
  await expect(leadForm).toBeVisible();
  for (const field of [
    "commandId", "companyName", "legalName", "contactName", "city",
    "industry", "employeeRange", "branchRange", "spendRange", "timezone",
    "subject", "locale", "message",
  ]) {
    await expect(leadForm.locator(`[name="${field}"]`)).toHaveCount(1);
  }
  for (const removedField of [
    "registrationNumber", "businessEmail", "contactEmail", "countryCode",
    "phone", "phoneNumber", "region", "country", "preferredContactTime",
  ]) {
    await expect(leadForm.locator(`[name="${removedField}"]`)).toHaveCount(0);
  }
  await expect(leadForm.getByRole("button", { name: "Create lead" })).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(leadForm).toBeVisible();
  expect(await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )).toBeLessThanOrEqual(2);
});

test("an Owner-created company remains hidden until explicit CAM handover", async ({ page }) => {
  await signInAsDemoOwner(page);
  await page.goto("/companies/new");
  const companyName = `Prompt 7 E2E company ${Date.now()}`;
  const form = page.locator("form").filter({ has: page.getByLabel("Display name") });
  await form.getByLabel("Display name").fill(companyName);
  await form.getByLabel("Legal company name").fill(`${companyName} Sdn Bhd`);
  await form.getByLabel("Industry").fill("Business services");
  await form.getByLabel("Company information").fill("Controlled demo company for CAM isolation acceptance.");
  await form.getByLabel("Main contact name").fill("Company coordinator");
  await form.locator('input[name="logo"]').setInputFiles({
    name: "prompt-7-company-logo.png",
    mimeType: "image/png",
    buffer: await validCompanyLogo(),
  });
  await form.getByRole("button", { name: "Create company" }).click();
  await expect(page).toHaveURL(/\/companies\?.*notice=company-created/);
  const companyId = new URL(page.url()).searchParams.get("created");
  expect(companyId).toMatch(/^[0-9a-f-]{36}$/);

  await page.context().clearCookies();
  await signInAsDemoRole(page, demoCam);
  await page.goto(`/companies/${companyId}`);
  await expect(page.getByRole("heading", { name: "This page could not be found." }))
    .toBeVisible();
  await expect(page.getByRole("heading", { name: companyName })).toHaveCount(0);

  await page.context().clearCookies();
  await signInAsDemoOwner(page);
  await page.goto(`/companies/${companyId}/assignment`);
  await page.getByText("Assign Client Account Manager", { exact: true }).click();
  await page.locator('select[name="managerUserId"]').selectOption(demoCam.id);
  await page.locator('textarea[name="reason"]').fill("Explicit accountable CAM handover for the controlled demo company");
  await page.getByRole("button", { name: "Save assignment" }).click();
  await expect(page).toHaveURL(new RegExp(`/companies/${companyId}/assignment\\?notice=company-assigned`));

  await page.context().clearCookies();
  await signInAsDemoRole(page, demoCam);
  await page.goto(`/companies/${companyId}`);
  await expect(page.getByRole("heading", { level: 1, name: companyName })).toBeVisible();
  await expect(page.getByRole("link", { name: "Manager coverage and handover" })).toHaveCount(0);
});

test("Owner lead creation persists in demo and conflicting command reuse stays local", async ({ page }) => {
  await signInAsDemoOwner(page);
  await page.goto("/companies/leads/new");
  const companyName = `Prompt 7 lead ${Date.now()}`;
  const commandId = await page.locator('input[name="commandId"]').inputValue();
  const fillLead = async (name: string) => {
    await page.getByLabel("Trading or display name").fill(name);
    await page.getByLabel("Legal company name").fill(`${name} Sdn Bhd`);
    await page.getByLabel("Contact person's full name").fill("Reviewed enquiry contact");
    await page.getByLabel("City").fill("Kuala Lumpur");
    await page.getByLabel("Industry").fill("Business services");
    await page.getByLabel("Estimated employees").selectOption("11_50");
    await page.getByLabel("Number of branches").selectOption("2_5");
    await page.getByLabel("Estimated monthly purchasing").selectOption("50K_250K");
    await page.getByLabel("Enquiry subject").fill("Reviewed procurement opportunity");
    await page.getByLabel("How can Axora support your procurement operation?")
      .fill("Create a private follow-up lead after reviewing the public enquiry.");
  };
  await fillLead(companyName);
  await Promise.all([
    page.waitForURL(/\/companies\/leads\?notice=lead-created/, { timeout: 15_000 }),
    page.getByRole("button", { name: "Create lead" }).click(),
  ]);
  await expect(page.getByRole("heading", { level: 2, name: companyName })).toBeVisible();

  let leadCard = page.locator("article.panel").filter({
    has: page.getByRole("heading", { level: 2, name: companyName }),
  });
  await leadCard.locator("summary").filter({ hasText: /^Assign$/ }).click();
  const assignmentForm = leadCard.locator('select[name="managerUserId"]')
    .locator("xpath=ancestor::form");
  await assignmentForm.locator('select[name="managerUserId"]').selectOption(demoCam.id);
  await assignmentForm.getByLabel("Reason")
    .fill("Owner assigned the reviewed lead for accountable follow-up");
  await assignmentForm.getByRole("button", { name: "Assign", exact: true }).click();
  await expect(page).toHaveURL(/notice=lead-assigned/);

  await page.context().clearCookies();
  await signInAsDemoRole(page,demoCam);
  await page.goto("/companies/leads");
  await expect(page.getByRole("heading", { level: 2, name: companyName })).toBeVisible();
  await expect(page.getByText("Owner assigned the reviewed lead", { exact: false }))
    .toHaveCount(0);

  await page.context().clearCookies();
  await signInAsDemoOwner(page);
  await page.goto("/companies/leads");
  leadCard = page.locator("article.panel").filter({
    has: page.getByRole("heading", { level: 2, name: companyName }),
  });
  await leadCard.locator("summary").filter({ hasText: /^Original submission$/ })
    .click();
  await leadCard.getByText("Mark contacted", { exact: true }).click();
  await leadCard.locator('form input[name="status"][value="CONTACTED"]')
    .locator("xpath=..")
    .getByLabel("Reason")
    .fill("Owner confirmed the initial company contact");
  await leadCard.locator('form input[name="status"][value="CONTACTED"]')
    .locator("xpath=..")
    .getByRole("button", { name: "Apply action" }).click();
  await expect(page).toHaveURL(/notice=lead-status-updated/);

  leadCard = page.locator("article.panel").filter({
    has: page.getByRole("heading", { level: 2, name: companyName }),
  });
  await leadCard.getByText("Qualify", { exact: true }).click();
  await leadCard.locator('form input[name="status"][value="QUALIFIED"]')
    .locator("xpath=..")
    .getByLabel("Reason")
    .fill("Owner completed the qualification review");
  await leadCard.locator('form input[name="status"][value="QUALIFIED"]')
    .locator("xpath=..")
    .getByRole("button", { name: "Apply action" }).click();
  await expect(page).toHaveURL(/notice=lead-status-updated/);

  leadCard = page.locator("article.panel").filter({
    has: page.getByRole("heading", { level: 2, name: companyName }),
  });
  await leadCard.locator("summary")
    .filter({ hasText: /^Convert to onboarding company$/ }).click();
  const conversionForm = leadCard
    .getByRole("button", { name: "Convert to onboarding company" })
    .locator("xpath=ancestor::form");
  await conversionForm.getByLabel("Reason")
    .fill("Owner approved conversion into canonical company onboarding");
  await conversionForm.getByRole("button", { name: "Convert to onboarding company" })
    .click();
  await expect(page).toHaveURL(/notice=lead-converted/);
  await expect(leadCard.locator(".status-badge")
    .filter({ hasText: /^Onboarding$/ })).toBeVisible();

  await page.goto("/companies/leads/new");
  await fillLead(`${companyName} conflict`);
  await page.locator('input[name="commandId"]').evaluate((element, value) => {
    (element as HTMLInputElement).value = String(value);
  }, commandId);
  await page.getByRole("button", { name: "Create lead" }).click();
  await expect(page).toHaveURL(/\/companies\/leads\/new\?notice=lead-command-conflict$/);
  await expect(page.locator('section[role="alert"]')).toContainText(
    "This lead creation attempt was already used with different details.",
  );
});
