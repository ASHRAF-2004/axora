import { getSession } from "@/lib/auth";
import {
  integrationOrigin,
  slackIntegrationEnabled,
} from "@/lib/integrations/config";
import { externalRequestId } from "@/lib/integrations/http";
import { cancelSlackOAuth, completeSlackOAuth } from "@/lib/integrations/slack";
import { NextResponse } from "next/server";

export const dynamic="force-dynamic";

function finish(result:string) {
  const destination=new URL("/integrations",integrationOrigin());
  destination.searchParams.set("slack",result);
  return NextResponse.redirect(destination,{
    status:303,headers:{
      "Cache-Control":"no-store",Pragma:"no-cache",
      "Referrer-Policy":"no-referrer",
    },
  });
}

function exactParameter(url:URL,name:string) {
  const values=url.searchParams.getAll(name);
  return values.length===1?values[0]!:undefined;
}

export async function GET(request:Request) {
  if(!slackIntegrationEnabled())return new NextResponse(null,{status:404});
  const url=new URL(request.url);
  if(["error","state","code"].some(
    (name)=>url.searchParams.getAll(name).length>1,
  ))return finish("error");
  const error=exactParameter(url,"error");
  const state=exactParameter(url,"state");
  const code=exactParameter(url,"code");
  const actor=await getSession();
  if(!actor)return finish("session_required");
  if(error) {
    if(error!=="access_denied"||!state||code)return finish("error");
    try {
      await cancelSlackOAuth({
        actor,state,requestId:externalRequestId(request),
      });
      return finish("cancelled");
    } catch {
      return finish("error");
    }
  }
  if(!state||!code)return finish("error");
  try {
    await completeSlackOAuth({
      actor,state,code,requestId:externalRequestId(request),
    });
    return finish("connected");
  } catch {
    return finish("error");
  }
}
