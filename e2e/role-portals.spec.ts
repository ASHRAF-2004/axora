import { expect, test } from "@playwright/test";
import { signInAsDemoRole, type DemoRoleSession } from "./helpers/auth";

const companyId = "11111111-1111-4111-8111-111111111111";

const principals = {
  supplier: {
    id: "22222222-2222-4222-8222-222222222222",
    email: "supplier.fixture@axora.invalid",
    name: "Supplier fixture",
    role: "SUPPLIER_USER",
    accountKind: "SUPPLIER",
    scopeType: "SUPPLIER",
    supplierId: "33333333-3333-4333-8333-333333333333",
  },
  driver: {
    id: "44444444-4444-4444-8444-444444444444",
    email: "driver.fixture@axora.invalid",
    name: "Driver fixture",
    role: "DELIVERY_DRIVER",
    accountKind: "DELIVERY",
    scopeType: "DELIVERY",
  },
  receiver: {
    id: "55555555-5555-4555-8555-555555555555",
    email: "receiver.fixture@axora.invalid",
    name: "Receiver fixture",
    role: "RECEIVING_USER",
    accountKind: "COMPANY",
    scopeType: "COMPANY",
    companyId,
  },
  companyAdmin: {
    id: "66666666-6666-4666-8666-666666666666",
    email: "company-admin.fixture@axora.invalid",
    name: "Company administrator fixture",
    role: "COMPANY_ADMIN",
    accountKind: "COMPANY",
    scopeType: "COMPANY",
    companyId,
  },
  branchAdmin: {
    id: "77777777-7777-4777-8777-777777777777",
    email: "branch-admin.fixture@axora.invalid",
    name: "Branch administrator fixture",
    role: "BRANCH_ADMIN",
    accountKind: "COMPANY",
    scopeType: "BRANCH",
    companyId,
    branchId: "88888888-8888-4888-8888-888888888888",
  },
  requester: {
    id: "99999999-9999-4999-8999-999999999999",
    email: "requester.fixture@axora.invalid",
    name: "Requester fixture",
    role: "REQUESTER",
    accountKind: "COMPANY",
    scopeType: "BRANCH",
    companyId,
    branchId: "88888888-8888-4888-8888-888888888888",
  },
  approver: {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    email: "approver.fixture@axora.invalid",
    name: "Approver fixture",
    role: "COMPANY_APPROVER",
    accountKind: "COMPANY",
    scopeType: "COMPANY",
    companyId,
  },
  finance: {
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    email: "finance.fixture@axora.invalid",
    name: "Finance fixture",
    role: "FINANCE_REVIEWER",
    accountKind: "COMPANY",
    scopeType: "COMPANY",
    companyId,
  },
  auditor: {
    id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    email: "auditor.fixture@axora.invalid",
    name: "Auditor fixture",
    role: "AUDITOR",
    accountKind: "COMPANY",
    scopeType: "COMPANY",
    companyId,
  },
  support: {
    id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    email: "support.fixture@axora.invalid",
    name: "Support fixture",
    role: "TECHNICAL_SUPPORT",
    accountKind: "PLATFORM",
    scopeType: "PLATFORM",
  },
  operations: {
    id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    email: "operations.fixture@axora.invalid",
    name: "Operations fixture",
    role: "PLATFORM_OPERATIONS",
    accountKind: "PLATFORM",
    scopeType: "PLATFORM",
  },
} satisfies Record<string, DemoRoleSession>;

