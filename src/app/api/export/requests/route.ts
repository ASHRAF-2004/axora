import { recordAccountabilityAccess } from "@/lib/audit-accountability";
import { getSession } from "@/lib/auth";
import { encodeCsvCell } from "@/lib/csv";
import { isPlatformAnalyticsActor } from "@/lib/dashboard-data";
import { calculateLineAmounts } from "@/lib/domain";
import { canAccess } from "@/lib/permissions";
import { normalizeRequestFilters } from "@/lib/request-filters";
import { listAuthorizedFilteredRequests } from "@/lib/request-reader";

export async function GET(request: Request) {
  const user=await getSession();
  if (!user) return Response.json({error:"Authentication required"},{status:401});
  if (!canAccess(user,"view_reports")) {
    return Response.json({error:"You do not have permission to export reports."},{status:403});
  }
  const filters=normalizeRequestFilters(new URL(request.url).searchParams);
  const requests=await listAuthorizedFilteredRequests(user,filters);
  const canViewInvoices=requests.some((item) => item.invoiceStatus!==undefined
    || item.paymentStatus!==undefined || item.invoiceNumber!==undefined);
  const platformView=isPlatformAnalyticsActor(user);
  const ownerHeader=["Order Group ID","Request Line ID","Request Date","Company","Branch","Product","Quantity","Unit","Status","Supplier","Buying Cost (RM)","Sales (RM)","Gross Profit (RM)","Delivery Fee (RM)","Payment Status"];
  const companyHeader=["Request ID","Request Line ID","Request Date","Branch","Requested By","Product","Quantity","Unit","Approval","Fulfilment Status","Estimated Line Total (RM)"];
  if (canViewInvoices) companyHeader.push("Payment Status");
  const rows:string[][]=[platformView ? ownerHeader : companyHeader];
  for (const item of requests) {
    for (const line of item.lines) {
      if (platformView) {
        const amount=calculateLineAmounts(line);
        rows.push([item.orderCode,line.code,item.requestDate,item.companyName,item.branchName,line.productName,String(line.quantity),line.unit,item.status,line.supplierName ?? "",amount.buyingCost.toFixed(2),amount.sales.toFixed(2),amount.grossProfit.toFixed(2),line.deliveryCharge.toFixed(2),item.paymentStatus ?? ""]);
      } else {
        const row=[item.orderCode,line.code,item.requestDate,item.branchName,item.requestedBy,line.productName,String(line.quantity),line.unit,item.approvalStatus,item.status,calculateLineAmounts(line).sales.toFixed(2)];
        if (canViewInvoices) row.push(item.paymentStatus ?? "");
        rows.push(row);
      }
    }
  }
  const body=`\uFEFF${rows.map((row) => row.map(encodeCsvCell).join(",")).join("\r\n")}`;
  const fileName=platformView ? "axora-operations-requests.csv" : "axora-company-requests.csv";
  await recordAccountabilityAccess(user,"REQUEST_EXPORT",user.companyId ?? null,rows.length-1);
  return new Response(body,{headers:{"Content-Type":"text/csv; charset=utf-8","Content-Disposition":`attachment; filename=${fileName}`,"Cache-Control":"private, no-store",Vary:"Cookie"}});
}
