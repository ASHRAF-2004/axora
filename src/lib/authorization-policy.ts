import {
  isUserRole,
  type AccountKind,
  type KnownUserRole,
  type RoleScopeType,
  type UserRole,
} from "./types";

export const FOUNDATION_PERMISSION_CATALOG = [
  {
    "code": "dashboard.view",
    "group": "Navigation",
    "label": "View dashboard",
    "description": "Open the role-appropriate dashboard and summary surfaces.",
    "highRisk": false
  },
  {
    "code": "platform.view",
    "group": "Platform",
    "label": "View platform context",
    "description": "View platform-level records where the assigned role and resource policy permit.",
    "highRisk": true
  },
  {
    "code": "company.view",
    "group": "Companies",
    "label": "View company",
    "description": "View one company within the effective scope.",
    "highRisk": false
  },
  {
    "code": "company.view.assigned",
    "group": "Companies",
    "label": "View assigned companies",
    "description": "View companies explicitly assigned to the user.",
    "highRisk": false
  },
  {
    "code": "company.lead.view",
    "group": "Companies",
    "label": "View company leads",
    "description": "View company enquiry and lead records within scope.",
    "highRisk": true
  },
  {
    "code": "company.lead.create",
    "group": "Companies",
    "label": "Create company leads",
    "description": "Create a persistent company lead.",
    "highRisk": true
  },
  {
    "code": "company.lead.assign",
    "group": "Companies",
    "label": "Assign company leads",
    "description": "Assign an unassigned lead or company to an authorized account manager.",
    "highRisk": true
  },
  {
    "code": "company.lead.reassign",
    "group": "Companies",
    "label": "Reassign company leads",
    "description": "Move an assigned lead or company to another authorized account manager.",
    "highRisk": true
  },
  {
    "code": "company.edit",
    "group": "Companies",
    "label": "Edit company",
    "description": "Edit permitted company profile and onboarding information.",
    "highRisk": true
  },
  {
    "code": "company.activate",
    "group": "Companies",
    "label": "Activate company",
    "description": "Activate a company after mandatory onboarding checks pass.",
    "highRisk": true
  },
  {
    "code": "company.suspend",
    "group": "Companies",
    "label": "Suspend company",
    "description": "Suspend company access and new transactions under policy.",
    "highRisk": true
  },
  {
    "code": "company.portal.preview",
    "group": "Companies",
    "label": "Preview company portal",
    "description": "Preview a private company portal and theme.",
    "highRisk": false
  },
  {
    "code": "company.portal.publish",
    "group": "Companies",
    "label": "Publish company portal",
    "description": "Publish an approved company portal or public listing.",
    "highRisk": true
  },
  {
    "code": "user.view",
    "group": "People",
    "label": "View users",
    "description": "View users in the effective scope.",
    "highRisk": false
  },
  {
    "code": "user.create",
    "group": "People",
    "label": "Create users",
    "description": "Create an invited account in the effective scope.",
    "highRisk": true
  },
  {
    "code": "user.invite",
    "group": "People",
    "label": "Invite users",
    "description": "Issue or resend a secure account invitation.",
    "highRisk": true
  },
  {
    "code": "user.edit",
    "group": "People",
    "label": "Edit users",
    "description": "Edit permitted profile fields for a scoped user.",
    "highRisk": true
  },
  {
    "code": "user.deactivate",
    "group": "People",
    "label": "Deactivate users",
    "description": "Deactivate or reactivate a scoped account.",
    "highRisk": true
  },
  {
    "code": "user.permission.manage",
    "group": "People",
    "label": "Manage user permissions",
    "description": "Grant or deny explicit permissions within delegation authority.",
    "highRisk": true
  },
  {
    "code": "user.manage",
    "group": "People",
    "label": "Manage users (compatibility)",
    "description": "Compatibility capability for existing user-management routes.",
    "highRisk": true
  },
  {
    "code": "organization.branch.view",
    "group": "Organization",
    "label": "View branches",
    "description": "View branches in the effective company scope.",
    "highRisk": false
  },
  {
    "code": "organization.branch.manage",
    "group": "Organization",
    "label": "Manage branches",
    "description": "Create, edit, or deactivate branches in scope.",
    "highRisk": true
  },
  {
    "code": "organization.department.manage",
    "group": "Organization",
    "label": "Manage departments",
    "description": "Create, edit, or deactivate departments in scope.",
    "highRisk": true
  },
  {
    "code": "organization.cost_center.manage",
    "group": "Organization",
    "label": "Manage cost centres",
    "description": "Create, edit, or deactivate cost centres in scope.",
    "highRisk": true
  },
  {
    "code": "organization.delivery_location.manage",
    "group": "Organization",
    "label": "Manage delivery locations",
    "description": "Create, edit, or deactivate delivery locations in scope.",
    "highRisk": true
  },
  {
    "code": "product.view",
    "group": "Catalogue",
    "label": "View products",
    "description": "View products and customer-safe catalogue details.",
    "highRisk": false
  },
  {
    "code": "catalog.manage",
    "group": "Catalogue",
    "label": "Manage catalogue",
    "description": "Manage Axora catalogue products and availability.",
    "highRisk": true
  },
  {
    "code": "supplier.manage",
    "group": "Sourcing",
    "label": "Manage suppliers",
    "description": "Manage supplier records and approved contacts.",
    "highRisk": true
  },
  {
    "code": "sourcing.manage",
    "group": "Sourcing",
    "label": "Manage sourcing",
    "description": "Run quotation, supplier selection, and sourcing operations.",
    "highRisk": true
  },
  {
    "code": "cart.manage",
    "group": "Requests",
    "label": "Manage cart",
    "description": "Create and edit a scoped purchase cart.",
    "highRisk": false
  },
  {
    "code": "request.view",
    "group": "Requests",
    "label": "View requests",
    "description": "View requests allowed by entity ownership and scope policy.",
    "highRisk": false
  },
  {
    "code": "request.view.own",
    "group": "Requests",
    "label": "View own requests",
    "description": "View requests created by the current user.",
    "highRisk": false
  },
  {
    "code": "request.create",
    "group": "Requests",
    "label": "Create requests",
    "description": "Create a purchase request in scope.",
    "highRisk": false
  },
  {
    "code": "request.edit",
    "group": "Requests",
    "label": "Edit requests",
    "description": "Edit a permitted draft or returned request.",
    "highRisk": false
  },
  {
    "code": "request.submit",
    "group": "Requests",
    "label": "Submit requests",
    "description": "Submit a valid request into approval workflow.",
    "highRisk": true
  },
  {
    "code": "request.cancel",
    "group": "Requests",
    "label": "Cancel requests",
    "description": "Cancel a request when the current state and financial policy permit.",
    "highRisk": true
  },
  {
    "code": "request.approval_queue.view",
    "group": "Approvals",
    "label": "View approval queue",
    "description": "View approval work eligible for the current user.",
    "highRisk": false
  },
  {
    "code": "request.approve.other",
    "group": "Approvals",
    "label": "Approve other users' requests",
    "description": "Approve a request created by another user within scope and limit.",
    "highRisk": true
  },
  {
    "code": "request.approve.self",
    "group": "Approvals",
    "label": "Approve own requests",
    "description": "Approve a request created by the same user when explicitly permitted.",
    "highRisk": true
  },
  {
    "code": "request.approve.over_budget",
    "group": "Approvals",
    "label": "Approve over-budget requests",
    "description": "Approve a documented budget exception within authorized scope.",
    "highRisk": true
  },
  {
    "code": "request.approve.additional_actual",
    "group": "Approvals",
    "label": "Approve additional actual cost",
    "description": "Approve actual-price variance above the existing reservation.",
    "highRisk": true
  },
  {
    "code": "budget.view",
    "group": "Budgets",
    "label": "View budgets",
    "description": "View virtual authorization balances in scope.",
    "highRisk": true
  },
  {
    "code": "budget.branch.manage",
    "group": "Budgets",
    "label": "Manage branch budget (compatibility)",
    "description": "Compatibility capability for current branch-budget routes.",
    "highRisk": true
  },
  {
    "code": "budget.assign",
    "group": "Budgets",
    "label": "Assign budget",
    "description": "Create or transfer an authorized allocation.",
    "highRisk": true
  },
  {
    "code": "budget.increase",
    "group": "Budgets",
    "label": "Increase budget",
    "description": "Increase an allocation within the company ceiling.",
    "highRisk": true
  },
  {
    "code": "budget.reduce",
    "group": "Budgets",
    "label": "Reduce budget",
    "description": "Reduce an allocation without rewriting posted ledger history.",
    "highRisk": true
  },
  {
    "code": "budget.refresh",
    "group": "Budgets",
    "label": "Refresh budget",
    "description": "Run or correct an authorized period refresh.",
    "highRisk": true
  },
  {
    "code": "commercial.cost.view",
    "group": "Commercial",
    "label": "View internal cost",
    "description": "View confidential supplier or base cost.",
    "highRisk": true
  },
  {
    "code": "commercial.markup.view",
    "group": "Commercial",
    "label": "View markup",
    "description": "View confidential markup rules and calculations.",
    "highRisk": true
  },
  {
    "code": "commercial.company_ceiling.view",
    "group": "Commercial",
    "label": "View company ceiling",
    "description": "View contractual company ceiling and exposure.",
    "highRisk": true
  },
  {
    "code": "commercial.company_ceiling.override",
    "group": "Commercial",
    "label": "Override company ceiling",
    "description": "Approve a documented company-ceiling exception.",
    "highRisk": true
  },
  {
    "code": "commercial.platform_margin.view",
    "group": "Commercial",
    "label": "View platform margin",
    "description": "View confidential Axora margin and profitability.",
    "highRisk": true
  },
  {
    "code": "commercial.pricing.manage",
    "group": "Commercial",
    "label": "Manage commercial pricing",
    "description": "Manage confidential pricing rules and effective periods.",
    "highRisk": true
  },
  {
    "code": "delivery.view",
    "group": "Delivery",
    "label": "View deliveries",
    "description": "View delivery records allowed by company or assignment scope.",
    "highRisk": false
  },
  {
    "code": "delivery.manage",
    "group": "Delivery",
    "label": "Manage deliveries",
    "description": "Coordinate delivery operations and controlled transitions.",
    "highRisk": true
  },
  {
    "code": "delivery.assign",
    "group": "Delivery",
    "label": "Assign deliveries",
    "description": "Assign or reassign delivery work.",
    "highRisk": true
  },
  {
    "code": "delivery.accept",
    "group": "Delivery",
    "label": "Accept delivery assignment",
    "description": "Accept or decline an assigned delivery job.",
    "highRisk": false
  },
  {
    "code": "delivery.shop",
    "group": "Delivery",
    "label": "Record shopping activity",
    "description": "Record item availability, substitutions, actual prices, and shopping progress.",
    "highRisk": true
  },
  {
    "code": "delivery.receipt.upload",
    "group": "Delivery",
    "label": "Upload receipts",
    "description": "Upload and associate private purchase receipts.",
    "highRisk": true
  },
  {
    "code": "delivery.track",
    "group": "Delivery",
    "label": "Manage live tracking",
    "description": "Start, update, pause, or stop an authorized delivery tracking session.",
    "highRisk": true
  },
  {
    "code": "delivery.complete",
    "group": "Delivery",
    "label": "Complete delivery",
    "description": "Complete delivery after required proof or authorized exception.",
    "highRisk": true
  },
  {
    "code": "delivery.portal.view",
    "group": "Delivery",
    "label": "View delivery portal",
    "description": "Open the delivery-focused portal.",
    "highRisk": false
  },
  {
    "code": "delivery.assignment.update",
    "group": "Delivery",
    "label": "Update assigned deliveries",
    "description": "Submit permitted idempotent status and evidence updates for assigned work.",
    "highRisk": true
  },
  {
    "code": "receiving.view",
    "group": "Receiving",
    "label": "View receiving",
    "description": "View assigned receiving work and evidence.",
    "highRisk": false
  },
  {
    "code": "receiving.confirm",
    "group": "Receiving",
    "label": "Confirm receipt",
    "description": "Independently confirm received, damaged, or missing quantities.",
    "highRisk": true
  },
  {
    "code": "finance.invoice.view",
    "group": "Finance",
    "label": "View invoices",
    "description": "View permitted invoice and finance evidence.",
    "highRisk": true
  },
  {
    "code": "finance.manage",
    "group": "Finance",
    "label": "Manage finance workflow",
    "description": "Manage authorized invoice, matching, and finance exception actions.",
    "highRisk": true
  },
  {
    "code": "finance.match.review",
    "group": "Finance",
    "label": "Review three-way matches",
    "description": "Review request, receipt, and invoice matching exceptions.",
    "highRisk": true
  },
  {
    "code": "document.view",
    "group": "Documents",
    "label": "View documents",
    "description": "View permitted generated and uploaded documents.",
    "highRisk": false
  },
  {
    "code": "document.manage",
    "group": "Documents",
    "label": "Manage documents (compatibility)",
    "description": "Compatibility capability for current document-management routes.",
    "highRisk": true
  },
  {
    "code": "document.generate",
    "group": "Documents",
    "label": "Generate documents",
    "description": "Generate a versioned private document from an immutable snapshot.",
    "highRisk": true
  },
  {
    "code": "document.download",
    "group": "Documents",
    "label": "Download documents",
    "description": "Download a private document after current authorization is rechecked.",
    "highRisk": false
  },
  {
    "code": "document.dispatch.supplier",
    "group": "Documents",
    "label": "Dispatch supplier documents",
    "description": "Dispatch an approved supplier-facing document.",
    "highRisk": true
  },
  {
    "code": "document.dispatch.company",
    "group": "Documents",
    "label": "Dispatch company documents",
    "description": "Dispatch an approved company-facing document.",
    "highRisk": true
  },
  {
    "code": "report.view",
    "group": "Reporting",
    "label": "View reports",
    "description": "View role- and scope-appropriate reports.",
    "highRisk": false
  },
  {
    "code": "analytics.platform.view",
    "group": "Analytics",
    "label": "View platform analytics",
    "description": "View Axora-wide analytics and operational aggregates.",
    "highRisk": true
  },
  {
    "code": "analytics.company.view",
    "group": "Analytics",
    "label": "View company analytics",
    "description": "View company-, branch-, or department-scoped analytics.",
    "highRisk": true
  },
  {
    "code": "email.operations.view",
    "group": "Email",
    "label": "View email operations",
    "description": "View transactional email queue, delivery, suppression, and provider health.",
    "highRisk": true
  },
  {
    "code": "audit.view",
    "group": "Audit",
    "label": "View audit history",
    "description": "View permitted immutable accountability records.",
    "highRisk": true
  },
  {
    "code": "settings.manage",
    "group": "Settings",
    "label": "Manage settings",
    "description": "Manage authorized platform or company settings.",
    "highRisk": true
  },
  {
    "code": "system.diagnostics.view",
    "group": "Support",
    "label": "View system diagnostics",
    "description": "View audited technical diagnostics without business authority.",
    "highRisk": true
  },
  {
    "code": "supplier.portal.view",
    "group": "Supplier",
    "label": "View supplier portal",
    "description": "Open the supplier-focused portal for assigned work.",
    "highRisk": false
  },
  {
    "code": "supplier.rfq.respond",
    "group": "Supplier",
    "label": "Respond to RFQs",
    "description": "Respond to assigned quotation requests.",
    "highRisk": true
  }
] as const;

