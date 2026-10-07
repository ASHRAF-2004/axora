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
  const liveRequests:string[]=[];
  const receivedCounts:number[]=[];
  const session=await page.context().newCDPSession(page);
  await session.send("Network.enable");
  page.on("request",request=>{
    const url=new URL(request.url());
    if(url.pathname==="/api/live" && url.searchParams.get("topics")?.split(",").includes("notifications")
      && url.searchParams.get("transport")!=="poll") liveRequests.push(request.url());
  });
  session.on("Network.eventSourceMessageReceived",event=>{
    if(event.eventName!=="snapshot") return;
    const frame=JSON.parse(event.data) as {snapshot?:{topics?:{notifications?:{unreadCount?:number}}}};
    const count=frame.snapshot?.topics?.notifications?.unreadCount;
    if(Number.isSafeInteger(count)) receivedCounts.push(count!);
  });

  await signInAsDemoOwner(page);
  await page.goto("/notifications");

  await expect(page.getByRole("heading",{level:1,name:"Notification centre"})).toBeVisible();
  await expect(page.locator(".notification-centre")).toBeVisible();
  await expect(page.locator(".notification-filter-bar select")).toHaveCount(1);
  await expect(page.locator(".notification-preferences input[type=checkbox]:disabled").first()).toBeChecked();
  await expect(page.locator('a[href="/notifications"]').first()).toBeVisible();
  await expect.poll(()=>liveRequests.length).toBeGreaterThan(0);
  await expect.poll(()=>receivedCounts.length).toBeGreaterThan(0);
  await expect(page.locator('[data-live-status="current"]')).toBeVisible();
  await expect(page.locator(".app-notification-count")).toHaveText(String(receivedCounts.at(-1)));
  await session.detach();
});

test("notification filters survive refresh and browser Back and Forward",async ({page})=>{
  await signInAsDemoOwner(page);
  await page.goto("/notifications");

  await page.locator('select[name="status"]').selectOption("UNREAD");
  await page.locator(".notification-filter-bar").getByRole("button").click();
  await expect(page).toHaveURL(/\/notifications\?status=UNREAD$/);

  await page.reload();
  await expect(page.locator('select[name="status"]')).toHaveValue("UNREAD");

  await page.goto("/requests");
  await page.goBack();
  await expect(page).toHaveURL(/\/notifications\?status=UNREAD$/);
  await expect(page.locator('select[name="status"]')).toHaveValue("UNREAD");

  await page.goForward();
  await expect(page).toHaveURL(/\/requests$/);
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
