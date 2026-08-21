import { describe, expect, it } from "vitest";
import { renderTransactionalEmail } from "../server-tools/transactional-email.mjs";

const deliveryId = "00000000-0000-4000-8000-000000000001";
const token = "D".repeat(43);

describe("trusted transactional email renderer", () => {
  it("renders a contact notification without exposing the monitored recipient in content", async () => {
    const rendered = await renderTransactionalEmail({
      deliveryId,
      messageKind: "CONTACT_NOTIFICATION",
      locale: "en",
      recipientEmail: "private-support-inbox@example.test",
      recipientName: "Axora contact team",
      replyToEmail: "sender@example.test",
      contact: {
        name: "Aisha <script>alert(1)</script>",
        email: "sender@example.test",
        company: "Example & Company",
        phone: "+60 12 345 6789",
        subject: "Procurement <review>",
        message: "First line\n<img src=x onerror=alert(1)>",
        submittedAt: "2026-08-03T06:00:00.000Z",
      },
    });

    expect(rendered.subject).toBe("New Axora website enquiry");
    expect(rendered.subject).not.toContain("Procurement");
    expect(rendered.html).toContain("Procurement &lt;review&gt;");
    expect(rendered.replyToEmail).toBe("sender@example.test");
    expect(rendered.html).toContain("Aisha &lt;script&gt;alert(1)&lt;/script&gt;");
    expect(rendered.html).toContain("Example &amp; Company");
    expect(rendered.html).toContain("First line<br>&lt;img src=x onerror=alert(1)&gt;");
    expect(rendered.html).not.toContain("<script>");
    expect(rendered.html).not.toContain("private-support-inbox@example.test");
    expect(rendered.text).not.toContain("private-support-inbox@example.test");
    expect(rendered.text).toContain("Axora support: support@axora.management");
    expect(rendered.templateKey).toBe("contact-notification");
  });

  it("renders an enquiry notification without an invented contact address", async () => {
    const rendered = await renderTransactionalEmail({
      deliveryId,
      messageKind: "CONTACT_NOTIFICATION",
      locale: "en",
      recipientEmail: "private-support-inbox@example.test",
      recipientName: "Axora contact team",
      contact: {
        name: "Aisha Rahman",
        company: "Example & Company",
        subject: "Procurement review",
        message: "Please review this company enquiry.",
        submittedAt: "2026-08-03T06:00:00.000Z",
      },
    });

    expect(rendered.html).not.toContain("undefined");
    expect(rendered.text).not.toContain("undefined");
    expect(rendered.replyToEmail).toBe("support@axora.management");
    expect(rendered.text).not.toContain("Email:");
  });

  it.each([
    ["en", "We received your Axora company enquiry", 'lang="en" dir="ltr"'],
    ["ar", "استلمنا استفسار شركتك لدى Axora", 'lang="ar" dir="rtl"'],
    ["ms", "Kami menerima pertanyaan syarikat Axora anda", 'lang="ms" dir="ltr"'],
  ])("renders a privacy-safe %s visitor acknowledgement", async (locale, subject, direction) => {
    const rendered = await renderTransactionalEmail({
      deliveryId,
      messageKind: "CONTACT_ACKNOWLEDGEMENT",
      locale,
      recipientEmail: "sender@example.test",
      recipientName: "Aisha Rahman",
      contact: {
        name: "Aisha Rahman",
        email: "sender@example.test",
        company: "Example & Company",
        subject: "Procurement <review>",
        message: "Sensitive details must not be echoed in the acknowledgement.",
        submittedAt: "2026-08-03T06:00:00.000Z",
      },
    });
    expect(rendered.subject).toBe(subject);
    expect(rendered.html).toContain(direction);
    expect(rendered.html).toContain("Example &amp; Company");
    expect(rendered.html).toContain("Procurement &lt;review&gt;");
    expect(rendered.html).not.toContain("Sensitive details");
    expect(rendered.text).not.toContain("Sensitive details");
    expect(rendered.replyToEmail).toBe("support@axora.management");
    expect(rendered.templateKey).toBe("contact-acknowledgement");
  });

  it.each([
    ["PASSWORD_RESET", "/account/reset-password", "Reset your Axora password"],
    ["EMAIL_VERIFICATION", "/account/verify-email", "Verify your Axora email address"],
  ])("renders a single-origin fragment action for %s", async (messageKind, path, subject) => {
    const rendered = await renderTransactionalEmail({
      deliveryId,
      messageKind,
      locale: "en",
      recipientEmail: "person@example.test",
      recipientName: "Aisha Rahman",
      expiresAt: "2026-08-03T06:00:00.000Z",
      actionUrl: `https://axora.management${path}#token=${token}`,
    }, { appBaseUrl: "https://axora.management" });
    expect(rendered.subject).toBe(subject);
    expect(rendered.html).toContain(`https://axora.management${path}#token=${token}`);
    expect(rendered.text).toContain(`https://axora.management${path}#token=${token}`);
    expect(rendered.html).toContain('src="cid:axora-logo"');
    expect(rendered.text).toContain("Axora support: support@axora.management");
  });

  it("renders a tokenless password-change confirmation", async () => {
    const rendered = await renderTransactionalEmail({
      deliveryId,
      messageKind: "PASSWORD_CHANGED",
      locale: "en",
      recipientEmail: "person@example.test",
      recipientName: "Aisha Rahman",
    });
    expect(rendered.subject).toBe("Your Axora password was changed");
    expect(rendered.text).toContain("prior sessions were ended");
    expect(rendered.html).not.toContain("token=");
    expect(rendered.templateKey).toBe("password-changed");
  });

  it("supports Arabic and Malay copy and rejects off-origin action URLs", async () => {
    const arabic = await renderTransactionalEmail({
      deliveryId,
      messageKind: "PASSWORD_RESET",
      locale: "ar",
      recipientEmail: "person@example.test",
      recipientName: "Aisha Rahman",
      expiresAt: "2026-08-03T06:00:00.000Z",
      actionUrl: `https://axora.management/account/reset-password#token=${token}`,
    });
    expect(arabic.html).toContain('lang="ar" dir="rtl"');
    expect(arabic.subject).toContain("إعادة تعيين");

    const malay = await renderTransactionalEmail({
      deliveryId,
      messageKind: "EMAIL_VERIFICATION",
      locale: "ms",
      recipientEmail: "person@example.test",
      recipientName: "Aisha Rahman",
      expiresAt: "2026-08-03T06:00:00.000Z",
      actionUrl: `https://axora.management/account/verify-email#token=${token}`,
    });
    expect(malay.html).toContain('lang="ms" dir="ltr"');
    expect(malay.subject).toContain("Sahkan");

    await expect(renderTransactionalEmail({
      deliveryId,
      messageKind: "PASSWORD_RESET",
      locale: "en",
      recipientEmail: "person@example.test",
      recipientName: "Aisha Rahman",
      expiresAt: "2026-08-03T06:00:00.000Z",
      actionUrl: `https://attacker.example/account/reset-password#token=${token}`,
    })).rejects.toThrow(/action URL/i);
  });

  it("rejects header control characters while preserving safe message line breaks", async () => {
    await expect(renderTransactionalEmail({
      deliveryId,
      messageKind: "CONTACT_NOTIFICATION",
      locale: "en",
      recipientEmail: "private-support-inbox@example.test",
      recipientName: "Axora contact team",
      contact: {
        name: "Aisha Rahman",
        email: "sender@example.test",
        company: "Example Company",
        subject: "Request\r\nBcc: attacker@example.test",
        message: "First safe line\nSecond safe line",
        submittedAt: "2026-08-03T06:00:00.000Z",
      },
    })).rejects.toThrow(/subject is invalid/i);
  });
});
