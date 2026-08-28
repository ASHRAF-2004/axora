import type { ReceiptDiscrepancyCode } from "./receiving";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DISCREPANCY_CODES = ["NONE", "DAMAGED", "SHORT", "OVER", "WRONG_ITEM", "QUALITY", "OTHER"] as const;

function quantity(value: FormDataEntryValue | undefined, label: string, defaultValue?: number) {
  const text = value === undefined ? "" : String(value).trim();
  if (!text && defaultValue !== undefined) return defaultValue;
  const parsed = Number(text);
  if (!text || !Number.isFinite(parsed) || parsed < 0) throw new Error(`${label} must be a non-negative number.`);
  return parsed;
}

export function parseReceiptConfirmationForm(formData: FormData) {
  const deliveryJobId = String(formData.get("deliveryJobId") ?? "");
  if (!UUID_PATTERN.test(deliveryJobId)) throw new Error("Receiving job is invalid.");
  const clientEventId = String(formData.get("clientEventId") ?? "");
  if (clientEventId && !UUID_PATTERN.test(clientEventId)) throw new Error("Receipt command is invalid.");
  const deliveryJobLineIds = formData.getAll("deliveryJobLineId").map(String);
  const requestLineIds = formData.getAll("requestLineId").map(String);
  const delivered = formData.getAll("deliveredQuantity");
  const accepted = formData.getAll("acceptedQuantity");
  const damaged = formData.getAll("damagedQuantity");
  const codes = formData.getAll("discrepancyCode").map(String);
  const notes = formData.getAll("discrepancyNote").map(String);
  const count = deliveryJobLineIds.length;
  if (!count || [requestLineIds, delivered, accepted, damaged, codes, notes]
    .some((values) => values.length !== count)) throw new Error("Confirm every delivery line.");
  const lines = deliveryJobLineIds.map((deliveryJobLineId, index) => {
    const requestLineId = requestLineIds[index];
    if (!UUID_PATTERN.test(deliveryJobLineId) || !UUID_PATTERN.test(requestLineId)) {
      throw new Error("Receipt line is invalid.");
    }
    const discrepancyCode = codes[index];
    if (!DISCREPANCY_CODES.includes(discrepancyCode as ReceiptDiscrepancyCode)) {
      throw new Error("Receipt discrepancy is invalid.");
    }
    return {
      deliveryJobLineId,
      requestLineId,
      deliveredQuantity: quantity(delivered[index], "Delivered quantity"),
      acceptedQuantity: quantity(accepted[index], "Accepted quantity"),
      damagedQuantity: quantity(damaged[index], "Damaged quantity", 0),
      discrepancyCode: discrepancyCode as ReceiptDiscrepancyCode,
      discrepancyNote: notes[index]?.trim() || undefined,
    };
  });
  return {
    deliveryJobId,
    ...(clientEventId ? { clientEventId } : {}),
    notes: String(formData.get("notes") ?? "").trim() || undefined,
    lines,
  };
}
