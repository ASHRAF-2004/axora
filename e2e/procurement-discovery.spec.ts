import { expect,test } from "@playwright/test";
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
  await page.getByRole("link",{name:"See all products"}).click();
  await expect(page).toHaveURL(/\/products\?view=all$/);
  await expect(page.getByRole("heading",{level:2,name:"All products"})).toBeVisible();
  await expect(page.locator(".shop-product-card").first()).toBeVisible();
  await page.getByLabel("Sort by").selectOption("price-asc");
  await expect(page).toHaveURL(/view=all.*sort=price-asc/);
  await page.reload();
  await expect(page.getByLabel("Sort by")).toHaveValue("price-asc");
  await expect(page.locator("body")).not.toContainText("Buying Cost");
});

test("Arabic complete catalogue remains RTL, mobile-safe and reduced-motion aware",async ({page}) => {
  await page.setViewportSize({width:390,height:844});
  await page.emulateMedia({reducedMotion:"reduce"});
  await signInAsDemoRole(page,{...companyAdmin,preferredLocale:"ar"});
  await page.goto("/products?view=all");
  await expect(page.locator("html")).toHaveAttribute("dir","rtl");
  await expect(page.getByRole("heading",{level:2,name:"كل المنتجات"})).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(2);
});

test("Shopping keeps URL state and the canonical cart survives refresh through first-attempt submission",async ({page}) => {
  await signInAsDemoRole(page,scopedRequester);
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
  await page.reload();
  await expect(page.getByText("1 item in your request cart")).toBeVisible();
  await page.getByRole("link",{name:"Review request"}).click();

  await expect(page).toHaveURL(/\/cart/);
  await expect(page.getByRole("heading",{level:1,name:"Create purchase request"})).toBeVisible();
  await page.getByLabel("Department").fill("Administration");
  await page.getByLabel("Quantity").fill("2");
  await page.getByRole("button",{name:/Submit purchase request/}).click();
  await expect(page).toHaveURL(/\/requests\/[0-9a-f-]+\?notice=request-submitted$/i);
  await expect(page.getByText(/request submitted/i).first()).toBeVisible();
  await expect(page.getByRole("cell",{name:/^2 Ream/})).toBeVisible();
  await expect.poll(() => page.evaluate(() => Object.keys(localStorage)
    .filter((key) => key.startsWith("axora-request-draft:")).length)).toBe(0);

  await page.getByRole("button",{name:"Cancel request"}).click();
  await expect(page).toHaveURL(/cancelNotice=complete/);
  await expect(page.getByRole("status").filter({hasText:"cancelled"})).toBeVisible();
});
