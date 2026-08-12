import { STANDARD_BILLING_TERMS } from "./types";
import { roundMoney } from "./domain";
import type { Branch, Company, ProcurementRequest, Product, Supplier } from "./types";

export interface DemoStore {
  companies: Company[];
  branches: Branch[];
  products: Product[];
  suppliers: Supplier[];
  requests: ProcurementRequest[];
}

const companies: Company[] = [
  { id: "co-youruni", code: "C-001", name: "YourUni", industry: "Education", mainContactName: "Pilot coordinator", mainContactEmail: "coordinator@youruni.example", mainContactPhone: "012-000-1001", billingContactName: "Finance desk", billingContactEmail: "finance@youruni.example", billingContactPhone: "012-000-1002", billingAddress: "Kuala Lumpur", paymentTerms: STANDARD_BILLING_TERMS, billingCycle: "Monthly", taxRate: 0, estimatedDeliveryFee: 0, status: "Active" },
  { id: "co-excel", code: "C-002", name: "Excel Language Centre", industry: "Education", mainContactName: "Operations coordinator", mainContactEmail: "operations@excel.example", mainContactPhone: "013-000-2001", billingContactName: "Finance desk", billingContactEmail: "finance@excel.example", billingContactPhone: "013-000-2002", billingAddress: "Petaling Jaya", paymentTerms: STANDARD_BILLING_TERMS, billingCycle: "Monthly", taxRate: 0, estimatedDeliveryFee: 0, status: "Active" },
  { id: "co-unibax", code: "C-003", name: "Unibax", industry: "Business services", mainContactName: "Office coordinator", mainContactEmail: "office@unibax.example", mainContactPhone: "014-000-3001", billingContactName: "Finance desk", billingContactEmail: "finance@unibax.example", billingContactPhone: "014-000-3002", billingAddress: "Shah Alam", paymentTerms: STANDARD_BILLING_TERMS, billingCycle: "Monthly", taxRate: 0, estimatedDeliveryFee: 0, status: "Active" },
];

const branches: Branch[] = [
  { id: "br-youruni-main", code: "B-001", companyId: "co-youruni", companyName: "YourUni", name: "YourUni main campus", branchCode: "YU-MAIN", deliveryAddress: "Kuala Lumpur", city: "Kuala Lumpur", contactName: "Campus reception", contactPhone: "012-000-1100", contactEmail: "reception@youruni.example", deliveryInstructions: "Call reception before delivery.", monthlyBudget: 5000, committedAmount: 1540, remainingAmount: 3460, status: "Active" },
  { id: "br-excel-hq", code: "B-002", companyId: "co-excel", companyName: "Excel Language Centre", name: "Excel HQ", branchCode: "EX-HQ", deliveryAddress: "Petaling Jaya", city: "Petaling Jaya", contactName: "HQ reception", contactPhone: "013-000-2200", contactEmail: "reception@excel.example", monthlyBudget: 4000, committedAmount: 830, remainingAmount: 3170, status: "Active" },
  { id: "br-unibax-centre", code: "B-003", companyId: "co-unibax", companyName: "Unibax", name: "Unibax centre", branchCode: "UB-CEN", deliveryAddress: "Shah Alam", city: "Shah Alam", contactName: "Centre reception", contactPhone: "014-000-3300", contactEmail: "reception@unibax.example", monthlyBudget: 3500, committedAmount: 620, remainingAmount: 2880, status: "Active" },
];

