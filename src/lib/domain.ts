import type { FinancialTotals, ProcurementRequest, RequestLine, RequestStatus } from "./types";

export const REQUEST_STATUSES: RequestStatus[] = [
  "New Request",
  "Under Verification",
  "Waiting for Quotation",
  "Waiting for Approval",
  "Approved",
  "Supplier Assigned",
  "Ordered",
  "Preparing for Delivery",
  "Out for Delivery",
  "Delivered",
  "Invoice Issued",
  "Completed",
  "On Hold",
  "Cancelled",
];

export function roundMoney(value: number) {
  return Math.sign(value) * Math.round((Math.abs(value) + Number.EPSILON) * 100) / 100;
}

export function calculateLineAmounts(line: Pick<RequestLine, "quantity" | "unitBuyPrice" | "unitSellPrice" | "deliveryCharge">) {
  const buyingCost = roundMoney(line.quantity * line.unitBuyPrice);
  const sales = roundMoney(line.quantity * line.unitSellPrice);
  const grossProfit = roundMoney(line.quantity * (line.unitSellPrice - line.unitBuyPrice));
  const grossMarginPercent = sales === 0 ? 0 : (grossProfit / sales) * 100;
  return { buyingCost, sales, grossProfit, grossMarginPercent, deliveryCharges: line.deliveryCharge };
}

export function calculateTotals(requests: ProcurementRequest[]): FinancialTotals {
  const totals = requests
    .filter((request) => request.status !== "Cancelled")
    .flatMap((request) => request.lines)
    .reduce(
      (sum, line) => {
        const current = calculateLineAmounts(line);
        sum.sales += current.sales;
        sum.buyingCost += current.buyingCost;
        sum.grossProfit += current.grossProfit;
        sum.deliveryCharges += current.deliveryCharges;
        return sum;
      },
      { sales: 0, buyingCost: 0, grossProfit: 0, grossMarginPercent: 0, deliveryCharges: 0 },
    );

  totals.grossMarginPercent = totals.sales === 0 ? 0 : (totals.grossProfit / totals.sales) * 100;
  return totals;
}

export function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-MY", { style: "currency", currency: "MYR", maximumFractionDigits: 2 }).format(value);
}

export function formatDate(value?: string) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-MY", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(value));
}

export function timeOfDayGreeting(date = new Date(), timeZone = "Asia/Kuala_Lumpur") {
  const hour = Number(new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    hourCycle: "h23",
    timeZone,
  }).format(date));
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export function statusTone(status: string) {
  const normalized = status.toLowerCase();
  if (["completed", "paid", "delivered", "active", "approved"].some((word) => normalized.includes(word))) return "success";
  if (["cancelled", "failed", "disputed", "overdue"].some((word) => normalized.includes(word))) return "danger";
  if (["urgent", "delayed", "hold", "partial"].some((word) => normalized.includes(word))) return "warning";
  if (["waiting", "pending", "new", "draft", "issued"].some((word) => normalized.includes(word))) return "info";
  return "neutral";
}
