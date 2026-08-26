import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("delivery execution role interfaces", () => {
  it("keeps versioned offline commands, buying progress, proof and recipient OTP visible", async () => {
    const [driver, trackingPanel, destinationMap, availableJobs, receiver, styles, copy] = await Promise.all([
      readFile(new URL("../src/components/role-portals/DeliveryExecutionPanel.tsx", import.meta.url), "utf8"),
      readFile(new URL("../src/components/role-portals/DeliveryTrackingPanels.tsx", import.meta.url), "utf8"),
      readFile(new URL("../src/components/role-portals/DeliveryDestinationMap.tsx", import.meta.url), "utf8"),
      readFile(new URL("../src/components/role-portals/AvailableDeliveryJobs.tsx", import.meta.url), "utf8"),
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
    expect(driver).toContain("/api/driver/acquisition");
    expect(driver).toContain("copy.customerPriceFixed");
    expect(driver).toContain("actualInternalUnitCost");
    expect(driver).toContain("UNAVAILABLE");
    expect(driver).toContain("/api/driver/proof");
    expect(driver).toContain('<option key={type} value={type}>{deliveryProofTypeLabel(type, initialLocale)}</option>');
    expect(driver).toContain("/api/driver/otp");
    expect(driver).toContain("/api/driver/command-result");
    expect(driver).toContain("authoritativeJobResult");
    expect(driver).toContain("readCommandResult");
    expect(driver).toContain("void refreshAfterCommit()");
    expect(driver).toContain('new CustomEvent("axora:delivery-terminal"');
    expect(driver).toContain('["DELIVERED", "PARTIALLY_DELIVERED", "COMPLETED"].includes(type) && !job.proofSatisfied');
    expect(trackingPanel).toContain("DeliveryDestinationMap");
    expect(driver).toContain('"OUT_FOR_DELIVERY"');
    expect(driver).toContain("destinationLatitude");
    expect(destinationMap).toContain("buildDeliveryNavigationLinks");
    expect(destinationMap).toContain("links.waze");
    expect(destinationMap).toContain("links.googleMaps");
    expect(destinationMap).toContain("OPERATIONAL_MAP_CONFIG_URL");
    expect(destinationMap).toContain('"line-dasharray"');
    expect(copy).toContain("Direct distance estimate");
    expect(availableJobs).toContain("/api/driver/jobs");
    expect(availableJobs).toContain("This job was already claimed.");
    expect(availableJobs).toContain("crypto.randomUUID()");
    expect(availableJobs).toContain("commitClaim(result)");
    expect(availableJobs).toContain("Claim succeeded. Refreshing delivery workspace");
    expect(availableJobs).not.toContain("window.location.reload");
    expect(availableJobs).not.toContain("driverRoleAssignmentId");
    expect(receiver).toContain("oneTimeWarning");
    expect(styles).toContain("border-inline-start");
    expect(styles).toContain("prefers-reduced-motion: no-preference");
    expect(styles).toContain("min-height: 44px");
    expect(styles).toContain(":focus-visible");
    expect(copy).toContain("ar:");
    expect(copy).toContain("ms:");
    expect(copy).toContain('legacyWaitingOne: "{count} saved update is waiting"');
  });
});
