import { expect,test,type Page } from "@playwright/test";
import { signInAsDemoOwner,signInAsDemoRole,type DemoRoleSession } from "./helpers/auth";

const companyAdmin:DemoRoleSession={
  id:"66666666-6666-4666-8666-666666666666",
  email:"company-admin.discovery@axora.invalid",
  name:"Company administrator fixture",
  role:"COMPANY_ADMIN",
  accountKind:"COMPANY",
  scopeType:"COMPANY",
  companyId:"11111111-1111-4111-8111-111111111111",
};

const scopedRequester:DemoRoleSession={
  id:"77777777-7777-4777-8777-777777777771",
  email:"requester.procurement@axora.invalid",
  name:"Procurement requester fixture",
  role:"REQUESTER",
  accountKind:"COMPANY",
  scopeType:"BRANCH",
  companyId:"11111111-1111-4111-8111-111111111111",
  branchId:"88888888-8888-4888-8888-888888888888",
};

async function clearCart(page:Page) {
  await page.goto("/cart?branch=88888888-8888-4888-8888-888888888888");
  await expect(page.getByRole("heading",{level:1,name:"Cart"})).toBeVisible();
  const removeButtons=page.getByRole("button",{name:/^Remove /});
  while (await removeButtons.count()) {
    const before=await removeButtons.count();
    await Promise.all([
      page.waitForResponse((response) => response.request().method()==="POST" && response.url().includes("/cart")),
      removeButtons.first().click(),
    ]);
    await expect(removeButtons).toHaveCount(before-1);
  }
  await expect(page.getByText("Your cart is empty.")).toBeVisible();
}

test("request search and status retain the same compact URL state",async ({page}) => {
  await signInAsDemoOwner(page);
  await page.goto("/requests?q=paper&status=open&sort=amount-desc");
  await expect(page.getByRole("heading",{level:1,name:"Purchase requests"})).toBeVisible();
  await expect(page.getByLabel("Search requests")).toHaveValue("paper");
    await expect(page.getByLabel("Filter by status")).toHaveValue("open");
  await expect(page).toHaveURL(/\/requests\?q=paper&status=open$/);
  await expect(page.getByLabel("Sort requests")).toHaveCount(0);
  await expect(page.getByRole("link",{name:"Export CSV"})).toHaveCount(0);
  await page.reload();
  await expect(page).toHaveURL(/\/requests\?q=paper&status=open$/);
});

test("request filters do not expose the retired advanced controls",async ({page}) => {
  await signInAsDemoOwner(page);
  await page.goto("/requests");
  await expect(page.getByLabel("Request category")).toHaveCount(0);
  await expect(page.getByText("Advanced filters",{exact:true})).toHaveCount(0);
});

test("company catalogue exposes a bookmarkable complete view without platform pricing",async ({page}) => {
  await signInAsDemoRole(page,companyAdmin);
  await page.goto("/products");
  await expect(page.getByRole("heading",{level:1,name:"Choose a branch"})).toBeVisible();
  await expect(page.locator(".shop-product-card")).toHaveCount(0);
  await page.getByRole("button",{name:"Shop for Authorized E2E branch"}).click();
  await expect(page).toHaveURL(/branch=88888888-8888-4888-8888-888888888888/);
  await page.getByRole("link",{name:"See all products"}).click();
  await expect(page).toHaveURL(/branch=88888888-8888-4888-8888-888888888888.*view=all/);
  await expect(page.getByRole("heading",{level:2,name:"All products"})).toBeVisible();
  await expect(page.locator(".shop-product-card").first()).toBeVisible();
  await page.getByLabel("Sort by").selectOption("price-asc");
  await expect(page).toHaveURL(/view=all.*sort=price-asc/);
  await page.reload();
  await expect(page.getByLabel("Sort by")).toHaveValue("price-asc");
  await expect(page.locator("body")).not.toContainText("Buying Cost");
});

test("shopping branch context rejects foreign Company Admin scope and canonicalizes branch-scoped users",async ({page}) => {
  await signInAsDemoRole(page,companyAdmin);
  await page.goto("/products?branch=br-youruni-main");
  await expect(page.locator(".request-section-error")).toContainText("not available for shopping");
  await expect(page.locator(".shop-product-card")).toHaveCount(0);
  await signInAsDemoRole(page,scopedRequester);
  await page.goto("/products?branch=br-youruni-main");
  await expect(page).toHaveURL(/branch=88888888-8888-4888-8888-888888888888/);
  await expect(page.getByRole("link",{name:"Change branch"})).toHaveCount(0);
});

test("Arabic complete catalogue remains RTL, mobile-safe and reduced-motion aware",async ({page}) => {
  await page.setViewportSize({width:390,height:844});
  await page.emulateMedia({reducedMotion:"reduce"});
  await signInAsDemoRole(page,{...companyAdmin,preferredLocale:"ar"});
  await page.goto("/products?branch=88888888-8888-4888-8888-888888888888&view=all");
  await expect(page.locator("html")).toHaveAttribute("dir","rtl");
  await expect(page.getByRole("heading",{level:2,name:"كل المنتجات"})).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(2);
});

