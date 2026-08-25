import { expect, test, type Page } from "@playwright/test";

import { signInAsDemoRole, type DemoRoleSession } from "./helpers/auth";

// These journeys move demo financial state. A failed assertion must never make
// Playwright repeat a purchase command against the retained server process.
test.describe.configure({ retries: 0 });

const companyId = "11111111-1111-4111-8111-111111111111";
const branchId = "88888888-8888-4888-8888-888888888888";

function projectSuffix(projectName: string) {
  return projectName === "mobile-chrome" ? "2" : "1";
}

function directAdministrator(projectName: string): DemoRoleSession {
  const suffix = projectSuffix(projectName);
  return {
    id: `d1000000-0000-4000-8000-00000000000${suffix}`,
    email: `direct-purchase-${projectName}@axora.invalid`,
    name: `Direct purchase administrator ${projectName}`,
    role: "COMPANY_ADMIN",
    accountKind: "COMPANY",
    scopeType: "COMPANY",
    companyId,
  };
}

function subordinateRequester(projectName: string): DemoRoleSession {
  const suffix = projectSuffix(projectName);
  return {
    id: `d2000000-0000-4000-8000-00000000000${suffix}`,
    email: `direct-regression-requester-${projectName}@axora.invalid`,
    name: `Direct regression requester ${projectName}`,
    role: "REQUESTER",
    accountKind: "COMPANY",
    scopeType: "BRANCH",
    companyId,
    branchId,
  };
}

function subordinateApprover(projectName: string): DemoRoleSession {
  const suffix = projectSuffix(projectName);
  return {
    id: `d3000000-0000-4000-8000-00000000000${suffix}`,
    email: `direct-regression-approver-${projectName}@axora.invalid`,
    name: `Direct regression approver ${projectName}`,
    role: "COMPANY_ADMIN",
    accountKind: "COMPANY",
    scopeType: "COMPANY",
    companyId,
  };
}

async function clearCart(page: Page) {
  await page.goto(`/cart?branch=${branchId}`);
  const removeButtons = page.getByRole("button", { name: /^Remove / });
  while (await removeButtons.count()) {
    const before = await removeButtons.count();
    await Promise.all([
      page.waitForResponse((response) => response.request().method() === "POST"
        && response.url().includes("/cart")),
      removeButtons.first().click(),
    ]);
    await expect(removeButtons).toHaveCount(before - 1);
  }
  await expect(page.getByText("Your cart is empty.")).toBeVisible();
}

async function addStickyNotes(page: Page) {
  await page.goto(`/products?branch=${branchId}&view=all&q=sticky`);
  const product = page.locator(".shop-product-card").filter({
    has: page.getByRole("heading", { name: "Sticky notes" }),
  });
  await expect(product).toHaveCount(1);
  await product.getByRole("button", { name: "Add to cart" }).click();
}

