import { readFile, stat } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { renderAccountSetupEmail } from "../server-tools/account-setup-email.mjs";

const invitation = {
  recipientName: "Aisha Rahman",
  recipientEmail: "aisha@example.com",
  companyName: "Example Industries",
  role: "APPROVER",
  branchName: "Kuala Lumpur",
  expiresAt: "2026-08-03T06:00:00.000Z",
  setupUrl: "https://axora.management/account/setup#token=abcdefghijklmnopqrstuvwxyzABCDEFGH123456789",
};

describe("account setup email", () => {
  it("renders a complete multipart-safe invitation without third-party assets", async () => {
    const result = await renderAccountSetupEmail(invitation, {
      appBaseUrl: "https://axora.management",
      supportEmail: "support@axora.management",
    });

    expect(result.subject).toBe("Finish setting up your Axora account");
    expect(result.html).toContain("Hello Aisha Rahman,");
    expect(result.html).toContain("Create my password");
    expect(result.html).toContain("cid:axora-logo");
    expect(result.html).toContain("cid:account-envelope");
    expect(result.html).not.toMatch(/{{[A-Z0-9_]+}}/);
    expect(result.html).not.toContain("imgdist.com");
    expect(result.html).not.toContain("getbee.io");
    expect(result.html).not.toContain("TEMPORARY_PASSWORD");
    expect(result.text).toContain(invitation.setupUrl);
    expect(result.text).toContain("one-time link");
    expect(result.text).toContain("Support email: support@axora.management");
    expect(result.text).toContain("Login: https://axora.management/login");
    expect(result.text).toContain("Privacy: https://axora.management/en/privacy");
    expect(result.html).toContain("https://axora.management/en/privacy");
    expect(result.html).toContain("https://axora.management/en/help");
  });

  it("escapes tenant-controlled text and rejects a setup URL outside Axora", async () => {
    const escaped = await renderAccountSetupEmail({
      ...invitation,
      recipientName: '<img src=x onerror="alert(1)">',
      companyName: "A & B <Holdings>",
    }, { appBaseUrl: "https://axora.management", supportEmail: "support@axora.management" });
    expect(escaped.html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(escaped.html).toContain("A &amp; B &lt;Holdings&gt;");
    expect(escaped.html).not.toContain("<img src=x onerror");

    await expect(renderAccountSetupEmail({
      ...invitation,
      setupUrl: "https://attacker.example/account/setup#token=abcdefghijklmnopqrstuvwxyzABCDEFGH123456789",
    }, { appBaseUrl: "https://axora.management" })).rejects.toThrow(/Axora HTTPS origin/);

    await expect(renderAccountSetupEmail({
      ...invitation,
      setupUrl: "https://axora.management/account/setup?token=abcdefghijklmnopqrstuvwxyzABCDEFGH123456789",
    }, { appBaseUrl: "https://axora.management" })).rejects.toThrow(/private Axora setup link/);
  });

  it("renders validated Arabic copy and rejects unsupported locales", async () => {
    const arabic = await renderAccountSetupEmail({
      ...invitation,
      locale: "ar",
    }, { appBaseUrl: "https://axora.management", supportEmail: "support@axora.management" });
    expect(arabic.subject).toBe("أكمل إعداد حسابك في Axora");
    expect(arabic.html).toContain('lang="ar" dir="rtl"');
    expect(arabic.html).toContain("إنشاء كلمة المرور");
    expect(arabic.html).toContain("https://axora.management/ar/privacy");
    expect(arabic.text).toContain(invitation.setupUrl);

    await expect(renderAccountSetupEmail({
      ...invitation,
      locale: "unsupported",
    })).rejects.toThrow(/locale is invalid/i);
  });

  it("renders Malay invitations for every canonical role", async () => {
    const roles = [
      "PLATFORM_OWNER", "PLATFORM_OPERATIONS", "COMPANY_ADMIN",
      "BRANCH_ADMIN", "BRANCH_APPROVER", "COMPANY_APPROVER", "REQUESTER",
      "FINANCE_REVIEWER", "AUDITOR", "TECHNICAL_SUPPORT",
      "DELIVERY_DRIVER", "RECEIVING_USER",
    ];
    for (const role of roles) {
      const rendered = await renderAccountSetupEmail({
        ...invitation,
        role,
        locale: "ms",
      }, { appBaseUrl: "https://axora.management", supportEmail: "support@axora.management" });
      expect(rendered.subject).toBe("Selesaikan persediaan akaun Axora anda");
      expect(rendered.html).toContain('lang="ms" dir="ltr"');
      expect(rendered.html).toContain(role === "PLATFORM_OWNER" ? "Axora" : "Example Industries");
      expect(rendered.text).toContain(invitation.setupUrl);
    }
  });

  it("keeps the optimized template and images within their loading budgets", async () => {
    const template = await readFile(new URL("../email-templates/account-setup.html", import.meta.url), "utf8");
    const logo = await stat(new URL("../public/brand/axora-email.png", import.meta.url));
    const illustration = await stat(new URL("../public/email/account-setup/account-envelope.png", import.meta.url));
    expect(Buffer.byteLength(template)).toBeLessThan(8 * 1024);
    expect(logo.size + illustration.size).toBeLessThan(24 * 1024);
  });

  it("retains the Word namespace required by the Outlook VML action", async () => {
    const result = await renderAccountSetupEmail(invitation, {
      appBaseUrl: "https://axora.management",
      supportEmail: "support@axora.management",
    });
    expect(result.html).toContain('xmlns:w="urn:schemas-microsoft-com:office:word"');
    expect(result.html).toContain("<w:anchorlock/>");
  });
});