const suppliers: Supplier[] = [
  ["S-001", "Office World", "Office Basics", "Klang Valley", 1, "Paper, pens"],
  ["S-002", "Pantry Plus", "Pantry / Hospitality", "Klang Valley", 1, "Beverages, cups"],
  ["S-003", "Stationery Hub", "Office Basics", "Klang Valley", 2, "Folders, notebooks"],
  ["S-004", "CleanPro Supplies", "Cleaning & Hygiene", "Selangor", 1, "Tissue, detergent"],
  ["S-005", "PrintMaster", "Printing & Branding / Marketing", "Klang Valley", 3, "Cards, banners"],
  ["S-006", "Hospitality Wholesalers", "Pantry / Hospitality", "Klang Valley", 2, "Cutlery, napkins"],
  ["S-007", "Hygiene Masters", "Cleaning & Hygiene", "Selangor", 1, "Soap, sanitizer"],
  ["S-008", "Tech Office Supply", "Office Basics", "Kuala Lumpur", 3, "Accessories"],
  ["S-009", "QuickPrint", "Printing & Branding / Marketing", "Petaling Jaya", 2, "Labels, flyers"],
  ["S-010", "Beverage Source", "Pantry / Hospitality", "Klang Valley", 1, "Water, tea, coffee"],
].map(([code, name, category, coverageArea, leadTimeDays, mainProducts], index) => ({
  id: `su-${index + 1}`,
  code: String(code),
  name: String(name),
  category: String(category),
  contactName: "Sales desk",
  phone: `011-000-${String(index + 1).padStart(4, "0")}`,
  email: `sales${index + 1}@supplier.example`,
  address: `${String(name)} demo address`,
  coverageArea: String(coverageArea),
  paymentTerms: STANDARD_BILLING_TERMS,
  leadTimeDays: Number(leadTimeDays),
  minimumOrderQuantity: 1,
  mainProducts: String(mainProducts),
  status: "Active" as const,
}));

const productDefinitions: Array<[string, string, string, string, string, number, number, number, number, number]> = [
  ["AX-CLN-001", "Toilet tissue roll", "Cleaning & Hygiene", "Tissue", "Roll", 50, 60, 12, 2, 4],
  ["AX-CLN-002", "Dishwashing liquid", "Cleaning & Hygiene", "Cleaning liquid", "Bottle", 10, 15, 3, 2, 4],
  ["AX-PAN-001", "Paper cup - white", "Pantry / Hospitality", "Disposable cups", "Pack", 5, 8, 1, 1, 2],
  ["AX-OFF-001", "A4 paper 70gsm", "Office Basics", "Paper", "Ream", 10, 14, 5, 1, 1],
  ["AX-PRN-001", "Business cards 100s", "Printing & Branding / Marketing", "Cards", "Box", 25, 40, 1, 3, 5],
  ["AX-PAN-002", "Mineral water carton", "Pantry / Hospitality", "Beverages", "Carton", 12, 18, 1, 1, 2],
  ["AX-PAN-003", "Tea bags 100s", "Pantry / Hospitality", "Beverages", "Box", 15, 22, 1, 1, 10],
  ["AX-PAN-004", "Instant coffee", "Pantry / Hospitality", "Beverages", "Jar", 18, 27, 1, 1, 10],
  ["AX-OFF-002", "Blue ballpoint pens", "Office Basics", "Writing", "Box", 9, 14, 1, 1, 3],
  ["AX-OFF-003", "Lever arch file", "Office Basics", "Filing", "Piece", 6, 10, 1, 2, 3],
  ["AX-OFF-004", "Sticky notes", "Office Basics", "Desk supplies", "Pack", 4, 7, 1, 1, 3],
  ["AX-OFF-005", "Whiteboard markers", "Office Basics", "Writing", "Pack", 12, 18, 1, 1, 3],
  ["AX-CLN-003", "Hand wash", "Cleaning & Hygiene", "Hand hygiene", "Bottle", 8, 13, 2, 1, 7],
  ["AX-CLN-004", "Surface sanitizer", "Cleaning & Hygiene", "Sanitizer", "Bottle", 14, 21, 2, 1, 7],
  ["AX-CLN-005", "Microfiber cloth", "Cleaning & Hygiene", "Cloths", "Pack", 7, 11, 2, 2, 4],
  ["AX-PAN-005", "Wooden stirrers", "Pantry / Hospitality", "Disposable", "Pack", 3, 6, 2, 1, 6],
  ["AX-PAN-006", "Paper napkins", "Pantry / Hospitality", "Disposable", "Pack", 4, 7, 2, 1, 6],
  ["AX-PRN-002", "A5 flyers", "Printing & Branding / Marketing", "Flyers", "Pack", 35, 55, 1, 3, 9],
  ["AX-PRN-003", "Name labels", "Printing & Branding / Marketing", "Labels", "Sheet", 8, 14, 1, 2, 9],
  ["AX-OFF-006", "USB keyboard", "Office Basics", "Computer accessories", "Piece", 35, 49, 1, 3, 8],
  ["AX-OFF-007", "Wireless mouse", "Office Basics", "Computer accessories", "Piece", 28, 42, 1, 3, 8],
  ["AX-OFF-008", "A4 envelopes", "Office Basics", "Mailing", "Pack", 10, 16, 1, 1, 1],
  ["AX-OFF-009", "Highlighters 4s", "Office Basics", "Writing", "Pack", 8, 13, 1, 1, 3],
  ["AX-OFF-010", "Desk organizer", "Office Basics", "Desk supplies", "Piece", 16, 24, 1, 2, 3],
  ["AX-OFF-011", "Highlighters 4s", "Office Basics", "Writing", "Pack", 8, 13, 1, 1, 3],
];

