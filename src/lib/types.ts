export const LEGACY_USER_ROLES = [
  "ADMIN",
  "BRANCH_ADMIN",
  "APPROVER",
  "REQUESTER",
  "OPERATIONS",
  "FINANCE",
  "VIEWER",
  "IT_SUPPORT",
] as const;

export const CANONICAL_USER_ROLES = [
  "PLATFORM_OWNER",
  "PLATFORM_OPERATIONS",
  "CLIENT_ACCOUNT_MANAGER",
  "COMPANY_ADMIN",
  "BRANCH_ADMIN",
  "DEPARTMENT_ADMIN",
  "BRANCH_APPROVER",
  "COMPANY_APPROVER",
  "REQUESTER",
  "FINANCE_REVIEWER",
  "AUDITOR",
  "TECHNICAL_SUPPORT",
  "SUPPLIER_USER",
  "DELIVERY_TEAM_SUPERVISOR",
  "DELIVERY_AGENT",
  "DELIVERY_DRIVER",
  "RECEIVING_USER",
] as const;

export type LegacyUserRole = (typeof LEGACY_USER_ROLES)[number];
export type CanonicalRoleKey = (typeof CANONICAL_USER_ROLES)[number];
export type CanonicalUserRole = CanonicalRoleKey;
export type KnownUserRole = LegacyUserRole | CanonicalUserRole;

// Keep string-keyed legacy label maps source-compatible while deployments move
// from the old role set to normalized assignments. Security boundaries must use
// isUserRole(), which intentionally rejects every value outside KnownUserRole.
export type UserRole = LegacyUserRole | (string & {});

export const ACCOUNT_KINDS = ["PLATFORM", "COMPANY", "SUPPLIER", "DELIVERY"] as const;
export type AccountKind = (typeof ACCOUNT_KINDS)[number];

export const ROLE_SCOPE_TYPES = ["PLATFORM", "COMPANY", "BRANCH", "DEPARTMENT", "SUPPLIER", "DELIVERY"] as const;
export type RoleScopeType = (typeof ROLE_SCOPE_TYPES)[number];

const knownUserRoles = new Set<string>([
  ...LEGACY_USER_ROLES,
  ...CANONICAL_USER_ROLES,
]);

export function isUserRole(value: unknown): value is KnownUserRole {
  return typeof value === "string" && knownUserRoles.has(value);
}

export function isAccountKind(value: unknown): value is AccountKind {
  return typeof value === "string" && (ACCOUNT_KINDS as readonly string[]).includes(value);
}

export function isRoleScopeType(value: unknown): value is RoleScopeType {
  return typeof value === "string" && (ROLE_SCOPE_TYPES as readonly string[]).includes(value);
}
export type MasterStatus = "Active" | "Inactive" | "Needs Review";

export type RequestStatus =
  | "New Request"
  | "Under Verification"
  | "Waiting for Quotation"
  | "Waiting for Approval"
  | "Approved"
  | "Supplier Assigned"
  | "Ordered"
  | "Preparing for Delivery"
  | "Out for Delivery"
  | "Delivered"
  | "Invoice Issued"
  | "Completed"
  | "On Hold"
  | "Cancelled";

export type Urgency = "Low" | "Normal" | "High" | "Urgent";
export type DeliveryStatus =
  | "Not Scheduled"
  | "Scheduled"
  | "Preparing"
  | "Out for Delivery"
  | "Partially Delivered"
  | "Delivered"
  | "Delayed"
  | "Failed"
  | "Cancelled";

export type InvoiceStatus = "Not Issued" | "Draft" | "Issued" | "Disputed" | "Cancelled";
export type PaymentStatus = "Unpaid" | "Partial" | "Paid" | "Void";
export const COD_PAYMENT_METHOD = "Cash on delivery (COD)" as const;
export type PaymentMethod = typeof COD_PAYMENT_METHOD;

