import {expect,test} from "@playwright/test";
import {signInAsDemoOwner,signInAsDemoRole,type DemoRoleSession} from "./helpers/auth";

const arabicCompanyAdmin:DemoRoleSession={
  id:"77777777-7777-4777-8777-777777777775",
  email:"company-admin.notifications@axora.invalid",
  name:"مسؤول شركة الإشعارات",
  role:"COMPANY_ADMIN",
  accountKind:"COMPANY",
  scopeType:"COMPANY",
  companyId:"11111111-1111-4111-8111-111111111111",
  preferredLocale:"ar",
};

test("notification centre exposes grouped controls and refreshes the shell count",async ({page})=>{
  const summaryRequests:string[]=[];
  page.on("request",request=>{
    if(request.url().includes("/api/notifications/summary")) summaryRequests.push(request.url());
  });

  await signInAsDemoOwner(page);
  await page.goto("/notifications");

  await expect(page.getByRole("heading",{level:1,name:"Notification centre"})).toBeVisible();
  await expect(page.locator(".notification-centre")).toBeVisible();
  await expect(page.locator(".notification-filter-bar select")).toHaveCount(2);
  await expect(page.locator(".notification-preferences input[type=checkbox]:disabled").first()).toBeChecked();
  await expect(page.locator('a[href="/notifications"]').first()).toBeVisible();
  await expect.poll(()=>summaryRequests.length).toBeGreaterThan(0);
});

test("Arabic notification centre remains usable on mobile with reduced motion",async ({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.emulateMedia({reducedMotion:"reduce"});
  await signInAsDemoRole(page,arabicCompanyAdmin);
  await page.goto("/notifications");

  await expect(page.locator("html")).toHaveAttribute("lang","ar");
  await expect(page.locator("html")).toHaveAttribute("dir","rtl");
  await expect(page.locator("h1")).toContainText(/[\u0600-\u06ff]/u);
  await expect(page.locator('a[href="/notifications"]').first()).toBeVisible();
  await expect(page.locator(".notification-centre")).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+1)).toBe(true);
  expect(await page.evaluate(()=>matchMedia("(prefers-reduced-motion: reduce)").matches)).toBe(true);
});
