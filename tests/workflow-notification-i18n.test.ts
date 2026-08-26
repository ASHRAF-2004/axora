import { describe, expect, it } from "vitest";
import {
  normalizeNotificationLocale,
  renderWorkflowNotification,
} from "@/lib/workflow-notification-i18n";

describe("workflow notification localization", () => {
  it("renders reviewed English, Arabic, and Malay notification content", () => {
    expect(renderWorkflowNotification({ key: "delivery_scheduled" }, "en").title)
      .toBe("Delivery scheduled");
    expect(renderWorkflowNotification({ key: "delivery_scheduled" }, "ar").title)
      .toBe("تمت جدولة التسليم");
    expect(renderWorkflowNotification({ key: "delivery_scheduled" }, "ms").title)
      .toBe("Penghantaran dijadualkan");
  });

  it("localizes bounded dynamic status and delivery identifiers", () => {
    expect(renderWorkflowNotification({
      key: "driver_delivery_status",
      jobCode: "DEL-2048",
      status: "ARRIVED",
    }, "ar").body).toBe("انتقل التسليم DEL-2048 إلى حالة: وصل مسؤول التوصيل.");
    expect(renderWorkflowNotification({
      key: "request_status_updated",
      status: "Preparing for Delivery",
    }, "ms").body).toContain("sedang disediakan untuk penghantaran");
  });

  it("localizes supplier RFQs and independent receiving prompts", () => {
    expect(renderWorkflowNotification({
      key: "supplier_rfq_issued",
      reference: "RFQ-2048",
    }, "ms").body).toContain("RFQ-2048");
    expect(renderWorkflowNotification({
      key: "receipt_required",
      jobCode: "DEL-2048",
    }, "ar").title).toBe("تأكيد الاستلام مطلوب");
  });

  it("renders a bounded activation notice for the invitation issuer", () => {
    expect(renderWorkflowNotification({
      key: "invitation_accepted",
      accountName: "Amina Rahman",
    }, "en")).toEqual({
      title: "Invited account activated",
      body: "Amina Rahman completed account setup and can now sign in.",
    });
    expect(renderWorkflowNotification({
      key: "invitation_accepted",
      accountName: "Amina Rahman",
    }, "ar").title).toBe("تم تفعيل الحساب المدعو");
    expect(() => renderWorkflowNotification({
      key: "invitation_accepted",
      accountName: "Amina\nBcc: hidden@example.test",
    }, "en")).toThrow("invalid");
  });

  it("does not expose unknown internal match codes", () => {
    const rendered = renderWorkflowNotification({
      key: "three_way_match_exception",
      exceptionCodes: ["PRIVATE_INTERNAL_DETAIL"],
    }, "en");
    expect(rendered.body).not.toContain("PRIVATE_INTERNAL_DETAIL");
    expect(rendered.body).toContain("finance review");
  });

  it("uses English for unsupported stored locale values and rejects control characters", () => {
    expect(normalizeNotificationLocale("fr")).toBe("en");
    expect(() => renderWorkflowNotification({
      key: "driver_assigned",
      jobCode: "DEL-1\nBcc: attacker@example.test",
    }, "en")).toThrow("invalid");
  });
});
