import { describe, expect, it } from "vitest";
import { customerNotificationKind, customerNotificationPresentation } from "@/lib/customer-notification-privacy";

describe("customer notification privacy", () => {
  it.each([
    "quotation.requested",
    "quotation.received",
    "supplier.selected",
    "supplier.order_selected",
    "sourcing.updated",
    "three_way_match.completed",
  ])("maps internal preparation event %s to neutral customer copy", (eventKey) => {
    const value = customerNotificationPresentation(eventKey, "en");
    expect(value).toMatchObject({ eventKey: "preparation.started", category: "WORKFLOW" });
    expect(JSON.stringify(value)).not.toMatch(/supplier|quotation|buying|purchasing|three.way/i);
  });

  it.each(["driver.assigned", "driver.assignment_rejected", "delivery.accepted", "delivery.arrived", "delivery.note_added"])(
    "maps internal delivery event %s to neutral customer copy",
    (eventKey) => {
      const value = customerNotificationPresentation(eventKey, "ms");
      expect(value).toMatchObject({ eventKey: "delivery.updated", category: "DELIVERY" });
      expect(JSON.stringify(value)).not.toMatch(/driver|pemandu|buying|purchasing/i);
    },
  );

  it("does not rewrite customer-safe lifecycle events", () => {
    expect(customerNotificationKind("delivery.out_for_delivery")).toBeNull();
    expect(customerNotificationPresentation("invoice.issued", "ar")).toBeNull();
  });
});
