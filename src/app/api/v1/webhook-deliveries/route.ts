import { ExternalApiProblem, handleExternalApiRequest } from "@/lib/integrations/api-handler";
import { integrationWebhooksEnabled } from "@/lib/integrations/config";
import { parseExternalPagination } from "@/lib/integrations/pagination";
import { listExternalWebhookDeliveries } from "@/lib/integrations/webhooks";

export const dynamic="force-dynamic";

export async function GET(request:Request){
  if(!integrationWebhooksEnabled())return new Response(null,{status:404});
  return handleExternalApiRequest(request,{
    scope:"webhooks:manage",action:"WEBHOOK_DELIVERY_LIST",
    resourceType:"webhook_delivery",
  },async(principal)=>{
    const pagination=parseExternalPagination(
      request,"/api/v1/webhook-deliveries",principal.companyId,
    );
    if(!pagination.ok)throw new ExternalApiProblem(
      "invalid_request",400,"INVALID",pagination.field,"webhook_delivery",
    );
    const result=await listExternalWebhookDeliveries({
      principal,limit:pagination.limit,cursor:pagination.cursor,
    });
    return {data:result.data,meta:{pagination:{limit:pagination.limit,
      has_more:result.hasMore,next_cursor:result.nextCursor}},
      resourceType:"webhook_delivery"};
  });
}
