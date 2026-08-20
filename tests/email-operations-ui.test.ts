import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("transactional email operations interface", () => {
  it("keeps reads, commands, and recipient reveal behind explicit server boundaries", async () => {
    const [page, actions, service, reveal] = await Promise.all([
      readFile(new URL("../src/app/(portal)/email-operations/page.tsx", import.meta.url), "utf8"),
      readFile(new URL("../src/app/(portal)/email-operations/actions.ts", import.meta.url), "utf8"),
      readFile(new URL("../src/lib/email-operations.ts", import.meta.url), "utf8"),
      readFile(new URL("../src/components/EmailRecipientReveal.tsx", import.meta.url), "utf8"),
    ]);

    expect(page).toContain('requirePagePermission("view_email_operations")');
    expect(page).toContain("EmailRecipientReveal");
    expect(actions).toContain("executeEmailOperationsCommand");
    expect(actions).toContain("revealEmailRecipientAction");
    expect(service).toContain("function requireView(actor: SessionUser)");
    expect(service).toContain("function requireManage(actor: SessionUser)");
    expect(service).toContain("axora_email_operations_snapshot");
    expect(service).toContain("axora_email_operations_command");
    expect(reveal).toContain("useActionState");
    expect(reveal).not.toContain("localStorage");
  });

  it("ships English, Arabic, and Malay Resend operations copy with logical responsive styling", async () => {
    const [page, messages, styles, robots] = await Promise.all([
      readFile(new URL("../src/app/(portal)/email-operations/page.tsx", import.meta.url), "utf8"),
      readFile(new URL("../src/lib/email-operations-i18n.ts", import.meta.url), "utf8"),
      readFile(new URL("../src/app/(portal)/email-operations/EmailOperations.module.css", import.meta.url), "utf8"),
      readFile(new URL("../src/app/robots.ts", import.meta.url), "utf8"),
    ]);

    expect(messages).toContain("Transactional email operations");
    expect(messages).toContain("Delivery stream controls");
    expect(messages).toContain("Resend runtime readiness");
    expect(messages).toMatch(/[\u0600-\u06ff]/u);
    expect(messages).toContain("Operasi e-mel transaksi");
    expect(page).toContain("Resend");
    expect(page).not.toContain("remaining credits");
    expect(styles).toContain("border-inline-start");
    expect(styles).toContain("@media (max-width:");
    expect(styles).toContain("prefers-reduced-motion: reduce");
    expect(styles).not.toMatch(/(?:margin|padding|border)-(?:left|right)|(?:left|right):/);
    expect(robots).toContain('"/email-operations"');
  });

  it("records only normalized Resend webhook failure evidence", async () => {
    const route = await readFile(
      new URL("../src/app/api/email/provider-events/resend/route.ts", import.meta.url),
      "utf8",
    );
    expect(route).toContain("recordEmailWebhookProcessingFailure");
    expect(route).toContain('"resend"');
    expect(route).not.toContain("console.log(payload");
    expect(route).not.toContain("JSON.stringify(payload");
  });
});
