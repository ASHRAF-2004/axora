import { describe, expect, it } from "vitest";
import { renderAccountSetupEmail } from "../server-tools/account-setup-email.mjs";

describe("platform owner setup email", () => {
  it("uses Axora brand context without inventing a tenant", async () => {
    const rendered = await renderAccountSetupEmail({
      recipientName: "First Owner",
      recipientEmail: "first.owner@example.test",
      companyName: "Axora",
      role: "PLATFORM_OWNER",
      expiresAt: "2026-08-03T06:00:00.000Z",
      setupUrl: "https://axora.management/account/setup#token=abcdefghijklmnopqrstuvwxyzABCDEFGH123456789",
      locale: "en",
    }, {
      appBaseUrl: "https://axora.management",
      supportEmail: "support@axora.management",
    });

    expect(rendered.text).toContain("Welcome to Axora");
    expect(rendered.text).toContain("Role: Axora platform owner");
    expect(rendered.text).not.toContain("Axora on Axora");
    expect(rendered.html).toContain("Finish setting up your Axora platform owner account.");
  });
});