test("Shopping keeps branch URL state and authoritative Cart survives navigation and invalid quantity",async ({page}) => {
  await signInAsDemoRole(page,scopedRequester);
  await clearCart(page);
  await page.goto("/products?view=all&q=paper");
  await expect(page.getByLabel("Search the Axora shop")).toHaveValue("paper");
  await page.getByLabel("Category").selectOption("Office Basics");
  await expect(page).toHaveURL(/category=Office(?:\+|%20)Basics/);
  await page.goBack();
  await expect(page.getByLabel("Category")).toHaveValue("");
  await page.goForward();
  await expect(page.getByLabel("Category")).toHaveValue("Office Basics");

  const product=page.locator(".shop-product-card").first();
  await expect(product).toBeVisible();
  await product.getByRole("button",{name:"Add to cart"}).click();
  await expect(page.getByText("1 item in your request cart")).toBeVisible();
  await product.getByRole("button",{name:"Added to cart"}).click();
  await expect(page.getByText(/2 units/)).toBeVisible();
  await page.reload();
  await expect(page.getByText("1 item in your request cart")).toBeVisible();
  await expect(page.getByText(/2 units/)).toBeVisible();
  await page.getByRole("link",{name:"Review request"}).click();

  await expect(page).toHaveURL(/\/cart/);
  await expect(page.getByRole("heading",{level:1,name:"Cart"})).toBeVisible();
  await expect(page.getByText("E2E-MAIN · Authorized E2E branch")).toBeVisible();
  await expect(page.getByText("Request type",{exact:true})).toHaveCount(0);
  await expect(page.getByLabel("Purchasing branch")).toHaveCount(0);
  const quantity=page.getByRole("spinbutton",{name:"Quantity",exact:true});
  await quantity.fill("0");
  await quantity.blur();
  await expect(page.getByText("Quantity must be a whole number of at least 1.")).toBeVisible();
  for (const invalid of ["-1","-10","1.5","","1e3","999999999"]) {
    await quantity.fill(invalid);
    await quantity.blur();
    await expect(page.locator(".cart-quantity .request-field-error-message")).toBeVisible();
  }
  await quantity.fill("");
  await quantity.pressSequentially("abc   ");
  await quantity.blur();
  await expect(page.locator(".cart-quantity .request-field-error-message")).toBeVisible();
  await page.reload();
  await expect(quantity).toHaveValue("2");
  await quantity.fill("3");
  await Promise.all([
    page.waitForResponse((response) => response.request().method()==="POST" && response.url().includes("/cart")),
    quantity.blur(),
  ]);
  await page.getByRole("link",{name:/ home$/}).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/cart\?/);
  await expect(page.getByRole("spinbutton",{name:"Quantity",exact:true})).toHaveValue("3");
  await page.goForward();
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/cart\?/);
  await expect(page.getByRole("spinbutton",{name:"Quantity",exact:true})).toHaveValue("3");
  await page.reload();
  await expect(page.getByRole("spinbutton",{name:"Quantity",exact:true})).toHaveValue("3");
  await Promise.all([
    page.waitForResponse((response) => response.request().method()==="POST" && response.url().includes("/cart")),
    page.getByRole("button",{name:/Remove .*paper/i}).click(),
  ]);
  await expect(page.getByText("Your cart is empty.")).toBeVisible();
});

test("Cart corrects stale tabs and persists through sign-out and sign-in",async ({page,context}) => {
  const actor={...scopedRequester,id:"77777777-7777-4777-8777-777777777772",email:"requester.multitab@axora.invalid"};
  await signInAsDemoRole(page,actor);
  await clearCart(page);
  await page.goto("/products?view=all&q=paper");
  await page.locator(".shop-product-card").first().getByRole("button",{name:"Add to cart"}).click();
  await expect(page.getByText("1 item in your request cart")).toBeVisible();
  await page.goto("/cart?branch=88888888-8888-4888-8888-888888888888");
  const tabB=await context.newPage();
  await tabB.goto("/cart");
  const quantityA=page.getByRole("spinbutton",{name:"Quantity",exact:true});
  const quantityB=tabB.getByRole("spinbutton",{name:"Quantity",exact:true});
  const initialSubtotal=await page.locator(".cart-line-total > strong").textContent();
  await quantityA.fill("2");
  await quantityA.blur();
  await expect(page.locator(".cart-line-total > strong")).not.toHaveText(initialSubtotal ?? "");
  await tabB.bringToFront();
  await tabB.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(quantityB).toHaveValue("2");
  await quantityB.fill("3");
  const secondSubtotal=await tabB.locator(".cart-line-total > strong").textContent();
  await quantityB.blur();
  await expect(tabB.locator(".cart-line-total > strong")).not.toHaveText(secondSubtotal ?? "");
  await page.bringToFront();
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(quantityA).toHaveValue("3");
  await tabB.close();
  await page.getByRole("button",{name:/My profile:/}).click();
  await page.getByRole("menuitem",{name:"Sign out"}).click();
  await expect(page).toHaveURL(/\/login/);
  await page.goBack();
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole("heading",{level:1,name:"Cart"})).toHaveCount(0);
  await signInAsDemoRole(page,actor);
  await page.goto("/cart");
  await expect(page.getByRole("spinbutton",{name:"Quantity",exact:true})).toHaveValue("3");
  await clearCart(page);
});

