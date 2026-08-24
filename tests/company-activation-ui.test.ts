import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

describe("Company activation contract UI", () => {
  it("renders a localized verification blocker instead of an enabled DRAFT activation", async () => {
    const page = await source("src/app/(portal)/companies/[companyId]/page.tsx");
    for (const message of [
      "Verification required before activation.",
      "يلزم التحقق قبل تفعيل الشركة.",
      "Pengesahan diperlukan sebelum pengaktifan.",
    ]) {
      expect(page).toContain(message);
    }
    expect(page).toContain("COMPANY_VERIFICATION_REQUIRED");
    expect(page).toContain("company.activationBlockedReasons.length");
    expect(page).toContain('disabled aria-disabled="true"');
    expect(page).not.toContain("SQLSTATE");
    expect(page).not.toContain("companies_active_requires_verification");
  });

  it("uses pending-safe, version-bound verification and activation forms", async () => {
    const [page, controls, actions] = await Promise.all([
      source("src/app/(portal)/companies/[companyId]/page.tsx"),
      source("src/components/CompanyActivationControls.tsx"),
      source("src/app/(portal)/masters/actions.ts"),
    ]);
    expect(page).toContain("verificationApprovalAvailable");
    expect(page).toContain("CompanyVerificationApprovalForm");
    expect(page).toContain("CompanyActivationForm");
    expect(controls).toContain("useFormStatus");
    expect(controls).toContain("disabled={pending}");
    expect(controls).toContain('name="expectedVersion"');
    expect(actions).toContain('result.status === "STALE"');
    expect(actions).toContain('result.status === "ALREADY_ACTIVE"');
    expect(actions).toContain('result.status === "BLOCKED"');
  });

  it("keeps expected domain failures local while unexpected failures remain throwable", async () => {
    const [activationActions, verificationActions] = await Promise.all([
      source("src/app/(portal)/masters/actions.ts"),
      source("src/app/(portal)/companies/[companyId]/onboarding/actions.ts"),
    ]);
    for (const notice of [
      "company-activation-blocked",
      "company-activation-stale",
      "company-already-active",
      "company-activation-unavailable",
    ]) {
      expect(activationActions).toContain(notice);
    }
    for (const notice of [
      "company-verification-approved",
      "company-verification-blocked",
      "company-verification-stale",
      "company-already-verified",
      "company-verification-unavailable",
    ]) {
      expect(verificationActions).toContain(notice);
    }
    expect(activationActions).not.toMatch(/catch\s*\([^)]*\)\s*\{[^}]*company-activation/s);
    expect(verificationActions).not.toMatch(/catch\s*\([^)]*\)\s*\{[^}]*company-verification/s);
  });
});
