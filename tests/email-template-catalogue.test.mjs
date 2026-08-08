import { describe, expect, it } from "vitest";
import {
  EMAIL_TEMPLATE_CATALOGUE,
  emailTemplateDefinition,
} from "../server-tools/email-template-catalogue.mjs";
import { renderTransactionalEmail } from "../server-tools/transactional-email.mjs";

const REQUIRED_TEMPLATES = [
  "company-admin-invitation", "internal-user-invitation", "account-activated",
  "password-reset", "password-changed", "account-security-change",
  "company-lead-acknowledgement", "new-lead-internal-alert", "lead-assigned",
  "lead-reassigned", "company-information-requested", "portal-ready-for-review",
  "company-activated", "company-suspended", "request-submitted",
  "department-approval-required", "company-approval-required",
  "axora-approval-required", "request-approved", "request-rejected",
  "request-returned-for-changes", "request-cancelled",
  "additional-actual-approval-required", "budget-low", "budget-zero",
  "budget-refreshed", "budget-refresh-failed", "delivery-assignment-created",
  "delivery-agent-accepted", "shopping-started", "items-acquired",
  "substitute-approval-required", "out-for-delivery", "delivery-arrived",
  "failed-delivery-rescheduled", "delivery-completed",
  "approved-request-pdf-available", "final-delivery-pdf-available",
  "supplier-purchase-order-ready",
];

describe("P0-09 versioned email template catalogue", () => {
  it("registers every required initial purpose with portable policy metadata", () => {
    expect(Object.keys(EMAIL_TEMPLATE_CATALOGUE)).toEqual(
      expect.arrayContaining(REQUIRED_TEMPLATES),
    );
    for (const key of REQUIRED_TEMPLATES) {
      const template = emailTemplateDefinition(key);
      expect(template).toMatchObject({
        key,
        version: 1,
        supportedLocales: ["en", "ar", "ms"],
        tracking: { opens: false, clicks: false },
      });
      expect(template.subjects.en).toBeTruthy();
      expect(template.subjects.ar).toBeTruthy();
      expect(template.subjects.ms).toBeTruthy();
      expect(template.requiredVariables.length).toBeGreaterThan(0);
    }
  });

  it.each(["en", "ar", "ms"])("renders %s workflow HTML and plain text", async (locale) => {
    const rendered = await renderTransactionalEmail({
      deliveryId: "10000000-0000-4000-8000-000000000901",
      messageKind: "WORKFLOW_UPDATE",
      locale,
      recipientEmail: "approver@example.test",
      recipientName: "Approval Reviewer",
      templateKey: "company-approval-required",
      workflow: {
        title: "Request AX-2026-104 requires approval",
        body: "Sign in to review the current request snapshot.",
        actionPath: "/requests/10000000-0000-4000-8000-000000000902",
      },
    });
    expect(rendered.templateKey).toBe("company-approval-required");
    expect(rendered.templateVersion).toBe(1);
    expect(rendered.providerAgent).toBe("axora-procurement");
    expect(rendered.subject).toBe(
      EMAIL_TEMPLATE_CATALOGUE["company-approval-required"].subjects[locale],
    );
    expect(rendered.html).toContain("Request AX-2026-104");
    expect(rendered.text).toContain("Request AX-2026-104");
    expect(rendered.text).toContain("https://axora.management/requests/");
  });
});
