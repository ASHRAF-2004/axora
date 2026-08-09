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

test("request filters and matching export retain the same authorized URL state",async ({page}) => {
  await signInAsDemoOwner(page);
  await page.goto("/requests?q=paper&status=open&sort=amount-desc");
  await expect(page.getByRole("heading",{level:1,name:"Purchase requests"})).toBeVisible();
  await expect(page.getByLabel("Search requests")).toHaveValue("paper");
    await expect(page.getByLabel("Filter by status")).toHaveValue("open");
  await expect(page.getByLabel("Sort requests")).toHaveValue("amount-desc");
  await expect(page.getByRole("link",{name:"Export CSV"})).toHaveAttribute("href",/q=paper.*status=open.*sort=amount-desc/);
  await page.reload();
  await expect(page).toHaveURL(/\/requests\?q=paper&status=open&sort=amount-desc$/);
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
