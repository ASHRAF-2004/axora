import { expect, type Page } from "@playwright/test";
import { SignJWT } from "jose";

export const E2E_OWNER_EMAIL = "owner@axora.e2e";
// Public deterministic fixture; never use these values outside DEMO_MODE.
export const E2E_OWNER_PASSWORD = "public-e2e-fixture-password";
const E2E_SESSION_SECRET = "public-e2e-session-key-not-for-production-0001";

export interface DemoRoleSession {
  id: string;
  email: string;
  name: string;
  role: string;
  accountKind: "PLATFORM" | "COMPANY" | "SUPPLIER" | "DELIVERY";
  scopeType: "PLATFORM" | "COMPANY" | "BRANCH" | "SUPPLIER" | "DELIVERY";
  companyId?: string;
  branchId?: string;
  supplierId?: string;
  isOwner?: boolean;
  preferredLocale?: "en" | "ar" | "ms";
}

export async function signInAsDemoOwner(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(E2E_OWNER_EMAIL);
  await page.getByLabel("Password", { exact: true }).fill(E2E_OWNER_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

/**
 * Creates a signed, scope-valid fixture session without inventing extra demo
 * passwords. The development server still validates every role/account/scope
 * combination through the same session and permission code used in production.
 */
export async function signInAsDemoRole(page: Page, fixture: DemoRoleSession) {
  const token = await new SignJWT({
    email: fixture.email,
    name: fixture.name,
    role: fixture.role,
    accountKind: fixture.accountKind,
    scopeType: fixture.scopeType,
    companyId: fixture.companyId,
    branchId: fixture.branchId,
    supplierId: fixture.supplierId,
    isOwner: fixture.isOwner ?? false,
    authVersion: 1,
    preferredLocale: fixture.preferredLocale ?? "en",
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(fixture.id)
    .setIssuedAt()
    .setExpirationTime("8h")
    .sign(new TextEncoder().encode(E2E_SESSION_SECRET));

  await page.context().addCookies([{
    name: "axora_session",
    value: token,
    url: "http://127.0.0.1:3100",
    httpOnly: true,
    sameSite: "Strict",
  }]);
}
