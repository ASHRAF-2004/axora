export type ReceiptDiscrepancyCode =
  | "NONE"
  | "DAMAGED"
  | "SHORT"
  | "OVER"
  | "WRONG_ITEM"
  | "QUALITY"
  | "OTHER";

export type ReceiptStatus = "ACCEPTED" | "ACCEPTED_WITH_EXCEPTIONS" | "REJECTED";

export interface ReceiptLineCalculation {
  plannedQuantity: number;
  deliveredQuantity: number;
  acceptedQuantity: number;
  rejectedQuantity: number;
  damagedQuantity: number;
  shortQuantity: number;
  discrepancyCode: ReceiptDiscrepancyCode;
  discrepancyNote?: string;
}

export interface CalculateReceiptLineInput {
  plannedQuantity: number;
  deliveredQuantity: number;
  acceptedQuantity: number;
  rejectedQuantity?: number;
  damagedQuantity?: number;
  discrepancyCode?: Exclude<ReceiptDiscrepancyCode, "NONE" | "DAMAGED" | "SHORT" | "OVER">;
  discrepancyNote?: string;
}

const QUANTITY_SCALE = 1_000;
const EPSILON = 0.000_5;

function quantity(value: number, label: string, allowZero = true) {
  if (!Number.isFinite(value) || value < 0 || (!allowZero && value === 0)) {
    throw new Error(`${label} must be ${allowZero ? "non-negative" : "positive"}.`);
  }
  return Math.round(value * QUANTITY_SCALE) / QUANTITY_SCALE;
}

function approximatelyEqual(left: number, right: number) {
  return Math.abs(left - right) < EPSILON;
}

function signedQuantity(value: number, label: string) {
  if (!Number.isFinite(value)) throw new Error(`${label} must be finite.`);
  return Math.round(value * QUANTITY_SCALE) / QUANTITY_SCALE;
}

