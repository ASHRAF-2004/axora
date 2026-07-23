import type { RequestStatus } from "./types";

const nextStatuses: Record<RequestStatus, RequestStatus[]> = {
  "New Request": ["Under Verification", "On Hold", "Cancelled"],
  "Under Verification": ["Waiting for Quotation", "Waiting for Approval", "On Hold", "Cancelled"],
  "Waiting for Quotation": ["Waiting for Approval", "On Hold", "Cancelled"],
  "Waiting for Approval": ["Approved", "On Hold", "Cancelled"],
  Approved: ["Supplier Assigned", "On Hold", "Cancelled"],
  "Supplier Assigned": ["Ordered", "On Hold", "Cancelled"],
  Ordered: ["Preparing for Delivery", "On Hold", "Cancelled"],
  "Preparing for Delivery": ["Out for Delivery", "On Hold"],
  "Out for Delivery": ["Delivered", "On Hold"],
  Delivered: ["Invoice Issued"],
  "Invoice Issued": ["Completed"],
  Completed: [],
  "On Hold": ["Under Verification", "Cancelled"],
  Cancelled: [],
};

export function allowedNextStatuses(status: RequestStatus) {
  return nextStatuses[status];
}

export function transitionNeedsReason(current: RequestStatus, next: RequestStatus) {
  return next === "On Hold" || next === "Cancelled" || current === "On Hold";
}

export function validateStatusTransition(current: RequestStatus, next: RequestStatus, reason?: string) {
  if (!allowedNextStatuses(current).includes(next)) {
    throw new Error(`Status cannot move from “${current}” to “${next}”.`);
  }
  if (transitionNeedsReason(current, next) && !reason?.trim()) {
    throw new Error("A clear reason is required for hold, cancellation, or resuming a held request.");
  }
}