export interface Company {
  id: string;
  code: string;
  name: string;
  industry: string;
  companyInformation?: string;
  websiteUrl?: string;
  mainContactName: string;
  mainContactEmail: string;
  mainContactPhone: string;
  billingContactName: string;
  billingContactEmail: string;
  billingContactPhone: string;
  billingAddress: string;
  paymentTerms: PaymentMethod;
  billingCycle: string;
  taxRate: number;
  estimatedDeliveryFee: number;
  notes?: string;
  status: MasterStatus;
}

export interface Branch {
  id: string;
  code: string;
  companyId: string;
  companyName: string;
  name: string;
  branchCode: string;
  deliveryAddress: string;
  city: string;
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  deliveryInstructions?: string;
  notes?: string;
  monthlyBudget?: number | null;
  committedAmount: number;
  remainingAmount?: number | null;
  status: MasterStatus;
}

export interface ProductImageSummary {
  id: string;
  altText: string;
  isPrimary: boolean;
  sortOrder: number;
}

export interface Product {
  id: string;
  companyId?: string;
  companyName?: string;
  code: string;
  name: string;
  category: string;
  subcategory: string;
  brand?: string;
  size?: string;
  unit: string;
  packaging?: string;
  description?: string;
  defaultBuyPrice: number;
  defaultSellPrice: number;
  minimumOrderQuantity: number;
  maximumOrderQuantity?: number;
  orderIncrement?: number;
  packSize?: number;
  packUnit?: string;
  quantityRuleVersion?: number;
  quantityRuleEffectiveFrom?: string;
  quantityRuleEffectiveTo?: string;
  quantityRuleReason?: string;
  priceRuleVersion?: number;
  priceEffectiveFrom?: string;
  priceChangedAt?: string;
  priceCurrency?: string;
  deliverySlaDays: number;
  preferredSupplierId?: string;
  preferredSupplierName?: string;
  hasImage: boolean;
  imageAltText?: string;
  images?: ProductImageSummary[];
  status: MasterStatus;
  duplicateWarning?: boolean;
}

export interface Supplier {
  id: string;
  companyId?: string;
  companyName?: string;
  code: string;
  name: string;
  category: string;
  contactName: string;
  phone: string;
  email: string;
  address: string;
  coverageArea: string;
  paymentTerms: PaymentMethod;
  leadTimeDays: number;
  minimumOrderQuantity: number;
  mainProducts: string;
  notes?: string;
  status: MasterStatus;
}

export interface RequestLine {
  id: string;
  code: string;
  productId?: string;
  productCode?: string;
  productName: string;
  category: string;
  subcategory?: string;
  specification?: string;
  quantity: number;
  unit: string;
  supplierId?: string;
  supplierName?: string;
  quotationReference?: string;
  supplierConfirmationStatus?: string;
  unitBuyPrice: number;
  unitSellPrice: number;
  deliveryCharge: number;
  expectedDeliveryDate?: string;
  actualDeliveryDate?: string;
  deliveryStatus: DeliveryStatus;
  quantityReceived: number;
}

export interface ProcurementRequest {
  id: string;
  createdById?: string;
  clientSubmissionKey?: string;
  orderCode: string;
  requestDate: string;
  requestType: "Standard" | "Ad-hoc" | "Recurring";
  companyId: string;
  companyName: string;
  branchId: string;
  branchName: string;
  departmentId?: string;
  department: string;
  requestedBy: string;
  requesterContact: string;
  neededByDate: string;
  urgency: Urgency;
  status: RequestStatus;
  notes?: string;
  issueReason?: string;
  approvalStatus: "Pending" | "Approved" | "Rejected";
  approvalReason?: string;
  approvedByName?: string;
  subtotal?: number;
  estimatedDeliveryFee?: number;
  taxRate?: number;
  taxAmount?: number;
  estimatedTotal: number;
  invoiceStatus?: InvoiceStatus;
  paymentStatus?: PaymentStatus;
  invoiceNumber?: string;
  completedDate?: string;
  lines: RequestLine[];
}

export interface FinancialTotals {
  sales: number;
  buyingCost: number;
  grossProfit: number;
  grossMarginPercent: number;
  deliveryCharges: number;
}