test("Cart serializes a slow quantity command and retains its result across reconnect",async ({page,context}) => {
  const actor={...scopedRequester,id:"77777777-7777-4777-8777-777777777773",email:"requester.slow-cart@axora.invalid"};
  await signInAsDemoRole(page,actor);
  await clearCart(page);
  await page.goto("/products?view=all&q=paper");
  await page.locator(".shop-product-card").first().getByRole("button",{name:"Add to cart"}).click();
  await page.goto("/cart");
  let delayed=false;
  await page.route("**/cart?**",async (route) => {
    if (!delayed && route.request().method()==="POST") {
      delayed=true;
      await new Promise((resolve) => setTimeout(resolve,350));
    }
    await route.continue();
  });
  const increase=page.getByRole("button",{name:/^Increase .* quantity$/});
  const quantity=page.getByRole("spinbutton",{name:"Quantity",exact:true});
  await increase.click();
  await expect(increase).toBeDisabled();
  await expect(quantity).toHaveValue("2");
  await expect(increase).toBeEnabled();
  await context.setOffline(true);
  await expect(quantity).toHaveValue("2");
  await context.setOffline(false);
  await page.reload();
  await expect(page.getByRole("spinbutton",{name:"Quantity",exact:true})).toHaveValue("2");
  await clearCart(page);
});

test("branch chooser and Cart remain accessible across required viewports, themes, RTL and Malay",async ({page}) => {
  const actor={...scopedRequester,id:"77777777-7777-4777-8777-777777777774",email:"requester.responsive-cart@axora.invalid"};
  await signInAsDemoRole(page,actor);
  await clearCart(page);
  await page.goto("/products?view=all&q=paper");
  await page.locator(".shop-product-card").first().getByRole("button",{name:"Add to cart"}).click();
  await page.goto("/cart?branch=88888888-8888-4888-8888-888888888888");
  await expect(page.getByRole("spinbutton",{name:"Quantity",exact:true})).toBeVisible();
  for (const appearance of ["light","dark"] as const) {
    expect((await page.request.patch("/api/profile/appearance",{
      data:{appearance},headers:{Origin:"http://127.0.0.1:3100"},
    })).status()).toBe(200);
    await expect.poll(async () => (await page.context().cookies()).find((cookie) => cookie.name==="axora_appearance")?.value).toBe(appearance);
    await page.reload();
    await expect(page.getByRole("spinbutton",{name:"Quantity",exact:true})).toBeVisible();
    for (const width of [320,360,390,768,1024,1440]) {
      await page.setViewportSize({width,height:width<600?844:900});
      expect(await page.evaluate(() => document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(2);
    }
  }
  await page.setViewportSize({width:667,height:375});
  await page.goto("/cart?branch=88888888-8888-4888-8888-888888888888");
  await expect(page.getByRole("spinbutton",{name:"Quantity",exact:true})).toBeVisible();
  await page.evaluate(() => { document.documentElement.style.fontSize="125%"; });
  expect(await page.evaluate(() => document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(2);
  const targets=await page.locator(".cart-quantity-control button,.cart-quantity-control input,.cart-line-total button").evaluateAll((elements) => elements.map((element) => ({width:element.getBoundingClientRect().width,height:element.getBoundingClientRect().height})));
  for (const target of targets) {
    expect(target.width,JSON.stringify(targets)).toBeGreaterThanOrEqual(44);
    expect(target.height,JSON.stringify(targets)).toBeGreaterThanOrEqual(44);
  }

  await signInAsDemoRole(page,{...companyAdmin,preferredLocale:"ms"});
  await page.setViewportSize({width:360,height:800});
  await page.goto("/products");
  await expect(page.getByRole("heading",{level:1,name:"Pilih cawangan"})).toBeVisible();
  await signInAsDemoRole(page,{...companyAdmin,preferredLocale:"ar"});
  await page.setViewportSize({width:390,height:844});
  await page.goto("/products");
  await expect(page.locator("html")).toHaveAttribute("dir","rtl");
  expect(await page.evaluate(() => document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(2);

  await signInAsDemoRole(page,actor);
  await clearCart(page);
});
