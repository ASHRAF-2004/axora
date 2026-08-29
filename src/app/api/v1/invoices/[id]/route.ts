import { ExternalApiProblem, handleExternalApiRequest } from "@/lib/integrations/api-handler";
import { getExternalInvoice } from "@/lib/integrations/resources";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return handleExternalApiRequest(request, {
    scope: "invoices:read",action: "INVOICE_READ",resourceType: "invoice",
  }, async (principal) => {
    if (new URL(request.url).search) throw new ExternalApiProblem(
      "invalid_request",400,"INVALID","query","invoice",
    );
    const { id } = await context.params;
    return { data: await getExternalInvoice(principal,id),resourceType: "invoice",resourceId: id };
  });
}