const products: Product[] = productDefinitions.map(([code, name, category, subcategory, unit, defaultBuyPrice, defaultSellPrice, minimumOrderQuantity, deliverySlaDays, supplierIndex], index) => ({
  id: `pr-${index + 1}`,
  code,
  name,
  category,
  subcategory,
  unit,
  defaultBuyPrice,
  defaultSellPrice,
  minimumOrderQuantity,
  deliverySlaDays,
  preferredSupplierId: `su-${supplierIndex}`,
  preferredSupplierName: suppliers[supplierIndex - 1]?.name,
  hasImage: false,
  imageAltText: `${name} product image`,
  status: index === 24 ? "Needs Review" : "Active",
  duplicateWarning: index === 24,
}));

function line(index: number, productIndex: number, quantity: number, options: Partial<ProcurementRequest["lines"][number]> = {}): ProcurementRequest["lines"][number] {
  const product = products[productIndex];
  return {
    id: `line-${index}`,
    code: `REQ-2026-${String(index).padStart(5, "0")}`,
    productId: product.id,
    productCode: product.code,
    productName: product.name,
    category: product.category,
    subcategory: product.subcategory,
    quantity,
    unit: product.unit,
    supplierId: product.preferredSupplierId,
    supplierName: product.preferredSupplierName,
    supplierConfirmationStatus: "Confirmed",
    unitBuyPrice: product.defaultBuyPrice,
    unitSellPrice: product.defaultSellPrice,
    deliveryCharge: 5,
    deliveryStatus: "Not Scheduled",
    quantityReceived: 0,
    ...options,
  };
}

