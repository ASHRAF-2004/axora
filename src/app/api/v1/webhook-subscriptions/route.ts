import { ExternalApiProblem, handleExternalApiRequest } from "@/lib/integrations/api-handler";
import { integrationWebhooksEnabled } from "@/lib/integrations/config";
import { integrationNetworkHash } from "@/lib/integrations/network";
import { parseExternalPagination } from "@/lib/integrations/pagination";
import { readLimitedTextBody } from "@/lib/integrations/request";
import {
  createExternalWebhookSubscription,
  listExternalWebhookSubscriptions,
  parseWebhookSubscriptionInput,
} from "@/lib/integrations/webhooks";

export const dynamic = "force-dynamic";

async function parseBody(request:Request){
  const contentType=request.headers.get("content-type")?.split(";",1)[0]?.trim().toLowerCase();
  if(contentType!=="application/json"){
    throw new ExternalApiProblem("invalid_request",400,"INVALID","body","webhook_subscription");
  }
  const raw=await readLimitedTextBody(request,16_384);
  if(raw===null)throw new ExternalApiProblem(
    "invalid_request",400,"INVALID","body","webhook_subscription",
  );
  try{return parseWebhookSubscriptionInput(JSON.parse(raw));}
  catch(error){
    if(error instanceof ExternalApiProblem)throw error;
    throw new ExternalApiProblem("invalid_request",400,"INVALID","body","webhook_subscription");
  }
}

export async function GET(request:Request){
  if(!integrationWebhooksEnabled())return new Response(null,{status:404});
  return handleExternalApiRequest(request,{
    scope:"webhooks:manage",action:"WEBHOOK_SUBSCRIPTION_LIST",
    resourceType:"webhook_subscription",
  },async(principal)=>{
    const pagination=parseExternalPagination(
      request,"/api/v1/webhook-subscriptions",principal.companyId,
    );
    if(!pagination.ok)throw new ExternalApiProblem(
      "invalid_request",400,"INVALID",pagination.field,"webhook_subscription",
    );
    const result=await listExternalWebhookSubscriptions({
      principal,limit:pagination.limit,cursor:pagination.cursor,
    });
    return {data:result.data,meta:{pagination:{limit:pagination.limit,
      has_more:result.hasMore,next_cursor:result.nextCursor}},
      resourceType:"webhook_subscription"};
  });
}

export async function POST(request:Request){
  if(!integrationWebhooksEnabled())return new Response(null,{status:404});
  return handleExternalApiRequest(request,{
    scope:"webhooks:manage",action:"WEBHOOK_SUBSCRIPTION_CREATE",
    routeClass:"API_WRITE",resourceType:"webhook_subscription",
  },async(principal,requestId)=>{
    if(new URL(request.url).search)throw new ExternalApiProblem(
      "invalid_request",400,"INVALID","query","webhook_subscription",
    );
    const result=await createExternalWebhookSubscription({
      principal,payload:await parseBody(request),
      idempotencyKey:request.headers.get("idempotency-key")?.trim()??"",
      requestId,networkHash:integrationNetworkHash(request),
    });
    const data=result.data as {id:string};
    return {data:result.data,status:201,
      meta:{idempotency_replayed:result.replayed},
      resourceType:"webhook_subscription",resourceId:data.id,
      auditRecorded:!result.replayed};
  });
}
