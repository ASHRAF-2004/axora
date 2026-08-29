import { ExternalApiProblem, handleExternalApiRequest } from "@/lib/integrations/api-handler";
import { getExternalDelivery } from "@/lib/integrations/resources";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return handleExternalApiRequest(request, {
    scope: "deliveries:read",action: "DELIVERY_READ",resourceType: "delivery",
  }, async (principal) => {
    if (new URL(request.url).search) throw new ExternalApiProblem(
      "invalid_request",400,"INVALID","query","delivery",
    );
    const { id } = await context.params;
    return { data: await getExternalDelivery(principal,id),resourceType: "delivery",resourceId: id };
  });
}
