import type { SupportedLocale } from "./i18n";

const INTERNAL_PREPARATION_PREFIXES = ["quotation.", "supplier.", "sourcing.", "three_way_match."] as const;
const INTERNAL_DELIVERY_EVENTS = new Set([
  "driver.assigned",
  "driver.assignment_rejected",
  "delivery.accepted",
  "delivery.arrived",
  "delivery.attempted",
  "delivery.issue_reported",
  "delivery.note_added",
]);

export function customerNotificationKind(eventKey: string): "PREPARATION" | "DELIVERY" | null {
  if (INTERNAL_PREPARATION_PREFIXES.some((prefix) => eventKey.startsWith(prefix))) return "PREPARATION";
  if (eventKey.startsWith("driver.") || INTERNAL_DELIVERY_EVENTS.has(eventKey)) return "DELIVERY";
  return null;
}

export function customerNotificationPresentation(eventKey: string, locale: SupportedLocale) {
  const kind = customerNotificationKind(eventKey);
  if (!kind) return null;
  if (kind === "PREPARATION") {
    if (locale === "ar") return { eventKey: "preparation.started", category: "WORKFLOW" as const, title: "تحديث تجهيز الطلب", body: "تقوم أكسورا بتجهيز طلبك. افتح الطلب للاطلاع على أحدث حالة متاحة للعميل." };
    if (locale === "ms") return { eventKey: "preparation.started", category: "WORKFLOW" as const, title: "Kemas kini penyediaan pesanan", body: "Axora sedang menyediakan pesanan anda. Buka permintaan untuk status pelanggan terkini." };
    return { eventKey: "preparation.started", category: "WORKFLOW" as const, title: "Order preparation update", body: "Axora is preparing your order. Open the request for the latest customer-visible status." };
  }
  if (locale === "ar") return { eventKey: "delivery.updated", category: "DELIVERY" as const, title: "تحديث التسليم", body: "تم تحديث حالة التسليم. افتح الطلب للاطلاع على أحدث حالة متاحة للعميل." };
  if (locale === "ms") return { eventKey: "delivery.updated", category: "DELIVERY" as const, title: "Kemas kini penghantaran", body: "Status penghantaran telah dikemas kini. Buka permintaan untuk status pelanggan terkini." };
  return { eventKey: "delivery.updated", category: "DELIVERY" as const, title: "Delivery update", body: "Your delivery status was updated. Open the request for the latest customer-visible status." };
}

export const customerNotificationPrivacyInternals = {
  INTERNAL_DELIVERY_EVENTS,
  INTERNAL_PREPARATION_PREFIXES,
};