const scenarios: Array<Omit<ProcurementRequest, "id" | "orderCode" | "requestDate" | "lines" | "approvalStatus" | "estimatedTotal"> & { products: Array<[number, number, Partial<ProcurementRequest["lines"][number]>?]> }> = [
  { requestType: "Standard", companyId: "co-youruni", companyName: "YourUni", branchId: "br-youruni-main", branchName: "YourUni main campus", department: "Administration", requestedBy: "Pilot user", requesterContact: "012-000-0000", neededByDate: "2026-07-25", urgency: "Normal", status: "New Request", invoiceStatus: "Not Issued", paymentStatus: "Unpaid", products: [[3, 10]] },
  { requestType: "Standard", companyId: "co-youruni", companyName: "YourUni", branchId: "br-youruni-main", branchName: "YourUni main campus", department: "Student services", requestedBy: "Pilot user", requesterContact: "012-000-0000", neededByDate: "2026-07-26", urgency: "Normal", status: "Under Verification", invoiceStatus: "Not Issued", paymentStatus: "Unpaid", products: [[5, 5], [2, 5]] },
  { requestType: "Ad-hoc", companyId: "co-youruni", companyName: "YourUni", branchId: "br-youruni-main", branchName: "YourUni main campus", department: "Events", requestedBy: "Pilot user", requesterContact: "012-000-0000", neededByDate: "2026-07-23", urgency: "Urgent", status: "Waiting for Quotation", invoiceStatus: "Not Issued", paymentStatus: "Unpaid", products: [[17, 2]] },
  { requestType: "Ad-hoc", companyId: "co-youruni", companyName: "YourUni", branchId: "br-youruni-main", branchName: "YourUni main campus", department: "Marketing", requestedBy: "Pilot user", requesterContact: "012-000-0000", neededByDate: "2026-07-30", urgency: "High", status: "Waiting for Approval", invoiceStatus: "Not Issued", paymentStatus: "Unpaid", notes: "New branded folder requested; specification review required.", products: [[18, 4]] },
  { requestType: "Standard", companyId: "co-youruni", companyName: "YourUni", branchId: "br-youruni-main", branchName: "YourUni main campus", department: "Finance", requestedBy: "Pilot user", requesterContact: "012-000-0000", neededByDate: "2026-07-27", urgency: "Normal", status: "Cancelled", invoiceStatus: "Cancelled", paymentStatus: "Void", issueReason: "Duplicate request submitted during test.", products: [[21, 2]] },
  { requestType: "Standard", companyId: "co-excel", companyName: "Excel Language Centre", branchId: "br-excel-hq", branchName: "Excel HQ", department: "IT", requestedBy: "Pilot user", requesterContact: "013-000-0000", neededByDate: "2026-07-28", urgency: "High", status: "Supplier Assigned", invoiceStatus: "Not Issued", paymentStatus: "Unpaid", products: [[19, 4]] },
  { requestType: "Ad-hoc", companyId: "co-excel", companyName: "Excel Language Centre", branchId: "br-excel-hq", branchName: "Excel HQ", department: "Facilities", requestedBy: "Pilot user", requesterContact: "013-000-0000", neededByDate: "2026-07-29", urgency: "Normal", status: "Waiting for Quotation", invoiceStatus: "Not Issued", paymentStatus: "Unpaid", notes: "Testing a supplier not yet in the approved master.", products: [[14, 3, { supplierId: undefined, supplierName: "New supplier test", supplierConfirmationStatus: "Quotation Requested" }]] },
  { requestType: "Standard", companyId: "co-excel", companyName: "Excel Language Centre", branchId: "br-excel-hq", branchName: "Excel HQ", department: "Administration", requestedBy: "Pilot user", requesterContact: "013-000-0000", neededByDate: "2026-07-21", urgency: "Urgent", status: "Out for Delivery", invoiceStatus: "Not Issued", paymentStatus: "Unpaid", issueReason: "Supplier vehicle delay.", products: [[0, 6, { deliveryStatus: "Delayed", expectedDeliveryDate: "2026-07-21" }]] },
  { requestType: "Standard", companyId: "co-excel", companyName: "Excel Language Centre", branchId: "br-excel-hq", branchName: "Excel HQ", department: "Accounts", requestedBy: "Pilot user", requesterContact: "013-000-0000", neededByDate: "2026-07-20", urgency: "Normal", status: "Completed", invoiceStatus: "Issued", paymentStatus: "Paid", invoiceNumber: "CINV-DEMO-009", completedDate: "2026-07-20", products: [[9, 10, { deliveryStatus: "Delivered", quantityReceived: 10, actualDeliveryDate: "2026-07-20" }]] },
  { requestType: "Standard", companyId: "co-excel", companyName: "Excel Language Centre", branchId: "br-excel-hq", branchName: "Excel HQ", department: "Teaching", requestedBy: "Pilot user", requesterContact: "013-000-0000", neededByDate: "2026-07-31", urgency: "Low", status: "On Hold", invoiceStatus: "Not Issued", paymentStatus: "Unpaid", issueReason: "Duplicate product record must be reviewed.", products: [[24, 3]] },
  { requestType: "Ad-hoc", companyId: "co-unibax", companyName: "Unibax", branchId: "br-unibax-centre", branchName: "Unibax centre", department: "Operations", requestedBy: "Pilot user", requesterContact: "014-000-0000", neededByDate: "2026-07-19", urgency: "Normal", status: "Completed", invoiceStatus: "Issued", paymentStatus: "Paid", invoiceNumber: "CINV-DEMO-011", completedDate: "2026-07-19", products: [[4, 1, { deliveryStatus: "Delivered", quantityReceived: 1, actualDeliveryDate: "2026-07-19" }]] },
  { requestType: "Standard", companyId: "co-unibax", companyName: "Unibax", branchId: "br-unibax-centre", branchName: "Unibax centre", department: "Administration", requestedBy: "Pilot user", requesterContact: "014-000-0000", neededByDate: "2026-07-22", urgency: "High", status: "Invoice Issued", invoiceStatus: "Issued", paymentStatus: "Unpaid", invoiceNumber: "CINV-DEMO-012", products: [[7, 3, { deliveryStatus: "Delivered", quantityReceived: 3, actualDeliveryDate: "2026-07-22" }]] },
  { requestType: "Standard", companyId: "co-unibax", companyName: "Unibax", branchId: "br-unibax-centre", branchName: "Unibax centre", department: "Facilities", requestedBy: "Pilot user", requesterContact: "014-000-0000", neededByDate: "2026-07-24", urgency: "Normal", status: "Preparing for Delivery", invoiceStatus: "Not Issued", paymentStatus: "Unpaid", products: [[12, 8, { deliveryStatus: "Partially Delivered", quantityReceived: 4, expectedDeliveryDate: "2026-07-24" }]] },
  { requestType: "Ad-hoc", companyId: "co-unibax", companyName: "Unibax", branchId: "br-unibax-centre", branchName: "Unibax centre", department: "Marketing", requestedBy: "Pilot user", requesterContact: "014-000-0000", neededByDate: "2026-08-02", urgency: "Normal", status: "Waiting for Quotation", invoiceStatus: "Not Issued", paymentStatus: "Unpaid", products: [[16, 10, { quotationReference: "QT-DEMO-014", supplierConfirmationStatus: "Quotation Received" }]] },
  { requestType: "Recurring", companyId: "co-unibax", companyName: "Unibax", branchId: "br-unibax-centre", branchName: "Unibax centre", department: "Office", requestedBy: "Pilot user", requesterContact: "014-000-0000", neededByDate: "2026-08-01", urgency: "Low", status: "Approved", invoiceStatus: "Not Issued", paymentStatus: "Unpaid", products: [[6, 2], [8, 2]] },
];

