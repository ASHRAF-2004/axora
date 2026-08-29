import { getSession } from "@/lib/auth";
import { externalRequestId } from "@/lib/integrations/http";
import { integrationNetworkHash } from "@/lib/integrations/network";
import { consumeIntegrationRateLimit } from "@/lib/integrations/rate-limit";
import { beginSlackOAuth, SlackIntegrationError } from "@/lib/integrations/slack";
import { slackIntegrationEnabled } from "@/lib/integrations/config";
import { NextResponse } from "next/server";

export const dynamic="force-dynamic";

function unavailable(status:number) {
  return NextResponse.json({error:"slack_connection_unavailable"},{
    status,headers:{"Cache-Control":"no-store",Pragma:"no-cache"},
  });
}

export async function GET(request:Request) {
  if(!slackIntegrationEnabled())return new NextResponse(null,{status:404});
  const requestId=externalRequestId(request);
  const actor=await getSession();
  if(!actor)return unavailable(401);
  const fetchSite=request.headers.get("sec-fetch-site");
  if(fetchSite && fetchSite!=="same-origin" && fetchSite!=="none") {
    return unavailable(403);
  }
  try {
    const networkHash=integrationNetworkHash(request);
    const rate=await consumeIntegrationRateLimit({
      routeClass:"SLACK_OAUTH",correlationId:requestId,
      scopes:[
        {kind:"CONNECTION",identifier:actor.companyId??actor.id,limit:20},
        {kind:"NETWORK",identifier:networkHash,limit:60},
      ],
    });
    if(!rate.allowed)return unavailable(429);
    const destination=await beginSlackOAuth({actor,requestId});
    return NextResponse.redirect(destination,{
      status:303,headers:{
        "Cache-Control":"no-store",Pragma:"no-cache",
        "Referrer-Policy":"no-referrer","Axora-Request-Id":requestId,
      },
    });
  } catch(error) {
    if(error instanceof SlackIntegrationError) {
      return unavailable(error.reason==="DENIED"?403:error.reason==="CONFLICT"?409:503);
    }
    return unavailable(503);
  }
}