export const ADDITIVE_PERMISSION_CATALOG = [
  {
    "code": "email.operations.manage",
    "group": "Email",
    "label": "Manage email operations",
    "description": "Retry, cancel, suppress, reconcile, and control transactional email delivery.",
    "highRisk": true
  }
] as const;

export const PERMISSION_CATALOG = [
  ...FOUNDATION_PERMISSION_CATALOG,
  ...ADDITIVE_PERMISSION_CATALOG,
] as const;

export type PermissionCode = (typeof PERMISSION_CATALOG)[number]["code"];
export type PermissionRisk = "NORMAL" | "HIGH";
export type AuthorizationAccountStatus =
  | "INVITED"
  | "ACTIVE"
  | "SUSPENDED"
  | "DEACTIVATED";

export interface AuthorizationScope {
  type: RoleScopeType;
  companyId?: string;
  branchId?: string;
  departmentId?: string;
  supplierId?: string;
  deliveryAssignmentId?: string;
}

export interface PermissionDelegation {
  active: boolean;
  startsAt: Date;
  endsAt: Date;
  permissions: readonly PermissionCode[];
  scopes: readonly AuthorizationScope[];
}

export interface PermissionOverride {
  permission: PermissionCode;
  effect: "GRANT" | "DENY";
  scope: AuthorizationScope;
  active: boolean;
  startsAt?: Date;
  endsAt?: Date;
}

