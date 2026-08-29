import { expect,test } from "@playwright/test";
import { signInAsDemoRole,type DemoRoleSession } from "./helpers/auth";

const companyId="11111111-1111-4111-8111-111111111111";
const enabled=process.env.AXORA_INTEGRATION_WEBHOOKS_ENABLED==="true";

const owner:DemoRoleSession={
  id:"f1296000-0000-4000-8000-000000000001",
  email:"webhook-owner@axora.invalid",name:"Webhook Owner",
  role:"PLATFORM_OWNER",accountKind:"PLATFORM",scopeType:"PLATFORM",isOwner:true,
};
const companyAdministrator:DemoRoleSession={
  id:"f1296000-0000-4000-8000-000000000002",
  email:"webhook-administrator@axora.invalid",name:"Webhook Administrator",
  role:"COMPANY_ADMIN",accountKind:"COMPANY",scopeType:"COMPANY",companyId,
};

test.describe("enabled webhook management surface",()=>{
  test.skip(!enabled,"The webhook capability is intentionally dark by default.");

  test("keeps global inspection separate from company subscription creation",async({page})=>{
    await signInAsDemoRole(page,owner);
    await page.goto("/integrations");
    await expect(page.getByText("Webhooks active",{exact:true})).toBeVisible();
    await expect(page.getByRole("heading",{name:"Webhook operations"})).toBeVisible();
    await expect(page.getByRole("heading",{name:"Webhook subscriptions"})).toBeVisible();
    await expect(page.getByRole("heading",{name:"Recent webhook deliveries"})).toBeVisible();
    await expect(page.getByRole("heading",{name:"Create webhook subscription"}))
      .toHaveCount(0);

    await page.context().clearCookies();
    await signInAsDemoRole(page,companyAdministrator);
    await page.goto("/integrations");
    await expect(page.getByText("Webhooks active",{exact:true})).toBeVisible();
    await expect(page.getByRole("heading",{name:"Create webhook subscription"}))
      .toBeVisible();
    await expect(page.getByText(
      "No active connection with the webhooks:manage scope is available.",
      {exact:true},
    )).toBeVisible();
    await expect(page.getByRole("heading",{name:"Webhook operations"})).toHaveCount(0);
  });

  test("preserves the Arabic RTL shell for webhook management",async({page})=>{
    await signInAsDemoRole(page,{...companyAdministrator,
      id:"f1296000-0000-4000-8000-000000000003",preferredLocale:"ar"});
    await page.goto("/integrations");
    await expect(page.locator(".app-shell")).toHaveAttribute("dir","rtl");
    await expect(page.getByText("Webhooks مفعّلة",{exact:true})).toBeVisible();
    await expect(page.getByRole("heading",{name:"إنشاء اشتراك Webhook"})).toBeVisible();
  });
});
