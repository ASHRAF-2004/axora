import { ExternalApiProblem, handleExternalApiRequest } from "@/lib/integrations/api-handler";
import { getExternalRequest } from "@/lib/integrations/resources";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return handleExternalApiRequest(request, {
    scope: "requests:read",action: "REQUEST_READ",resourceType: "request",
  }, async (principal) => {
    if (new URL(request.url).search) throw new ExternalApiProblem(
      "invalid_request",400,"INVALID","query","request",
    );
    const { id } = await context.params;
    return { data: await getExternalRequest(principal,id),resourceType: "request",resourceId: id };
  });
}