export interface ApprovalLimit {
  permission:
    | "request.approve.other"
    | "request.approve.self"
    | "request.approve.over_budget"
    | "request.approve.additional_actual";
  currency: string;
  maximumAmount: number;
  allowSelfApproval: boolean;
  active: boolean;
  startsAt?: Date;
  endsAt?: Date;
  scope: AuthorizationScope;
}

export interface AuthorizationSubject {
  userId: string;
  role: UserRole | string;
  accountKind: AccountKind;
  accountStatus: AuthorizationAccountStatus;
  isOwner: boolean;
  scopes: readonly AuthorizationScope[];
  roleGrants?: readonly PermissionCode[];
  permissionOverrides?: readonly PermissionOverride[];
  explicitGrants?: readonly PermissionCode[];
  explicitDenies?: readonly PermissionCode[];
  delegations?: readonly PermissionDelegation[];
  approvalLimits?: readonly ApprovalLimit[];
}

export interface AuthorizationResource {
  scope: AuthorizationScope;
  ownerUserId?: string;
  amount?: number;
  currency?: string;
  availableBudget?: number;
  companyCeilingRemaining?: number;
  stateAllowsAction?: boolean;
}

export type AuthorizationDenialReason =
  | "ACCOUNT_INACTIVE"
  | "ROLE_INVALID"
  | "SCOPE_INVALID"
  | "PERMISSION_DENIED"
  | "RESOURCE_OUT_OF_SCOPE"
  | "SELF_APPROVAL_DENIED"
  | "APPROVAL_LIMIT_MISSING"
  | "APPROVAL_LIMIT_EXCEEDED"
  | "CURRENCY_MISMATCH"
  | "BUDGET_INSUFFICIENT"
  | "COMPANY_CEILING_EXCEEDED"
  | "INVALID_RESOURCE_STATE"
  | "INVALID_AMOUNT";

