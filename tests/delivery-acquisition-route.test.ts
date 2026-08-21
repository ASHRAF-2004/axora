import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("paid delivery acquisition boundary", () => {
  it("uses exact assignment authorization and never calls payment or legacy actual mutation", async () => {
    const [route, service] = await Promise.all([
      readFile(new URL("../src/app/api/driver/acquisition/route.ts", import.meta.url), "utf8"),
      readFile(new URL("../src/lib/delivery-execution.ts", import.meta.url), "utf8"),
    ]);
    expect(route).toContain('canAccess(actor, "update_assigned_deliveries")');
    expect(route).toContain("MAX_ACQUISITION_BODY_BYTES = 6 * 1024 * 1024");
    expect(route).toContain("request.body.getReader()");
    expect(route).toContain("await reader.cancel()");
    expect(route).toContain("AcquisitionBodyTooLarge");
    expect(route).toContain('"Cache-Control": "no-store"');
    const implementation = service.slice(
      service.indexOf("export async function recordPaidDeliveryAcquisition"),
      service.indexOf("export async function uploadCanonicalDeliveryEvidence"),
    );
    expect(implementation).toContain("axora_register_delivery_acquisition");
    expect(implementation).toContain("axora_record_delivery_event");
    expect(implementation).toContain('namespace: "delivery-receipts"');
    expect(implementation).not.toContain("axora_submit_request_actual");
    expect(implementation).not.toContain("axora_approve_and_pay");
    expect(implementation).not.toContain("wallet");
    expect(implementation).not.toContain("return registration;");
  });
});