const requests: ProcurementRequest[] = scenarios.map((scenario, requestIndex) => {
  const { products: requestedProducts, ...request } = scenario;
  let lineIndex = requestIndex * 3 + 1;
  const lines = requestedProducts.map(([productIndex, quantity, options]) => line(lineIndex++, productIndex, quantity, options));
  const isRejected = request.status === "Cancelled";
  const isAwaitingApproval = request.status === "New Request";
  return {
    ...request,
    id: `order-${requestIndex + 1}`,
    orderCode: `ORD-2026-${String(requestIndex + 1).padStart(3, "0")}`,
    requestDate: `2026-07-${String(Math.min(22, 8 + requestIndex)).padStart(2, "0")}`,
    approvalStatus: isRejected ? "Rejected" : isAwaitingApproval ? "Pending" : "Approved",
    approvalReason: isRejected ? request.issueReason : undefined,
    estimatedTotal: lines.reduce((total, item) => total + roundMoney(item.quantity * item.unitSellPrice), 0),
    lines,
  };
});

const globalStore = globalThis as typeof globalThis & { __axoraDemoStore?: DemoStore };

export function getDemoStore(): DemoStore {
  if (!globalStore.__axoraDemoStore) {
    globalStore.__axoraDemoStore = {
      companies: structuredClone(companies),
      branches: structuredClone(branches),
      products: structuredClone(products),
      suppliers: structuredClone(suppliers),
      requests: structuredClone(requests),
    };
  }
  return globalStore.__axoraDemoStore;
}