export type AuthorizationDecision =
  | {
      allowed: true;
      permission: PermissionCode;
      source: "ROLE" | "EXPLICIT_GRANT" | "DELEGATION";
    }
  | {
      allowed: false;
      permission: PermissionCode;
      reason: AuthorizationDenialReason;
    };

export const ROLE_DEFAULT_PERMISSIONS = {
  "PLATFORM_OWNER": [
    "dashboard.view",
    "platform.view",
    "company.view",
    "company.lead.view",
    "company.lead.create",
    "company.lead.assign",
    "company.lead.reassign",
    "company.edit",
    "company.activate",
    "company.suspend",
    "company.portal.preview",
    "company.portal.publish",
    "user.view",
    "user.create",
    "user.invite",
    "user.edit",
    "user.deactivate",
    "user.permission.manage",
    "user.manage",
    "organization.branch.view",
    "organization.branch.manage",
    "organization.department.manage",
    "organization.cost_center.manage",
    "organization.delivery_location.manage",
    "product.view",
    "catalog.manage",
    "supplier.manage",
    "sourcing.manage",
    "request.view",
    "request.approval_queue.view",
    "budget.view",
    "commercial.cost.view",
    "commercial.markup.view",
    "commercial.company_ceiling.view",
    "commercial.company_ceiling.override",
    "commercial.platform_margin.view",
    "commercial.pricing.manage",
    "delivery.view",
    "delivery.manage",
    "delivery.assign",
    "receiving.view",
    "finance.invoice.view",
    "finance.manage",
    "finance.match.review",
    "document.view",
    "document.manage",
    "document.generate",
    "document.download",
    "document.dispatch.supplier",
    "document.dispatch.company",
    "report.view",
    "analytics.platform.view",
    "analytics.company.view",
    "email.operations.view",
    "email.operations.manage",
    "audit.view",
    "settings.manage",
    "system.diagnostics.view"
  ],
  "PLATFORM_OPERATIONS": [
    "dashboard.view",
    "platform.view",
    "product.view",
    "catalog.manage",
    "supplier.manage",
    "sourcing.manage",
    "request.view",
    "delivery.view",
    "delivery.manage",
    "delivery.assign",
    "receiving.view",
    "document.view",
    "document.manage",
    "document.generate",
    "document.download",
    "document.dispatch.supplier",
    "report.view",
    "email.operations.view",
    "email.operations.manage"
  ],
  "CLIENT_ACCOUNT_MANAGER": [
    "dashboard.view",
    "company.view.assigned",
    "company.lead.view",
    "company.lead.create",
    "company.lead.assign",
    "company.lead.reassign",
    "company.edit",
    "company.activate",
    "company.suspend",
    "company.portal.preview",
    "user.view",
    "user.create",
    "user.invite",
    "user.edit",
    "user.deactivate",
    "organization.branch.view",
    "product.view",
    "request.view",
    "delivery.view",
    "budget.view",
    "commercial.company_ceiling.view",
    "document.view",
    "document.download",
    "report.view",
    "analytics.company.view",
    "audit.view",
    "email.operations.view"
  ],
  "TECHNICAL_SUPPORT": [
    "system.diagnostics.view"
  ],
  "COMPANY_ADMIN": [
    "dashboard.view",
    "company.view",
    "user.view",
    "user.create",
    "user.invite",
    "user.edit",
    "user.deactivate",
    "user.permission.manage",
    "user.manage",
    "organization.branch.view",
    "organization.branch.manage",
    "organization.department.manage",
    "organization.cost_center.manage",
    "organization.delivery_location.manage",
    "product.view",
    "request.view",
    "request.approval_queue.view",
    "request.approve.other",
    "request.approve.over_budget",
    "budget.view",
    "budget.branch.manage",
    "budget.assign",
    "budget.increase",
    "budget.reduce",
    "budget.refresh",
    "delivery.view",
    "finance.invoice.view",
    "document.view",
    "document.manage",
    "document.generate",
    "document.download",
    "document.dispatch.company",
    "report.view",
    "analytics.company.view",
    "audit.view",
    "settings.manage"
  ],
  "BRANCH_ADMIN": [
    "dashboard.view",
    "company.view",
    "user.view",
    "user.create",
    "user.invite",
    "user.edit",
    "user.deactivate",
    "user.manage",
    "organization.branch.view",
    "organization.department.manage",
    "organization.delivery_location.manage",
    "product.view",
    "cart.manage",
    "request.view",
    "request.create",
    "request.edit",
    "request.submit",
    "request.cancel",
    "request.approval_queue.view",
    "request.approve.other",
    "budget.view",
    "delivery.view",
    "finance.invoice.view",
    "document.view",
    "document.manage",
    "document.generate",
    "document.download",
    "report.view",
    "analytics.company.view"
  ],
  "DEPARTMENT_ADMIN": [
    "dashboard.view",
    "company.view",
    "user.view",
    "user.create",
    "user.invite",
    "user.edit",
    "user.deactivate",
    "user.manage",
    "organization.branch.view",
    "organization.department.manage",
    "product.view",
    "cart.manage",
    "request.view",
    "request.create",
    "request.edit",
    "request.submit",
    "request.cancel",
    "request.approval_queue.view",
    "request.approve.other",
    "budget.view",
    "delivery.view",
    "document.view",
    "document.manage",
    "document.generate",
    "document.download",
    "report.view",
    "analytics.company.view"
  ],
  "COMPANY_APPROVER": [
    "dashboard.view",
    "company.view",
    "organization.branch.view",
    "product.view",
    "request.view",
    "request.approval_queue.view",
    "request.approve.other",
    "budget.view",
    "delivery.view",
    "document.view",
    "document.download",
    "report.view",
    "analytics.company.view"
  ],
  "BRANCH_APPROVER": [
    "dashboard.view",
    "company.view",
    "organization.branch.view",
    "product.view",
    "request.view",
    "request.approval_queue.view",
    "request.approve.other",
    "budget.view",
    "delivery.view",
    "document.view",
    "document.download",
    "report.view"
  ],
  "REQUESTER": [
    "dashboard.view",
    "company.view",
    "organization.branch.view",
    "product.view",
    "cart.manage",
    "request.view.own",
    "request.create",
    "request.edit",
    "request.submit",
    "request.cancel",
    "delivery.view",
    "document.view",
    "document.download"
  ],
  "FINANCE_REVIEWER": [
    "dashboard.view",
    "company.view",
    "organization.branch.view",
    "product.view",
    "request.view",
    "budget.view",
    "delivery.view",
    "finance.invoice.view",
    "finance.manage",
    "finance.match.review",
    "document.view",
    "document.download",
    "report.view",
    "analytics.company.view"
  ],
  "AUDITOR": [
    "dashboard.view",
    "company.view",
    "organization.branch.view",
    "product.view",
    "request.view",
    "budget.view",
    "delivery.view",
    "finance.invoice.view",
    "document.view",
    "document.download",
    "report.view",
    "analytics.company.view",
    "audit.view"
  ],
  "RECEIVING_USER": [
    "company.view",
    "delivery.view",
    "receiving.view",
    "receiving.confirm",
    "document.view",
    "document.download"
  ],
  "DELIVERY_TEAM_SUPERVISOR": [
    "dashboard.view",
    "user.view",
    "user.create",
    "user.invite",
    "user.edit",
    "user.deactivate",
    "delivery.view",
    "delivery.manage",
    "delivery.assign",
    "delivery.portal.view",
    "delivery.assignment.update",
    "delivery.track",
    "delivery.complete",
    "document.view",
    "document.download",
    "report.view"
  ],
  "DELIVERY_AGENT": [
    "delivery.view",
    "delivery.portal.view",
    "delivery.assignment.update",
    "delivery.accept",
    "delivery.shop",
    "delivery.receipt.upload",
    "delivery.track",
    "delivery.complete",
    "document.view",
    "document.download"
  ],
  "DELIVERY_DRIVER": [
    "delivery.view",
    "delivery.portal.view",
    "delivery.assignment.update",
    "delivery.accept",
    "delivery.shop",
    "delivery.receipt.upload",
    "delivery.track",
    "delivery.complete",
    "document.view",
    "document.download"
  ]
} as const satisfies
  Readonly<Partial<Record<KnownUserRole, readonly PermissionCode[]>>>;

