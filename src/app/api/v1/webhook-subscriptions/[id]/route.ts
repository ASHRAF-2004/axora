import { ExternalApiProblem, handleExternalApiRequest } from "@/lib/integrations/api-handler";
import { integrationWebhooksEnabled } from "@/lib/integrations/config";
import { integrationNetworkHash } from "@/lib/integrations/network";
import { readLimitedTextBody } from "@/lib/integrations/request";
import { mutateExternalWebhook } from "@/lib/integrations/webhooks";

export const dynamic="force-dynamic";

export async function DELETE(request:Request,context:{params:Promise<{id:string}>}){
  if(!integrationWebhooksEnabled())return new Response(null,{status:404});
  return handleExternalApiRequest(request,{
    scope:"webhooks:manage",action:"WEBHOOK_SUBSCRIPTION_REVOKE",
    routeClass:"API_WRITE",resourceType:"webhook_subscription",
  },async(principal,requestId)=>{
    const body=await readLimitedTextBody(request,0);
    if(new URL(request.url).search||body===null||body.length)throw new ExternalApiProblem(
      "invalid_request",400,"INVALID","body","webhook_subscription",
    );
    const {id}=await context.params;
    const result=await mutateExternalWebhook({
      principal,kind:"revoke",resourceId:id,
      idempotencyKey:request.headers.get("idempotency-key")?.trim()??"",
      requestId,networkHash:integrationNetworkHash(request),
    });
    return {data:result.data,meta:{idempotency_replayed:result.replayed},
      resourceType:"webhook_subscription",resourceId:id,
      auditRecorded:!result.replayed};
  });
}
