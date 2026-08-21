import type { AuthenticatedSessionUser } from "./auth";
import {
  PERMISSION_CATALOG,
  authorize,
  type AuthorizationScope,
  type PermissionCode,
} from "./authorization-policy";
import { loadEffectiveAccess } from "./effective-access";
import type { Permission } from "./permissions";

const ROUTE_PERMISSION_CODES: Readonly<Record<Permission, readonly PermissionCode[]>> = {
  view_dashboard: ["dashboard.view"],
  view_catalog: ["product.view"],
  view_requests: ["request.view", "request.view.own"],
  view_deliveries: ["delivery.view"],
  view_branches: ["organization.branch.view"],
  manage_companies: ["company.create", "company.view.all", "company.view.assigned", "company.edit"],
  manage_catalog: ["product.manage", "product.archive", "category.manage"],
  manage_branches: ["organization.branch.manage", "organization.department.manage"],
  manage_branch_budget: ["budget.branch.manage"],
  create_requests: ["request.create"],
  view_approvals: ["request.approval_queue.view"],
  view_budgets: ["budget.view"],
  view_wallet: ["finance.wallet.view"],
  request_wallet_top_up: ["finance.wallet.top_up.request"],
  record_wallet_top_up: ["finance.wallet.top_up.record"],
  approve_requests: ["request.approve.other", "request.approve.self"],
  manage_deliveries: ["delivery.manage"],
  view_invoices: ["finance.invoice.view"],
  manage_finance: ["finance.manage"],
  view_documents: ["document.view"],
  manage_documents: ["document.manage", "document.generate"],
  view_reports: ["report.view", "analytics.company.view", "analytics.platform.view"],
  view_audit: ["audit.view"],
  manage_users: [
    "platform_user.view", "platform_user.create", "platform_user.edit",
    "company_user.view", "company_user.create", "company_user.edit",
    "delivery_user.view", "delivery_user.create", "delivery_user.edit",
  ],
  manage_settings: ["settings.manage"],
  manage_category_policy: ["procurement.category_policy.manage"],
  manage_commercial_pricing: ["commercial.pricing.manage"],
  view_system_diagnostics: ["system.diagnostics.view"],
  view_email_operations: ["email.operations.view"],
  manage_email_operations: ["email.operations.manage"],
  view_delivery_portal: ["delivery.portal.view"],
  update_assigned_deliveries: ["delivery.assignment.update"],
  view_receiving: ["receiving.view"],
  confirm_receipts: ["receiving.confirm"],
  view_platform_revenue: ["analytics.revenue.view"],
  view_platform_profit: ["commercial.platform_margin.view"],
  view_internal_cost: ["commercial.cost.view"],
  create_platform_users: ["platform_user.create"],
  create_company_users: ["company_user.create"],
  create_delivery_users: ["delivery_user.create"],
  view_all_companies: ["company.view.all"],
};

function actorScope(actor: AuthenticatedSessionUser): AuthorizationScope {
  return {
    type: actor.scopeType,
    ...(actor.companyId ? { companyId: actor.companyId } : {}),
    ...(actor.branchId ? { branchId: actor.branchId } : {}),
    ...(actor.departmentId ? { departmentId: actor.departmentId } : {}),
    ...(actor.supplierId ? { supplierId: actor.supplierId } : {}),
  };
}

export async function resolveEffectiveRoutePermissions(
  actor: AuthenticatedSessionUser,
): Promise<readonly Permission[]> {
  if (actor.isOwner) return Object.keys(ROUTE_PERMISSION_CODES) as Permission[];
  const access = (await loadEffectiveAccess(actor)).subject;
  const scope = actorScope(actor);
  return (Object.entries(ROUTE_PERMISSION_CODES) as [Permission, readonly PermissionCode[]][])
    .filter(([, codes]) => codes.some((permission) => authorize({
      subject: access,
      permission,
      resource: { scope },
    }).allowed))
    .map(([permission]) => permission);
}

export async function listGrantablePermissionOptions(actor: AuthenticatedSessionUser) {
  if (actor.isOwner) {
    return PERMISSION_CATALOG.map((permission) => ({ ...permission }));
  }
  const access = (await loadEffectiveAccess(actor)).subject;
  const scope = actorScope(actor);
  return PERMISSION_CATALOG.filter((permission) => authorize({
    subject: access,
    permission: permission.code,
    resource: { scope },
  }).allowed).map((permission) => ({ ...permission }));
}