function money(value: number, label: string) {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${label} must be non-negative.`);
  return Math.round(value * 100) / 100;
}

export function calculateReceiptLine(
  input: CalculateReceiptLineInput,
): ReceiptLineCalculation {
  const plannedQuantity = quantity(input.plannedQuantity, "Planned quantity", false);
  const deliveredQuantity = quantity(input.deliveredQuantity, "Delivered quantity");
  const acceptedQuantity = quantity(input.acceptedQuantity, "Accepted quantity");
  const rejectedQuantity = input.rejectedQuantity === undefined
    ? quantity(deliveredQuantity - acceptedQuantity, "Rejected quantity")
    : quantity(input.rejectedQuantity, "Rejected quantity");
  const damagedQuantity = quantity(input.damagedQuantity ?? 0, "Damaged quantity");
  if (!approximatelyEqual(acceptedQuantity + rejectedQuantity, deliveredQuantity)) {
    throw new Error("Accepted and rejected quantities must equal delivered quantity.");
  }
  if (damagedQuantity > rejectedQuantity) {
    throw new Error("Damaged quantity cannot exceed rejected quantity.");
  }
  const shortQuantity = quantity(Math.max(plannedQuantity - deliveredQuantity, 0), "Short quantity");
  const overQuantity = quantity(Math.max(deliveredQuantity - plannedQuantity, 0), "Over quantity");
  let discrepancyCode: ReceiptDiscrepancyCode = "NONE";
  if (input.discrepancyCode) discrepancyCode = input.discrepancyCode;
  else if (damagedQuantity > 0) discrepancyCode = "DAMAGED";
  else if (shortQuantity > 0) discrepancyCode = "SHORT";
  else if (overQuantity > 0) discrepancyCode = "OVER";
  else if (rejectedQuantity > 0) discrepancyCode = "OTHER";

  if (discrepancyCode !== "NONE"
    && rejectedQuantity === 0
    && damagedQuantity === 0
    && shortQuantity === 0
    && overQuantity === 0) {
    throw new Error("A receipt discrepancy requires a quantity difference or rejection.");
  }

  const discrepancyNote = input.discrepancyNote?.trim() || undefined;
  if (discrepancyNote && discrepancyNote.length > 2_000) {
    throw new Error("Receipt discrepancy note is too long.");
  }
  return {
    plannedQuantity,
    deliveredQuantity,
    acceptedQuantity,
    rejectedQuantity,
    damagedQuantity,
    shortQuantity,
    discrepancyCode,
    ...(discrepancyNote ? { discrepancyNote } : {}),
  };
}

export function receiptStatusFromLines(
  lines: readonly ReceiptLineCalculation[],
): ReceiptStatus {
  if (lines.length === 0) throw new Error("A receipt requires at least one line.");
  const accepted = lines.reduce((total, line) => total + line.acceptedQuantity, 0);
  const delivered = lines.reduce((total, line) => total + line.deliveredQuantity, 0);
  if (accepted === 0 && delivered > 0) return "REJECTED";
  if (lines.every((line) => line.discrepancyCode === "NONE")) return "ACCEPTED";
  return "ACCEPTED_WITH_EXCEPTIONS";
}

export function assertCustomerReceivingActor(input: {
  receivingUserId: string;
  accountKind: string;
  activeCompanyMembership: boolean;
  activeBranchAssignment: boolean;
  roleKeys: readonly string[];
  assignedDriverUserIds: readonly string[];
}) {
  if (input.accountKind !== "COMPANY"
    || !input.activeCompanyMembership
    || !input.activeBranchAssignment
    || !input.roleKeys.some((role) => role === "RECEIVING_USER" || role === "COMPANY_ADMIN")) {
    throw new Error("Receipt confirmation requires a scoped customer receiving user.");
  }
  if (input.assignedDriverUserIds.includes(input.receivingUserId)) {
    throw new Error("Driver evidence cannot be used as customer receiving confirmation.");
  }
}

export type ThreeWayMatchStatus = "NOT_READY" | "MATCHED" | "EXCEPTION" | "OVERRIDDEN";

export type ThreeWayMatchExceptionCode =
  | "MISSING_QUOTATION"
  | "MISSING_RECEIPT"
  | "MISSING_INVOICE"
  | "QUANTITY_VARIANCE"
  | "PRICE_VARIANCE";

export interface ThreeWayMatchEvaluation {
  status: Exclude<ThreeWayMatchStatus, "OVERRIDDEN">;
  orderedQuantity: number;
  receivedQuantity?: number;
  invoicedQuantity?: number;
  orderedUnitPrice?: number;
  invoicedUnitPrice?: number;
  quantityVariance?: number;
  priceVariance?: number;
  exceptions: ThreeWayMatchExceptionCode[];
}

export function evaluateThreeWayMatch(input: {
  orderedQuantity: number;
  receivedQuantity?: number | null;
  invoicedQuantity?: number | null;
  orderedUnitPrice?: number | null;
  invoicedUnitPrice?: number | null;
  quantityTolerance?: number;
  priceTolerance?: number;
}): ThreeWayMatchEvaluation {
  const orderedQuantity = quantity(input.orderedQuantity, "Ordered quantity", false);
  const receivedQuantity = input.receivedQuantity == null
    ? undefined
    : quantity(input.receivedQuantity, "Received quantity");
  const invoicedQuantity = input.invoicedQuantity == null
    ? undefined
    : quantity(input.invoicedQuantity, "Invoiced quantity");
  const orderedUnitPrice = input.orderedUnitPrice == null
    ? undefined
    : money(input.orderedUnitPrice, "Ordered unit price");
  const invoicedUnitPrice = input.invoicedUnitPrice == null
    ? undefined
    : money(input.invoicedUnitPrice, "Invoiced unit price");
  const quantityTolerance = quantity(input.quantityTolerance ?? 0, "Quantity tolerance");
  const priceTolerance = money(input.priceTolerance ?? 0, "Price tolerance");
  const exceptions: ThreeWayMatchExceptionCode[] = [];
  if (orderedUnitPrice === undefined) exceptions.push("MISSING_QUOTATION");
  if (receivedQuantity === undefined) exceptions.push("MISSING_RECEIPT");
  if (invoicedQuantity === undefined || invoicedUnitPrice === undefined) {
    exceptions.push("MISSING_INVOICE");
  }

  const quantityVariance = receivedQuantity === undefined || invoicedQuantity === undefined
    ? undefined
    : signedQuantity(invoicedQuantity - receivedQuantity, "Quantity variance");
  if (receivedQuantity !== undefined && invoicedQuantity !== undefined
    && (Math.abs(receivedQuantity - orderedQuantity) > quantityTolerance + EPSILON
      || Math.abs(invoicedQuantity - receivedQuantity) > quantityTolerance + EPSILON)) {
    exceptions.push("QUANTITY_VARIANCE");
  }
  const priceVariance = orderedUnitPrice === undefined || invoicedUnitPrice === undefined
    ? undefined
    : Math.round((invoicedUnitPrice - orderedUnitPrice) * 100) / 100;
  if (priceVariance !== undefined && Math.abs(priceVariance) > priceTolerance + EPSILON) {
    exceptions.push("PRICE_VARIANCE");
  }
  const missingEvidence = exceptions.some((code) => code.startsWith("MISSING_"));
  return {
    status: missingEvidence ? "NOT_READY" : exceptions.length ? "EXCEPTION" : "MATCHED",
    orderedQuantity,
    ...(receivedQuantity !== undefined ? { receivedQuantity } : {}),
    ...(invoicedQuantity !== undefined ? { invoicedQuantity } : {}),
    ...(orderedUnitPrice !== undefined ? { orderedUnitPrice } : {}),
    ...(invoicedUnitPrice !== undefined ? { invoicedUnitPrice } : {}),
    ...(quantityVariance !== undefined ? { quantityVariance } : {}),
    ...(priceVariance !== undefined ? { priceVariance } : {}),
    exceptions: [...new Set(exceptions)],
  };
}

export function assertIndependentMatchOverride(input: {
  evaluatorUserId: string;
  receivingUserId?: string | null;
  overridingUserId: string;
  overridingRoleKeys: readonly string[];
  overrideReason: string;
}) {
  if (!input.overridingRoleKeys.some((role) => (
    role === "FINANCE_REVIEWER"
      || role === "PLATFORM_OWNER"
      || role === "PLATFORM_OPERATIONS"
  ))) {
    throw new Error("A three-way match override requires a finance reviewer.");
  }
  if (input.overridingUserId === input.evaluatorUserId
    || input.overridingUserId === input.receivingUserId) {
    throw new Error("A three-way match override requires independent review.");
  }
  const reason = input.overrideReason.trim();
  if (reason.length < 3 || reason.length > 1_000) {
    throw new Error("A match override requires a concise reason.");
  }
  return reason;
}