export type AuthorizationRole = keyof typeof ROLE_DEFAULT_PERMISSIONS;

const knownPermissionCodes = new Set<string>(
  PERMISSION_CATALOG.map((permission) => permission.code),
);

const approvalPermissions = new Set<PermissionCode>([
  "request.approve.other",
  "request.approve.self",
  "request.approve.over_budget",
  "request.approve.additional_actual",
]);

export function isPermissionCode(value: unknown): value is PermissionCode {
  return typeof value === "string" && knownPermissionCodes.has(value);
}

export function canonicalRoleForAuthorization(
  role: UserRole | string,
  scopeType?: RoleScopeType,
  isOwner = false,
): AuthorizationRole | undefined {
  if (!isUserRole(role)) return undefined;
  if (role === "ADMIN") return isOwner ? "PLATFORM_OWNER" : "COMPANY_ADMIN";
  if (role === "APPROVER") {
    return scopeType === "BRANCH" || scopeType === "DEPARTMENT"
      ? "BRANCH_APPROVER"
      : "COMPANY_APPROVER";
  }
  if (role === "OPERATIONS") return "REQUESTER";
  if (role === "FINANCE") return "FINANCE_REVIEWER";
  if (role === "VIEWER") return "AUDITOR";
  if (role === "IT_SUPPORT") return "TECHNICAL_SUPPORT";
  if (role === "DELIVERY_DRIVER") return "DELIVERY_AGENT";
  return role;
}

