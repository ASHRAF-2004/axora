import type { RequestStatus } from "./types";

const nextStatuses: Record<RequestStatus, RequestStatus[]> = {
  "New Request": ["Under Verification", "Cancelled"],
  "Under Verification": ["Waiting for Quotation", "On Hold", "Cancelled"],
  "Waiting for Quotation": ["Supplier Assigned", "Cancelled"],
  // These two statuses are retained so historical requests can finish, but
  // no new request enters this retired second-approval path.
  "Waiting for Approval": ["Approved", "Cancelled"],
  Approved: ["Supplier Assigned", "Cancelled"],
  "Supplier Assigned": ["Ordered", "Cancelled"],
  Ordered: ["Preparing for Delivery", "Cancelled"],
  "Preparing for Delivery": ["Out for Delivery"],
  "Out for Delivery": ["Delivered"],
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
