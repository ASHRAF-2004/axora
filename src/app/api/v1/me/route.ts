import { ExternalApiProblem, handleExternalApiRequest } from "@/lib/integrations/api-handler";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return handleExternalApiRequest(request, {
    action: "ME_READ",resourceType: "integration_principal",
  }, async (principal) => {
    if (new URL(request.url).search) {
      throw new ExternalApiProblem("invalid_request",400,"INVALID","query");
    }
    return {
      data: {
        user: {
          id: principal.actor.id,name: principal.actor.name,email: principal.actor.email,
          role: principal.actor.role,account_kind: principal.actor.accountKind,
          scope_type: principal.actor.scopeType,company_id: principal.actor.companyId,
          branch_id: principal.actor.branchId,department_id: principal.actor.departmentId,
        },
        connection: {
          id: principal.connectionId,company_id: principal.companyId,
          application_id: principal.applicationId,client_id: principal.clientId,
        },
        scopes: principal.scopes,
        access_token_expires_at: principal.expiresAt.toISOString(),
      },
      resourceType: "integration_principal",
    };
  });
}
