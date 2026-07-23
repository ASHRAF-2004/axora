export type UserRole = "ADMIN" | "OPERATIONS" | "FINANCE" | "VIEWER" | "IT_SUPPORT";
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
  mainContactName: string;
  mainContactEmail: string;
  mainContactPhone: string;
  billingContactName: string;
  billingContactEmail: string;
  billingContactPhone: string;
  billingAddress: string;
  paymentTerms: PaymentMethod;
  billingCycle: string;
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
  status: MasterStatus;
}

export interface Product {
  id: string;
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
  deliverySlaDays: number;
  preferredSupplierId?: string;
  preferredSupplierName?: string;
  status: MasterStatus;
  duplicateWarning?: boolean;
}

export interface Supplier {
  id: string;
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
  orderCode: string;
  requestDate: string;
  requestType: "Standard" | "Ad-hoc" | "Recurring";
  companyId: string;
  companyName: string;
  branchId: string;
  branchName: string;
  department: string;
  requestedBy: string;
  requesterContact: string;
  neededByDate: string;
  urgency: Urgency;
  status: RequestStatus;
  notes?: string;
  issueReason?: string;
  invoiceStatus: InvoiceStatus;
  paymentStatus: PaymentStatus;
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

export interface DashboardData extends FinancialTotals {
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

export interface QuotationRecord {
  id: string; requestLineId: string; requestLineCode: string; orderCode: string; productName: string;
  supplierId: string; supplierName: string; quotationReference: string; quotationDate: string;
  unitPrice: number; deliveryCharge: number; minimumOrderQuantity?: number; leadTimeDays?: number;
  validUntil?: string; status: string; selected: boolean; selectionReason?: string;
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
  paidAmount: number; outstandingAmount: number; paymentStatus: PaymentStatus;
}

export interface PaymentRecord {
  id: string; invoiceId: string; invoiceNumber: string; paymentDate: string; amount: number;
  method: PaymentMethod; reference?: string; recordedByName?: string;
}

export interface AuditRecord {
  id: string; entityType: string; recordId?: string; action: string; actorName?: string;
  reason?: string; occurredAt: string;
}

export interface AttachmentRecord {
  id: string; entityType: string; recordId: string; fileName: string; contentType: string;
  createdAt: string; uploadedByName?: string;
}

export interface UserRecord {
  id: string; email: string; displayName: string; role: UserRole; active: boolean; isOwner: boolean;
  lastLoginAt?: string; createdAt: string;
}
