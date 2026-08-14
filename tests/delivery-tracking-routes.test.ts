import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("delivery tracking route boundaries", () => {
  it("enforces role gates, bounded bodies and non-revealing failures", async () => {
    const [driver, ownerLive, company] = await Promise.all([
      readFile(new URL(
        "../src/app/api/driver/tracking/route.ts",
        import.meta.url,
      ), "utf8"),
      readFile(new URL(
        "../src/app/api/drivers/[driverId]/live/route.ts",
        import.meta.url,
      ), "utf8"),
      readFile(new URL(
        "../src/app/api/receiving/delivery-tracking/route.ts",
        import.meta.url,
      ), "utf8"),
    ]);
    expect(driver).toContain('canAccess(actor, "update_assigned_deliveries")');
    expect(driver).toContain("16_384");
    expect(ownerLive).toContain('canAccess(actor, "manage_deliveries")');
    expect(ownerLive).toContain("snapshotEventStream");
    expect(company).toContain('canAccess(actor, "view_receiving")');
    expect(company).toContain('canAccess(actor, "view_deliveries")');
    for (const source of [driver, company]) {
      expect(source).toContain('"Cache-Control": "private, no-store"');
      expect(source).not.toMatch(/console\.(log|error)|latitude.*error|longitude.*error/);
    }
  });
});