export function defaultPermissionsForRole(
  role: UserRole | string,
  scopeType?: RoleScopeType,
  isOwner = false,
): readonly PermissionCode[] {
  const canonical = canonicalRoleForAuthorization(role, scopeType, isOwner);
  return canonical ? ROLE_DEFAULT_PERMISSIONS[canonical] ?? [] : [];
}

function scopeIsStructurallyValid(scope: AuthorizationScope) {
  if (scope.type === "PLATFORM") {
    return !scope.companyId && !scope.branchId && !scope.departmentId
      && !scope.supplierId && !scope.deliveryAssignmentId;
  }
  if (scope.type === "COMPANY") {
    return Boolean(scope.companyId) && !scope.branchId && !scope.departmentId
      && !scope.supplierId && !scope.deliveryAssignmentId;
  }
  if (scope.type === "BRANCH") {
    return Boolean(scope.companyId && scope.branchId) && !scope.departmentId
      && !scope.supplierId && !scope.deliveryAssignmentId;
  }
  if (scope.type === "DEPARTMENT") {
    return Boolean(scope.companyId && scope.departmentId)
      && !scope.supplierId && !scope.deliveryAssignmentId;
  }
  if (scope.type === "SUPPLIER") {
    return Boolean(scope.supplierId) && !scope.companyId && !scope.branchId
      && !scope.departmentId && !scope.deliveryAssignmentId;
  }
  return !scope.companyId && !scope.branchId && !scope.departmentId
    && !scope.supplierId;
}