test("Company Administrator places one order and reconciles a lost success response", async ({ page }, testInfo) => {
  const actor = directAdministrator(testInfo.project.name);
  await signInAsDemoRole(page, actor);
  await page.goto(`/requests/new?branch=${branchId}`);
  await expect(page).toHaveURL(new RegExp(`/cart\\?branch=${branchId}$`));
  await expect(page.getByRole("button", { name: /Submit purchase request/ })).toHaveCount(0);
  await clearCart(page);
  await addStickyNotes(page);
  await expect(page.getByText("1 item in your cart")).toBeVisible();
  await page.getByRole("link", { name: "Review order" }).click();

  await expect(page.getByRole("heading", { level: 1, name: "Cart" })).toBeVisible();
  await expect(page.getByText("E2E-MAIN · Authorized E2E branch")).toBeVisible();
  await expect(page.getByText("Branch budget available")).toBeVisible();
  await expect(page.getByText("Company Wallet available")).toBeVisible();
  await expect(page.getByRole("link", { name: "Submit purchase request" })).toHaveCount(0);
  await expect(page.getByText(/Pending approval|Approve & Pay|Buying Cost|margin/i)).toHaveCount(0);

  const placeOrder = page.getByRole("button", { name: "Place order", exact: true });
  await expect(placeOrder).toBeEnabled({ timeout: 15_000 });
  await placeOrder.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Place order for E2E-MAIN?" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(/charged to the Company Wallet and E2E-MAIN budget/)).toBeVisible();
  expect(await page.evaluate(() => Boolean(document.activeElement?.closest("dialog")))).toBe(true);

  // The confirmation remains bound to the version and amount that were
  // actually displayed, even when another tab changes the Cart underneath it.
  const concurrentCart = await page.context().newPage();
  await concurrentCart.goto(`/cart?branch=${branchId}`);
  const concurrentLine = concurrentCart.locator(".cart-line").filter({
    has: concurrentCart.getByRole("heading", { name: "Sticky notes" }),
  });
  await Promise.all([
    concurrentCart.waitForResponse((response) => response.request().method() === "POST"
      && response.url().includes("/cart")),
    concurrentLine.getByRole("button", { name: "Increase Sticky notes quantity" }).click(),
  ]);
  await expect(concurrentLine.getByRole("spinbutton", {
    name: "Quantity",
    exact: true,
  })).toHaveValue("2");
  await concurrentCart.close();
  await dialog.getByRole("button", { name: "Place order", exact: true }).click();
  await expect(page.locator(".cart-review").getByRole("alert")).toContainText(
    "Your Cart changed after you reviewed it.",
  );
  await expect(page.locator(".cart-purchase-success")).toHaveCount(0);
  // The Cart snapshot arrives in the typed stale result immediately. The
  // financial workspace is refreshed independently through the RSC boundary,
  // so keep the control locked until both authoritative versions agree.
  await expect(page.getByRole("spinbutton", {
    name: "Quantity",
    exact: true,
  })).toHaveValue("2");
  await expect(placeOrder).toBeEnabled({ timeout: 15_000 });
  await placeOrder.click();
  await expect(dialog).toBeVisible();

  await page.evaluate(() => {
    const originalFetch = window.fetch.bind(window);
    let dropped = false;
    window.fetch = async (...args: Parameters<typeof fetch>) => {
      const request = args[0] instanceof Request ? args[0] : undefined;
      const url = request?.url ?? String(args[0]);
      const method = (args[1]?.method ?? request?.method ?? "GET").toUpperCase();
      const response = await originalFetch(...args);
      if (!dropped && method === "POST" && new URL(url, location.href).pathname === "/cart") {
        dropped = true;
        await response.arrayBuffer();
        sessionStorage.setItem("axora:e2e:purchase-response-dropped", "true");
        throw new TypeError("Controlled direct-purchase response loss");
      }
      return response;
    };
  });
  await dialog.getByRole("button", { name: "Place order", exact: true }).click();

  const success = page.locator(".cart-purchase-success");
  await expect(success.getByRole("heading", { name: "Order placed" })).toBeVisible({ timeout: 15_000 });
  await expect(page).toHaveURL(/\/requests\/.+\?placed=1$/);
  expect(await page.evaluate(() => sessionStorage.getItem(
    "axora:e2e:purchase-response-dropped",
  ))).toBe("true");
  await expect(success.getByText("Paid from Company Wallet")).toBeVisible();
  await expect(success.getByText("Authorized E2E branch", { exact: true })).toBeVisible();
  const orderReference = (await success.locator("dd").first().textContent())?.trim();
  expect(orderReference).toMatch(/^ORD-DEMO-/);
  expect(await page.evaluate((key) => sessionStorage.getItem(key),
    `axora:company-admin-direct-purchase:${actor.id}`)).toBeNull();

  const receiptUrl = page.url();
  let receiptMutationRequests = 0;
  page.on("request", (request) => {
    if (request.method() !== "GET" && request.url().includes(`/requests/${receiptUrl.split("/").at(-1)?.split("?")[0]}`)) {
      receiptMutationRequests += 1;
    }
  });
  await page.reload();
  await expect(page).toHaveURL(receiptUrl);
  await expect(success.getByRole("heading", { name: "Order placed" })).toBeVisible();
  await expect(success.getByText(orderReference!, { exact: true })).toBeVisible();
  await expect(page.getByText("Sticky notes", { exact: true })).toBeVisible();
  expect(receiptMutationRequests).toBe(0);

  await success.getByRole("link", { name: "View order" }).click();
  await expect(page).not.toHaveURL(/\?placed=1/);
  await expect(page.getByRole("heading", { level: 1, name: orderReference! })).toBeVisible();
  await expect(page.getByText("Direct company order", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Placed and paid", { exact: true })).toBeVisible();
  await expect(page.getByText(/self-approval|Pending approval|Approve & Pay/i)).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText("Buying Cost");

  await page.goBack();
  await expect(page).toHaveURL(receiptUrl);
  await expect(success.getByRole("heading", { name: "Order placed" })).toBeVisible();
  await page.goForward();
  await expect(page.getByRole("heading", { level: 1, name: orderReference! })).toBeVisible();
  await page.goBack();
  await success.getByRole("link", { name: "View invoice" }).click();
  await expect(page).toHaveURL(/\/requests\/.+#invoice$/);
  await expect(page.locator("#invoice")).toBeVisible();
  await page.goBack();
  await expect(success.getByRole("heading", { name: "Order placed" })).toBeVisible();
  await success.getByRole("link", { name: "View delivery" }).click();
  await expect(page).toHaveURL(/\/deliveries$/);
  await page.goBack();
  await expect(page).toHaveURL(receiptUrl);

  await page.getByRole("button", { name: /My profile:/ }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login/);
  await page.goBack();
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByText(orderReference!, { exact: true })).toHaveCount(0);
  await signInAsDemoRole(page, actor);
  await page.goto(receiptUrl);
  await expect(success.getByRole("heading", { name: "Order placed" })).toBeVisible();

  await page.goto("/approvals");
  await expect(page.getByText(orderReference!, { exact: true })).toHaveCount(0);
  await page.goto(`/cart?branch=${branchId}`);
  await expect(page.getByText("Your cart is empty.")).toBeVisible();
  await page.reload();
  await expect(page.getByText("Your cart is empty.")).toBeVisible();
  await page.goBack();
  await page.goForward();
  await expect(page.getByText("Your cart is empty.")).toBeVisible();

  await signInAsDemoRole(page, {
    ...actor,
    id: `d6000000-0000-4000-8000-00000000000${projectSuffix(testInfo.project.name)}`,
    email: `foreign-receipt-${testInfo.project.name}@axora.invalid`,
    companyId: "22222222-2222-4222-8222-222222222222",
  });
  await page.goto(receiptUrl);
  await expect(page.getByText(orderReference!, { exact: true })).toHaveCount(0);

  await signInAsDemoRole(page, {
    id: `d7000000-0000-4000-8000-00000000000${projectSuffix(testInfo.project.name)}`,
    email: `delivery-receipt-${testInfo.project.name}@axora.invalid`,
    name: `Delivery receipt probe ${testInfo.project.name}`,
    role: "DELIVERY_AGENT",
    accountKind: "DELIVERY",
    scopeType: "DELIVERY",
  });
  await page.goto(receiptUrl);
  await expect(page.getByText(orderReference!, { exact: true })).toHaveCount(0);
});

test("a normal successful response replaces Cart with the authoritative receipt", async ({ page }, testInfo) => {
  const suffix = projectSuffix(testInfo.project.name);
  const actor: DemoRoleSession = {
    ...directAdministrator(testInfo.project.name),
    id: `d5000000-0000-4000-8000-00000000000${suffix}`,
    email: `direct-receipt-${testInfo.project.name}@axora.invalid`,
  };
  await signInAsDemoRole(page, actor);
  await clearCart(page);
  await addStickyNotes(page);
  await page.goto(`/cart?branch=${branchId}`);
  await page.getByRole("button", { name: "Place order", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Place order for E2E-MAIN?" });
  await dialog.getByRole("button", { name: "Place order", exact: true }).click();

  await expect(page).toHaveURL(/\/requests\/.+\?placed=1$/, { timeout: 15_000 });
  const receipt = page.locator(".cart-purchase-success");
  await expect(receipt.getByRole("heading", { name: "Order placed" })).toBeVisible();
  const receiptUrl = page.url();
  await page.reload();
  await expect(page).toHaveURL(receiptUrl);
  await expect(receipt.getByRole("heading", { name: "Order placed" })).toBeVisible();
  await page.goto(`/cart?branch=${branchId}`);
  await expect(page.getByText("Your cart is empty.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Place order", exact: true })).toHaveCount(0);

  await page.goto(`/products?branch=${branchId}&view=all&q=A4%20paper`);
  const newCartProduct = page.locator(".shop-product-card").filter({
    has: page.getByRole("heading", { name: "A4 paper 70gsm" }),
  });
  await newCartProduct.getByRole("button", { name: "Add to cart" }).click();
  await page.goto(receiptUrl);
  await expect(page.getByText("Sticky notes", { exact: true })).toBeVisible();
  await expect(page.getByText("A4 paper 70gsm", { exact: true })).toHaveCount(0);
  await page.goto(`/cart?branch=${branchId}`);
  await expect(page.getByRole("heading", { name: "A4 paper 70gsm" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Sticky notes" })).toHaveCount(0);
});

test("subordinate purchase requests retain separation of duties", async ({ page }, testInfo) => {
  const requester = subordinateRequester(testInfo.project.name);
  await signInAsDemoRole(page, requester);
  await clearCart(page);
  await addStickyNotes(page);
  await expect(page.getByText("1 item in your request cart")).toBeVisible();
  await page.getByRole("link", { name: "Review request" }).click();
  await expect(page.getByRole("button", { name: "Place order" })).toHaveCount(0);
  await page.getByRole("link", { name: "Submit purchase request" }).click();
  await page.getByLabel("Department").fill("Administration");
  await page.getByRole("button", { name: /^Submit purchase request/ }).click();
  await expect(page).toHaveURL(/\/requests\/.+notice=request-submitted/, { timeout: 15_000 });
  const requestId = new URL(page.url()).pathname.split("/").at(-1)!;
  await expect(page.getByText("Pending", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Review approval" })).toHaveCount(0);
  await page.goto("/approvals");
  await expect(page).toHaveURL(/\/access-denied$/);

  const approver = subordinateApprover(testInfo.project.name);
  await signInAsDemoRole(page, approver);
  await page.goto("/approvals");
  const requestCard = page.locator("article").filter({ hasText: requester.name });
  await expect(requestCard).toHaveCount(1);
  await expect(requestCard.getByRole("button", { name: "Approve & Pay" })).toBeVisible();
  await requestCard.getByRole("button", { name: "Approve & Pay" }).click();
  await expect(page.getByText("Request approved and paid", { exact: true })).toBeVisible();
  await page.goto(`/requests/${requestId}`);
  await expect(page.getByText("Approved", { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/Issued · Paid/).first()).toBeVisible();
});

test("direct checkout dialog stays accessible across locales, themes, and narrow widths", async ({ page }, testInfo) => {
  const cases = [
    { locale: "en", width: 320, label: "Place order", title: "Place order for E2E-MAIN?", dir: "ltr" },
    { locale: "ar", width: 390, label: "تقديم الطلب", title: "تقديم الطلب إلى E2E-MAIN؟", dir: "rtl" },
    { locale: "ms", width: 412, label: "Buat pesanan", title: "Buat pesanan untuk E2E-MAIN?", dir: "ltr" },
  ] as const;
  for (const [index, fixture] of cases.entries()) {
    const project = projectSuffix(testInfo.project.name);
    const actor: DemoRoleSession = {
      ...directAdministrator(testInfo.project.name),
      id: `d4${index}00000-0000-4000-8000-00000000000${project}`,
      email: `direct-a11y-${fixture.locale}-${testInfo.project.name}@axora.invalid`,
      preferredLocale: fixture.locale,
    };
    await page.setViewportSize({ width: fixture.width, height: 844 });
    await signInAsDemoRole(page, actor);
    await page.goto(`/products?branch=${branchId}&view=all&q=sticky`);
    const product = page.locator(".shop-product-card").filter({ hasText: "Sticky notes" });
    await product.getByRole("button", { name: fixture.locale === "ar"
      ? "إضافة إلى السلة" : fixture.locale === "ms" ? "Tambah ke troli" : "Add to cart" }).click();
    await page.goto(`/cart?branch=${branchId}`);
    await expect(page.locator("html")).toHaveAttribute("dir", fixture.dir);
    expect(await page.evaluate(() => document.documentElement.scrollWidth
      - document.documentElement.clientWidth)).toBeLessThanOrEqual(2);
    const trigger = page.getByRole("button", { name: fixture.label, exact: true });
    const box = await trigger.boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);
    await trigger.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: fixture.title });
    await expect(dialog).toBeVisible();
    expect(await page.evaluate(() => Boolean(document.activeElement?.closest("dialog")))).toBe(true);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
  }
});
