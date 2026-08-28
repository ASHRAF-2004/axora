import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("authenticated production route stabilization", () => {
  it("keeps the retired organization hierarchy out of the MVP", async () => {
    const source = await readFile(new URL(
      "../src/app/(portal)/branches/organization/page.tsx",
      import.meta.url,
    ), "utf8");
    expect(source).toContain('permanentRedirect("/branches")');
    expect(source).not.toMatch(/Department|Business unit|Cost centre|StatusForm/);
  });

  it("serves a read-only company delivery view without granting supervisor controls", async () => {
    const source = await readFile(new URL(
      "../src/app/(portal)/deliveries/page.tsx",
      import.meta.url,
    ), "utf8");
    expect(source).toContain('requirePagePermission("view_deliveries")');
    expect(source).toContain('canAccess(actor, "manage_deliveries")');
    expect(source).toContain("<DeliveryTrackingBoard");
    expect(source).not.toContain("audience=");
    expect(source).toContain("<ManageDriversPanel");
    expect(source).not.toContain("DeliverySupervisorPanel");
  });

  it("keeps the transactional outbox provider-agent guard contiguous", async () => {
    const source = await readFile(new URL(
      "../src/lib/transactional-email.ts",
      import.meta.url,
    ), "utf8");
    const completionStart = source.indexOf("completeTransactionalEmailOutbox");
    const update = source.slice(
      source.indexOf("UPDATE transactional_email_outbox", completionStart),
      source.indexOf("SELECT axora_record_transactional_email_attempt", completionStart),
    );
    expect(update).toContain("provider_agent=$7");
    expect(update).not.toContain("$8");
  });
});