function roleScopeContract(role: AuthorizationRole) {
  switch (role) {
    case "PLATFORM_OWNER":
    case "PLATFORM_OPERATIONS":
    case "TECHNICAL_SUPPORT":
      return { accountKind: "PLATFORM" as const, scopes: ["PLATFORM"] as const };
    case "CLIENT_ACCOUNT_MANAGER":
      return { accountKind: "PLATFORM" as const, scopes: ["COMPANY"] as const };
    case "COMPANY_ADMIN":
    case "COMPANY_APPROVER":
      return { accountKind: "COMPANY" as const, scopes: ["COMPANY"] as const };
    case "BRANCH_ADMIN":
    case "BRANCH_APPROVER":
      return { accountKind: "COMPANY" as const, scopes: ["BRANCH"] as const };
    case "REQUESTER":
      return {
        accountKind: "COMPANY" as const,
        scopes: ["BRANCH", "DEPARTMENT"] as const,
      };
    case "DEPARTMENT_ADMIN":
      return { accountKind: "COMPANY" as const, scopes: ["DEPARTMENT"] as const };
    case "FINANCE_REVIEWER":
    case "AUDITOR":
    case "RECEIVING_USER":
      return {
        accountKind: "COMPANY" as const,
        scopes: ["COMPANY", "BRANCH", "DEPARTMENT"] as const,
      };
    case "DELIVERY_TEAM_SUPERVISOR":
    case "DELIVERY_AGENT":
    case "DELIVERY_DRIVER":
      return { accountKind: "DELIVERY" as const, scopes: ["DELIVERY"] as const };
    default:
      return undefined;
  }
}

function subjectIsStructurallyValid(subject: AuthorizationSubject) {
  const role = canonicalRoleForAuthorization(
    subject.role,
    subject.scopes[0]?.type,
    subject.isOwner,
  );
  if (!role || !subject.scopes.length
    || subject.scopes.some((scope) => !scopeIsStructurallyValid(scope))) {
    return false;
  }
  const contract = roleScopeContract(role);
  if (!contract || contract.accountKind !== subject.accountKind
    || subject.scopes.some((scope) => !(
      contract.scopes as readonly RoleScopeType[]
    ).includes(scope.type))) {
    return false;
  }
  return role === "PLATFORM_OWNER" ? subject.isOwner : !subject.isOwner;
}

function scopeContains(
  granted: AuthorizationScope,
  resource: AuthorizationScope,
) {
  if (granted.type === "PLATFORM") return true;
  if (granted.type === "COMPANY") {
    return granted.companyId === resource.companyId;
  }
  if (granted.type === "BRANCH") {
    return granted.companyId === resource.companyId
      && granted.branchId === resource.branchId;
  }
  if (granted.type === "DEPARTMENT") {
    return granted.companyId === resource.companyId
      && granted.departmentId === resource.departmentId;
  }
  if (granted.type === "SUPPLIER") {
    return granted.supplierId === resource.supplierId;
  }
  return !granted.deliveryAssignmentId
    || granted.deliveryAssignmentId === resource.deliveryAssignmentId;
}

function activeDelegations(subject: AuthorizationSubject, now: Date) {
  return (subject.delegations ?? []).filter((delegation) => (
    delegation.active
      && delegation.startsAt.getTime() <= now.getTime()
      && delegation.endsAt.getTime() > now.getTime()
      && delegation.scopes.length > 0
      && delegation.scopes.every(scopeIsStructurallyValid)
  ));
}

function activeMatchingOverrides(
  subject: AuthorizationSubject,
  permission: PermissionCode,
  resource: AuthorizationResource,
  now: Date,
) {
  return (subject.permissionOverrides ?? []).filter((override) => (
    override.active
      && override.permission === permission
      && (!override.startsAt || override.startsAt.getTime() <= now.getTime())
      && (!override.endsAt || override.endsAt.getTime() > now.getTime())
      && scopeContains(override.scope, resource.scope)
  ));
}

function permissionSource(
  subject: AuthorizationSubject,
  permission: PermissionCode,
  resource: AuthorizationResource,
  now: Date,
) {
  const matchingOverrides = activeMatchingOverrides(
    subject,
    permission,
    resource,
    now,
  );
  if (subject.explicitDenies?.includes(permission)
    || matchingOverrides.some((override) => override.effect === "DENY")) {
    return undefined;
  }
  if (subject.explicitGrants?.includes(permission)
    || matchingOverrides.some((override) => override.effect === "GRANT")) {
    return "EXPLICIT_GRANT" as const;
  }
  const rolePermissions = subject.roleGrants
    ?? defaultPermissionsForRole(
      subject.role,
      subject.scopes[0]?.type,
      subject.isOwner,
    );
  if (rolePermissions.includes(permission)) return "ROLE" as const;
  if (activeDelegations(subject, now).some((delegation) => (
    delegation.permissions.includes(permission)
      && delegation.scopes.some((scope) => scopeContains(scope, resource.scope))
  ))) {
    return "DELEGATION" as const;
  }
  return undefined;
}

