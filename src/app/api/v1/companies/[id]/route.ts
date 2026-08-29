import { ExternalApiProblem, handleExternalApiRequest } from "@/lib/integrations/api-handler";
import { getExternalCompany } from "@/lib/integrations/resources";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return handleExternalApiRequest(request, {
    scope: "companies:read",action: "COMPANY_READ",resourceType: "company",
  }, async (principal) => {
    if (new URL(request.url).search) throw new ExternalApiProblem(
      "invalid_request",400,"INVALID","query","company",
    );
    const { id } = await context.params;
    return { data: await getExternalCompany(principal,id),resourceType: "company",resourceId: id };
  });
}