export interface PlatformDashboardData extends FinancialTotals {
  scope: "platform";
  requestCount: number;
  openRequestCount: number;
  urgentRequestCount: number;
  delayedDeliveryCount: number;
  outstandingInvoiceCount: number;
  activeCompanyCount: number;
  activeSupplierCount: number;
  byStatus: Array<{ label: string; value: number }>;
  byCompany: Array<{ label: string; value: number }>;
  topProducts: Array<{ label: string; value: number }>;
  attention: ProcurementRequest[];
}

export interface CompanyDashboardData {
  scope: "company";
  requestCount: number;
  openRequestCount: number;
  urgentRequestCount: number;
  byStatus: PlatformDashboardData["byStatus"];
  attention: PlatformDashboardData["attention"];
}

export type DashboardData = PlatformDashboardData | CompanyDashboardData;

export interface QuotationRecord {
  id: string; requestLineId: string; requestLineCode: string; orderCode: string; productName: string;
  supplierId: string; supplierName: string; quotationReference: string; quotationDate: string;
  unitPrice: number; deliveryCharge: number; minimumOrderQuantity?: number; leadTimeDays?: number;
  validUntil?: string; requestLineQuantity?: number; supplierActive?: boolean;
  status: string; selected: boolean; selectionReason?: string;
}

export interface ApprovalRecord {
  id: string; requestId: string; orderCode: string; companyName: string; approvalType: string;
  status: "Pending" | "Approved" | "Rejected"; reviewerName?: string; reason?: string; decidedAt?: string; createdAt: string;
}

export interface DeliveryRecord {
  id: string; requestLineId: string; requestLineCode: string; orderCode: string; companyName: string; productName: string;
  expectedDate?: string; revisedDate?: string; actualDate?: string; status: DeliveryStatus;
  quantityReceived: number; receivedBy?: string; issueReason?: string; createdAt: string;
}

export interface InvoiceRecord {
  id: string; direction: "CUSTOMER" | "SUPPLIER"; requestId: string; orderCode: string; counterparty: string;
  invoiceNumber: string; invoiceDate: string; dueDate?: string; amount: number; status: InvoiceStatus;
  paidAmount: number; outstandingAmount: number; paymentStatus: PaymentStatus; requestStatus?: RequestStatus;
}

export interface PaymentRecord {
  id: string; invoiceId: string; invoiceNumber: string; paymentDate: string; amount: number;
  method: PaymentMethod; reference?: string; recordedByName?: string;
}

export interface AuditRecord {
  id: string; entityType: string; recordId?: string; action: string; actorName?: string;
  reason?: string; occurredAt: string;
  eventType?: string; actorRole?: string; companyId?: string; branchId?: string;
  departmentId?: string; relatedRequestId?: string; relatedDeliveryId?: string;
  outcome?: string; reasonCode?: string; safeDiff?: Record<string, unknown>;
  correlationId?: string; integrityHash?: string;
}

export interface AttachmentRecord {
  id: string; entityType: string; recordId: string; fileName: string; contentType: string;
  visibility: "CUSTOMER" | "INTERNAL"; createdAt: string; uploadedByName?: string;
}

export interface UserRecord {
  id: string; email: string; displayName: string; role: UserRole; active: boolean; isOwner: boolean;
  companyId?: string; companyName?: string; branchId?: string; branchName?: string;
  departmentId?: string; departmentName?: string;
  supplierId?: string; supplierName?: string; jobTitle?: string;
  accountKind?: AccountKind; scopeType?: RoleScopeType; accountStatus?: "INVITED" | "ACTIVE" | "SUSPENDED" | "CLOSED";
  accountSetupCompletedAt?: string;
  accountSetupDeliveryStatus?: "PENDING" | "SENDING" | "SENT" | "FAILED" | "DISABLED" | "UNCERTAIN" | "CANCELLED";
  accountSetupExpiresAt?: string;
  accountSetupSentAt?: string;
  accountSetupDeliveryAttemptedAt?: string;
  lastLoginAt?: string; createdAt: string;
}