function matchingApprovalLimits(
  subject: AuthorizationSubject,
  permission: ApprovalLimit["permission"],
  resource: AuthorizationResource,
  now: Date,
) {
  return (subject.approvalLimits ?? []).filter((limit) => (
    limit.active
      && limit.permission === permission
      && (!limit.startsAt || limit.startsAt.getTime() <= now.getTime())
      && (!limit.endsAt || limit.endsAt.getTime() > now.getTime())
      && scopeContains(limit.scope, resource.scope)
  ));
}

export function authorize(
  input: {
    subject: AuthorizationSubject;
    permission: PermissionCode;
    resource: AuthorizationResource;
    now?: Date;
  },
): AuthorizationDecision {
  const { subject, resource } = input;
  const now = input.now ?? new Date();

  if (subject.accountStatus !== "ACTIVE") {
    return { allowed: false, permission: input.permission, reason: "ACCOUNT_INACTIVE" };
  }
  const role = canonicalRoleForAuthorization(
    subject.role,
    subject.scopes[0]?.type,
    subject.isOwner,
  );
  if (!role) {
    return { allowed: false, permission: input.permission, reason: "ROLE_INVALID" };
  }
  if (!subjectIsStructurallyValid(subject)
    || !scopeIsStructurallyValid(resource.scope)) {
    return { allowed: false, permission: input.permission, reason: "SCOPE_INVALID" };
  }
  if (resource.stateAllowsAction === false) {
    return {
      allowed: false,
      permission: input.permission,
      reason: "INVALID_RESOURCE_STATE",
    };
  }
  const delegatedScopes = activeDelegations(subject, now)
    .flatMap((delegation) => delegation.scopes);
  if (!subject.scopes.some((scope) => scopeContains(scope, resource.scope))
    && !delegatedScopes.some((scope) => scopeContains(scope, resource.scope))) {
    return {
      allowed: false,
      permission: input.permission,
      reason: "RESOURCE_OUT_OF_SCOPE",
    };
  }

  const isSelfApproval = input.permission === "request.approve.other"
    && resource.ownerUserId === subject.userId;
  const permission = isSelfApproval
    ? "request.approve.self"
    : input.permission;
  const source = permissionSource(subject, permission, resource, now);
  if (!source) {
    return {
      allowed: false,
      permission,
      reason: isSelfApproval ? "SELF_APPROVAL_DENIED" : "PERMISSION_DENIED",
    };
  }

  if (resource.amount !== undefined) {
    if (!Number.isFinite(resource.amount) || resource.amount < 0) {
      return { allowed: false, permission, reason: "INVALID_AMOUNT" };
    }
    if (approvalPermissions.has(permission)) {
      const currency = resource.currency?.trim().toUpperCase();
      if (!currency) {
        return { allowed: false, permission, reason: "CURRENCY_MISMATCH" };
      }
      const limits = matchingApprovalLimits(
        subject,
        permission as ApprovalLimit["permission"],
        resource,
        now,
      );
      if (!limits.length) {
        return { allowed: false, permission, reason: "APPROVAL_LIMIT_MISSING" };
      }
      const matchingCurrency = limits.filter((limit) => (
        limit.currency.trim().toUpperCase() === currency
          && (!isSelfApproval || limit.allowSelfApproval)
      ));
      if (!matchingCurrency.length) {
        return {
          allowed: false,
          permission,
          reason: isSelfApproval ? "SELF_APPROVAL_DENIED" : "CURRENCY_MISMATCH",
        };
      }
      if (resource.amount > Math.max(
        ...matchingCurrency.map((limit) => limit.maximumAmount),
      )) {
        return {
          allowed: false,
          permission,
          reason: "APPROVAL_LIMIT_EXCEEDED",
        };
      }
    }
    if (resource.availableBudget !== undefined
      && resource.amount > resource.availableBudget
      && !permissionSource(
        subject,
        "request.approve.over_budget",
        resource,
        now,
      )) {
      return { allowed: false, permission, reason: "BUDGET_INSUFFICIENT" };
    }
    if (resource.companyCeilingRemaining !== undefined
      && resource.amount > resource.companyCeilingRemaining
      && !permissionSource(
        subject,
        "commercial.company_ceiling.override",
        resource,
        now,
      )) {
      return {
        allowed: false,
        permission,
        reason: "COMPANY_CEILING_EXCEEDED",
      };
    }
  }

  return { allowed: true, permission, source };
}

export const authorizationPolicyInternals = {
  scopeContains,
  scopeIsStructurallyValid,
  subjectIsStructurallyValid,
};
