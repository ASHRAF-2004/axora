import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("authenticated production route stabilization", () => {
  it("keeps organization status forms at stable module scope", async () => {
    const source = await readFile(new URL(
      "../src/app/(portal)/branches/organization/page.tsx",
      import.meta.url,
    ), "utf8");
    expect(source.indexOf("function StatusForm")).toBeLessThan(
      source.indexOf("export default async function OrganizationPage"),
    );
    expect(source).toContain("<StatusForm copy={copy}");
    expect(source).not.toContain("style={{");
    expect(source).toContain("data-depth={depth(");
    expect(source).toContain('className="detail-grid organization-branch-actions"');
    expect(source).not.toContain("<td><details><summary>{copy.edit}</summary>");
    expect(source).toContain("<DeferredOrganizationActions label={copy.update}><form");
    expect(source).toContain("<DeferredOrganizationActions label={copy.update}><section");

    const deferredSource = await readFile(new URL(
      "../src/components/DeferredOrganizationActions.tsx",
      import.meta.url,
    ), "utf8");
    expect(deferredSource).toContain('"use client"');
    expect(deferredSource).toContain("useSyncExternalStore");
    expect(deferredSource).toContain("if (!ready)");
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
    const update = source.slice(
      source.indexOf("UPDATE transactional_email_outbox", source.indexOf("async function finalize")),
      source.indexOf("INSERT INTO email_delivery_attempts", source.indexOf("async function finalize")),
    );
    expect(update).toContain("provider_agent=$7");
    expect(update).not.toContain("$8");
  });
});
