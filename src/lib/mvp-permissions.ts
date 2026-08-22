import type { AccountKind } from "./types";
import type { PermissionCode } from "./authorization-policy";

const platform = new Set<PermissionCode>([
  "company.view.assigned", "company.create", "company.edit", "company.activate", "company.suspend",
  "product.view", "product.manage", "request.view", "delivery.view",
  "company_user.view", "company_user.create", "company_user.edit", "company_user.permission.manage",
]);

const company = new Set<PermissionCode>([
  "product.view", "request.view", "request.create", "request.edit", "request.cancel",
  "request.approval_queue.view", "request.approve.other", "delivery.view",
  "organization.branch.view", "organization.branch.manage", "budget.view", "budget.branch.manage",
  "finance.wallet.view", "finance.wallet.top_up.request", "finance.invoice.view",
  "company_user.view", "company_user.create", "company_user.edit", "company_user.permission.manage",
]);

const delivery = new Set<PermissionCode>([
  "delivery.view", "delivery.portal.view", "delivery.accept", "delivery.shop",
  "delivery.receipt.upload", "delivery.track", "delivery.complete", "delivery.claim",
]);

export function isMvpVisiblePermission(accountKind: AccountKind, code: PermissionCode) {
  return (accountKind === "PLATFORM" ? platform
    : accountKind === "COMPANY" ? company : delivery).has(code);
}
