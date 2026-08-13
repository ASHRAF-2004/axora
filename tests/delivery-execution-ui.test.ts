import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("delivery execution role interfaces", () => {
  it("keeps versioned offline commands, buying progress, proof and recipient OTP visible", async () => {
    const [driver, supervisor, receiver, styles, copy] = await Promise.all([
      readFile(new URL("../src/components/role-portals/DeliveryExecutionPanel.tsx", import.meta.url), "utf8"),
      readFile(new URL("../src/components/role-portals/DeliverySupervisorPanel.tsx", import.meta.url), "utf8"),
      readFile(new URL("../src/components/role-portals/ReceivingOtpPanel.tsx", import.meta.url), "utf8"),
      readFile(new URL("../src/components/role-portals/DeliveryExecution.module.css", import.meta.url), "utf8"),
      readFile(new URL("../src/lib/delivery-workflow-i18n.ts", import.meta.url), "utf8"),
    ]);
    expect(driver).toContain("expectedVersion");
    expect(driver).toContain("commandId");
    expect(driver).toContain("copy.queueLimit");
    expect(copy).toContain('queueLimit: "Offline command queue limit reached.\"');
    expect(driver).toContain("axora-delivery-command-recovery.json");
    expect(driver).toContain("/api/driver/workflow");
    expect(driver).toContain("SHOPPING_STARTED");
    expect(driver).toContain("ITEMS_ACQUIRED");
    expect(driver).not.toContain("/api/driver/shopping");
    expect(driver).toContain("/api/driver/proof");
    expect(driver).toContain("/api/driver/otp");
    expect(supervisor).toContain("branchTimezone");
    expect(supervisor).toContain("proofPolicy");
    expect(supervisor).toContain("activeJobs");
    expect(receiver).toContain("oneTimeWarning");
    expect(styles).toContain("border-inline-start");
    expect(styles).toContain("prefers-reduced-motion: no-preference");
    expect(copy).toContain("ar:");
    expect(copy).toContain("ms:");
  });
});
