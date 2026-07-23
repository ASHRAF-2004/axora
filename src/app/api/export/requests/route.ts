import { calculateLineAmounts } from "@/lib/domain";
import { listRequests } from "@/lib/repository";
import { getSession } from "@/lib/auth";

function csv(value: unknown) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export async function GET() {
  const user = await getSession();
  if (!user) return Response.json({ error: "Authentication required" }, { status: 401 });
  const requests = await listRequests();
  const rows = [["Order Group ID", "Request Line ID", "Request Date", "Company", "Branch", "Product", "Quantity", "Unit", "Status", "Supplier", "Buying Cost (RM)", "Sales (RM)", "Gross Profit (RM)", "Delivery Fee (RM)", "Payment Status"]];
  for (const request of requests) {
    for (const line of request.lines) {
      const amount = calculateLineAmounts(line);
      rows.push([request.orderCode, line.code, request.requestDate, request.companyName, request.branchName, line.productName, String(line.quantity), line.unit, request.status, line.supplierName ?? "", amount.buyingCost.toFixed(2), amount.sales.toFixed(2), amount.grossProfit.toFixed(2), line.deliveryCharge.toFixed(2), request.paymentStatus]);
    }
  }
  const body = `\uFEFF${rows.map((row) => row.map(csv).join(",")).join("\r\n")}`;
  return new Response(body, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": "attachment; filename=axora-requests.csv", "Cache-Control": "no-store" } });
}
