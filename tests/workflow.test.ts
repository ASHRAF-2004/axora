import { describe, expect, it } from "vitest";
import { getDemoStore } from "@/lib/demo-data";
import { updateRequestStatus } from "@/lib/repository";
import { allowedNextStatuses } from "@/lib/workflow";

const owner = {
  id: "demo-owner",
  email: "owner@axora.local",
  name: "Axora owner",
  role: "ADMIN" as const,
  isOwner: true,
};

describe("customer-approved procurement workflow", () => {
  it("uses one company approval before payment and delivery", () => {
    expect(allowedNextStatuses("New Request")).not.toContain("On Hold");
    expect(allowedNextStatuses("Under Verification")).not.toContain("Waiting for Approval");
    expect(allowedNextStatuses("Under Verification")).toContain("On Hold");
    expect(allowedNextStatuses("Waiting for Quotation")).toContain("Approved");
    expect(allowedNextStatuses("Waiting for Quotation")).not.toContain("Waiting for Approval");
    expect(allowedNextStatuses("Waiting for Quotation")).not.toContain("On Hold");
  });

  it("keeps retired approval statuses usable for historical requests", () => {
    expect(allowedNextStatuses("Waiting for Approval")).toContain("Approved");
    expect(allowedNextStatuses("Approved")).toContain("Preparing for Delivery");
  });

  it("blocks every owner status action until the company approves the request", async () => {
    const request = getDemoStore().requests.find((item) =>
      item.status === "New Request" && item.approvalStatus === "Pending",
    );
    expect(request).toBeDefined();

    await expect(updateRequestStatus(
      request!.id,
      "Under Verification",
      undefined,
      owner,
    )).rejects.toThrow("The company must approve this request before Axora starts fulfillment.");
    await expect(updateRequestStatus(
      request!.id,
      "Cancelled",
      "Attempted owner cancellation",
      owner,
    )).rejects.toThrow("The company must approve this request before Axora starts fulfillment.");

    expect(request!.status).toBe("New Request");
  });
});