async function expectOperationalShell(page: Parameters<typeof signInAsDemoRole>[0]) {
  await expect(page.getByRole("button", { name: "Open application menu" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Axora home/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /My profile:/ })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Language" })).toBeVisible();
  const tutorialLauncher = page.locator(".app-context-bar").getByRole("button", { name: "Open role tutorial" });
  await expect(tutorialLauncher).toBeVisible();
  const [launcherBox, contentBox] = await Promise.all([
    tutorialLauncher.boundingBox(),
    page.locator("main.app-content").boundingBox(),
  ]);
  expect(launcherBox).not.toBeNull();
  expect(contentBox).not.toBeNull();
  expect(launcherBox!.height).toBeGreaterThanOrEqual(44);
  expect(launcherBox!.y + launcherBox!.height).toBeLessThanOrEqual(contentBox!.y + 1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(2);
}

test("supplier receives only the dedicated RFQ workspace", async ({ page }) => {
  await signInAsDemoRole(page, principals.supplier);
  await page.goto("/supplier");

  await expect(page.getByRole("heading", { level: 1, name: "Supplier workspace" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "No quotation requests" })).toBeVisible();
  await expectOperationalShell(page);

  await page.goto("/driver");
  await expect(page).toHaveURL(/\/access-denied$/);
});

test("driver receives the mobile-safe assignment workspace only", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signInAsDemoRole(page, principals.driver);
  await page.goto("/driver");

  await expect(page.getByRole("heading", { level: 1, name: "Assigned deliveries" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "No active assignments" })).toBeVisible();
  await expectOperationalShell(page);
  const compactLanguage = page.locator(".app-language-control");
  await expect(compactLanguage.locator(".app-language-icon")).toBeVisible();
  await expect(compactLanguage.locator(".app-language-code")).toHaveText("EN");
  const languageBox = await compactLanguage.boundingBox();
  expect(languageBox).not.toBeNull();
  expect(languageBox!.width).toBeGreaterThanOrEqual(44);
  expect(languageBox!.height).toBeGreaterThanOrEqual(44);

  await page.goto("/finance");
  await expect(page).toHaveURL(/\/access-denied$/);
});

test("receiver confirmation remains separate from driver evidence", async ({ page }) => {
  await signInAsDemoRole(page, principals.receiver);
  await page.goto("/receiving");

  await expect(page.getByRole("heading", { level: 1, name: "Confirm delivered quantities" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "No delivered jobs" })).toBeVisible();
  await expectOperationalShell(page);

  await page.goto("/driver");
  await expect(page).toHaveURL(/\/access-denied$/);
});

test("company administrator manages the tenant without Axora catalog or supplier controls", async ({ page }) => {
  await signInAsDemoRole(page, principals.companyAdmin);
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { level: 1, name: /Good (morning|afternoon|evening), Company administrator fixture/ })).toBeVisible();
  await expectOperationalShell(page);

  await page.goto("/products");
  await expect(page.getByRole("heading", { level: 1, name: "Shop for your branch" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Create global product" })).toHaveCount(0);

  await page.goto("/suppliers");
  await expect(page).toHaveURL(/\/access-denied$/);
});

test("branch administrator receives branch-scoped workspaces", async ({ page }) => {
  await signInAsDemoRole(page, principals.branchAdmin);
  await page.goto("/branches");
  await expect(page.getByRole("heading", { level: 1, name: "Branches & monthly budgets" })).toBeVisible();
  await expectOperationalShell(page);

  await page.goto("/companies");
  await expect(page).toHaveURL(/\/access-denied$/);
});

test("requester can shop and create requests but cannot approve", async ({ page }) => {
  await signInAsDemoRole(page, principals.requester);
  await page.goto("/requests/new");
  await expect(page.getByRole("heading", { level: 1, name: "Create purchase request" })).toBeVisible();
  await expectOperationalShell(page);

  await page.goto("/approvals");
  await expect(page).toHaveURL(/\/access-denied$/);
});

test("approver receives the decision queue without sourcing controls", async ({ page }) => {
  await signInAsDemoRole(page, principals.approver);
  await page.goto("/approvals");
  await expect(page.getByRole("heading", { level: 1, name: "Request approvals" })).toBeVisible();
  await expect(page.getByText(/cannot approve your own request/i)).toBeVisible();
  await expectOperationalShell(page);

  await page.goto("/sourcing");
  await expect(page).toHaveURL(/\/access-denied$/);
});

test("finance reviewer receives invoice and matching work without supplier administration", async ({ page }) => {
  await signInAsDemoRole(page, principals.finance);
  await page.goto("/finance");
  await expect(page.getByRole("heading", { level: 1, name: "Your invoices and payment receipts" })).toBeVisible();
  await expectOperationalShell(page);

  await page.goto("/suppliers");
  await expect(page).toHaveURL(/\/access-denied$/);
});

test("auditor receives read-only evidence and no administration", async ({ page }) => {
  await signInAsDemoRole(page, principals.auditor);
  await page.goto("/audit");
  await expect(page.getByRole("heading", { level: 1, name: "Audit history" })).toBeVisible();
  await expectOperationalShell(page);

  await page.getByLabel("Entity type").fill("requests");
  await page.getByLabel("Action").fill("UPDATE");
  await page.getByRole("button", { name: "Apply filters" }).click();
  await expect(page).toHaveURL(/\/audit\?entityType=requests&action=UPDATE/);
  await expect(page.getByText(/matching records/)).toBeVisible();
  await expect(page.getByLabel("Entity type")).toHaveValue("requests");
  await expect(page.getByLabel("Action")).toHaveValue("UPDATE");
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(2);

  await page.getByRole("link", { name: "Clear", exact: true }).click();
  await expect(page).toHaveURL(/\/audit$/);
  await expect(page.getByLabel("Entity type")).toHaveValue("");

  await page.goto("/users");
  await expect(page).toHaveURL(/\/access-denied$/);
});

test("technical support lands on diagnostics and cannot enter business workflows", async ({ page }) => {
  await signInAsDemoRole(page, principals.support);
  await page.goto("/support");
  await expect(page.getByRole("heading", { level: 1, name: "System and account diagnostics" })).toBeVisible();
  await expect(page.getByText("Support boundary")).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Account diagnostics" })).toBeVisible();
  await expectOperationalShell(page);

  await page.goto("/requests");
  await expect(page).toHaveURL(/\/access-denied$/);

  await page.goto("/audit");
  await expect(page).toHaveURL(/\/access-denied$/);
});

test("platform operations can source and deliver without owner-only company controls", async ({ page }) => {
  await signInAsDemoRole(page, principals.operations);
  await page.goto("/sourcing");
  await expect(page.getByRole("heading", { level: 1, name: "Sourcing and quotations" })).toBeVisible();
  await expectOperationalShell(page);

  await page.goto("/companies");
  await expect(page).toHaveURL(/\/access-denied$/);
});

test("Arabic authenticated shell preserves RTL, mixed content, mobile flow, and reduced motion", async ({ page }) => {
  const arabicAdmin: DemoRoleSession = {
    ...principals.companyAdmin,
    preferredLocale: "ar",
  };
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await signInAsDemoRole(page, arabicAdmin);
  await page.goto("/dashboard");

  const languageSelect = page.locator('select:has(option[value="ar"])').first();
  await expect(page.locator("html")).toHaveAttribute("lang", "ar");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(languageSelect).toHaveValue("ar");
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth))
    .toBeLessThanOrEqual(2);

  const menuButton = page.locator("button:has(.lucide-menu)").first();
  await menuButton.focus();
  await expect(menuButton).toBeFocused();
  await menuButton.click();
  const drawer = page.locator("dialog.app-drawer");
  await expect(drawer).toBeVisible();
  const box = await drawer.boundingBox();
  expect(box).not.toBeNull();
  expect(Math.abs((box?.x ?? 0) + (box?.width ?? 0) - 390)).toBeLessThanOrEqual(2);
  expect(await drawer.evaluate((element) => element.contains(document.activeElement))).toBe(true);

  const email = drawer.locator('bdi.bidi-ltr[dir="ltr"]').first();
  await expect(email).toContainText(arabicAdmin.email);
  expect(await email.evaluate((element) => ({
    direction: getComputedStyle(element).direction,
    unicodeBidi: getComputedStyle(element).unicodeBidi,
  }))).toEqual({ direction: "ltr", unicodeBidi: "isolate" });

  const chevron = drawer.locator(".lucide-chevron-right, .lucide-chevron-left").first();
  if (await chevron.count()) {
    expect(await chevron.evaluate((element) => getComputedStyle(element).transform)).toMatch(/^matrix\(-1,/);
  }
  const reducedDuration = await drawer.evaluate((element) => (
    Number.parseFloat(getComputedStyle(element).transitionDuration)
  ));
  expect(reducedDuration).toBeLessThanOrEqual(0.00001);

  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "ar");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
});

test("company dashboard omits platform-wide analytics and commercial internals", async ({ page }) => {
  await signInAsDemoRole(page, principals.companyAdmin);
  await page.goto("/dashboard");
  await expectOperationalShell(page);

  await expect(page.getByText(/top products/i)).toHaveCount(0);
  await expect(page.getByText(/buying cost/i)).toHaveCount(0);
  await expect(page.getByText(/gross profit/i)).toHaveCount(0);
  await expect(page.getByText(/delayed deliver/i)).toHaveCount(0);
});
