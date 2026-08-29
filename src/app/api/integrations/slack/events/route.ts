import {
  slackIntegrationEnabled,
  slackProviderConfiguration,
} from "@/lib/integrations/config";
import { externalRequestId } from "@/lib/integrations/http";
import { integrationNetworkHash } from "@/lib/integrations/network";
import { consumeIntegrationRateLimit } from "@/lib/integrations/rate-limit";
import { handleSlackInboundEvent } from "@/lib/integrations/slack";
import { verifySlackRequestSignature } from "@/lib/integrations/slack-provider";
import { NextResponse } from "next/server";
import { z } from "zod";

export const dynamic="force-dynamic";

const verificationSchema=z.object({
  type:z.literal("url_verification"),
  challenge:z.string().min(8).max(512).regex(/^[A-Za-z0-9_-]+$/),
}).passthrough();

function response(status:number,body:Record<string,unknown>={}) {
  return NextResponse.json(body,{
    status,headers:{"Cache-Control":"no-store",Pragma:"no-cache"},
  });
}

export async function POST(request:Request) {
  if(!slackIntegrationEnabled())return new NextResponse(null,{status:404});
  let configuration:ReturnType<typeof slackProviderConfiguration>;
  try { configuration=slackProviderConfiguration(); }
  catch { return response(503,{error:"unavailable"}); }
  const declared=Number(request.headers.get("content-length")??0);
  if(Number.isFinite(declared)&&declared>262_144)return response(413);
  let rawBody:string;
  try { rawBody=await request.text(); } catch { return response(400); }
  if(!verifySlackRequestSignature({
    signingSecret:configuration.signingSecret,
    timestamp:request.headers.get("x-slack-request-timestamp"),
    signature:request.headers.get("x-slack-signature"),rawBody,
  }))return response(401);
  const requestId=externalRequestId(request);
  try {
    const networkHash=integrationNetworkHash(request);
    const rate=await consumeIntegrationRateLimit({
      routeClass:"SLACK_EVENTS",correlationId:requestId,
      scopes:[{kind:"NETWORK",identifier:networkHash,limit:600}],
    });
    if(!rate.allowed)return response(429);
  } catch { return response(503); }
  let payload:unknown;
  try { payload=JSON.parse(rawBody); } catch { return response(400); }
  const verification=verificationSchema.safeParse(payload);
  if(verification.success)return response(200,{challenge:verification.data.challenge});
  try {
    await handleSlackInboundEvent({payload,requestId});
    return response(200,{ok:true});
  } catch { return response(400,{error:"invalid_event"}); }
}
