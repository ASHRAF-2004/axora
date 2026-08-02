import { calculateLineAmounts } from "@/lib/domain";
import { listRequests } from "@/lib/repository";
import { getSession } from "@/lib/auth";
import { canAccess } from "@/lib/permissions";
import { encodeCsvCell } from "@/lib/csv";

export async function GET() {
  const user = await getSession();
  if (!user) return Response.json({ error: "Authentication required" }, { status: 401 });
  if (!canAccess(user, "view_reports")) {
    return Response.json({ error: "You do not have permission to export reports." }, { status: 403 });
  }
  const requests = await listRequests();
  const canViewInvoices = canAccess(user, "view_invoices");
  const platformView = user.isOwner || user.accountKind === "PLATFORM";
  const ownerHeader = ["Order Group ID", "Request Line ID", "Request Date", "Company", "Branch", "Product", "Quantity", "Unit", "Status", "Supplier", "Buying Cost (RM)", "Sales (RM)", "Gross Profit (RM)", "Delivery Fee (RM)", "Payment Status"];
  const companyHeader = ["Request ID", "Request Line ID", "Request Date", "Branch", "Requested By", "Product", "Quantity", "Unit", "Approval", "Fulfilment Status", "Estimated Line Total (RM)"];
  if (canViewInvoices) companyHeader.push("Payment Status");
  const rows: string[][] = [platformView ? ownerHeader : companyHeader];
  for (const request of requests) {
    for (const line of request.lines) {
      if (platformView) {
        const amount = calculateLineAmounts(line);
        rows.push([request.orderCode, line.code, request.requestDate, request.companyName, request.branchName, line.productName, String(line.quantity), line.unit, request.status, line.supplierName ?? "", amount.buyingCost.toFixed(2), amount.sales.toFixed(2), amount.grossProfit.toFixed(2), line.deliveryCharge.toFixed(2), request.paymentStatus ?? ""]);
      } else {
        const row = [request.orderCode, line.code, request.requestDate, request.branchName, request.requestedBy, line.productName, String(line.quantity), line.unit,
          request.approvalStatus, request.status, calculateLineAmounts(line).sales.toFixed(2)];
        if (canViewInvoices) row.push(request.paymentStatus ?? "");
        rows.push(row);
      }
    }
  }
  const body = `\uFEFF${rows.map((row) => row.map(encodeCsvCell).join(",")).join("\r\n")}`;
  const fileName = platformView ? "axora-operations-requests.csv" : "axora-company-requests.csv";
  return new Response(body, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename=${fileName}`, "Cache-Control": "no-store" } });
}
