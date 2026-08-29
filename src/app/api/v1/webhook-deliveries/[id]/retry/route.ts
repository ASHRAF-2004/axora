import { ExternalApiProblem, handleExternalApiRequest } from "@/lib/integrations/api-handler";
import { integrationWebhooksEnabled } from "@/lib/integrations/config";
import { integrationNetworkHash } from "@/lib/integrations/network";
import { readLimitedTextBody } from "@/lib/integrations/request";
import { mutateExternalWebhook } from "@/lib/integrations/webhooks";

export const dynamic="force-dynamic";

export async function POST(request:Request,context:{params:Promise<{id:string}>}){
  if(!integrationWebhooksEnabled())return new Response(null,{status:404});
  return handleExternalApiRequest(request,{
    scope:"webhooks:manage",action:"WEBHOOK_DELIVERY_RETRY",
    routeClass:"API_WRITE",resourceType:"webhook_delivery",
  },async(principal,requestId)=>{
    const body=await readLimitedTextBody(request,0);
    if(new URL(request.url).search||body===null||body.length)throw new ExternalApiProblem(
      "invalid_request",400,"INVALID","body","webhook_delivery",
    );
    const {id}=await context.params;
    const result=await mutateExternalWebhook({
      principal,kind:"retry",resourceId:id,
      idempotencyKey:request.headers.get("idempotency-key")?.trim()??"",
      requestId,networkHash:integrationNetworkHash(request),
    });
    return {data:result.data,meta:{idempotency_replayed:result.replayed},
      resourceType:"webhook_delivery",resourceId:id,
      auditRecorded:!result.replayed};
  });
}
