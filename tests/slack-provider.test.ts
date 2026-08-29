import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  slackProviderConfiguration,
  slackProviderConfigured,
} from "@/lib/integrations/config";
import {
  exchangeSlackAuthorizationCode,
  listSlackPublicChannels,
  refreshSlackBotToken,
  slackAuthorizationUrl,
  slackScopesAreExact,
  SlackProviderError,
  verifySlackRequestSignature,
} from "@/lib/integrations/slack-provider";

const configuration={
  appId:"A123456789",
  clientId:"123456789.987654321",
  clientSecret:"fixture-client-secret-that-is-never-real",
  signingSecret:"a".repeat(64),
  redirectUri:"https://axora.management/api/integrations/slack/oauth/callback",
  eventsUri:"https://axora.management/api/integrations/slack/events",
};
const accessToken=`xoxe.xoxb-${"a".repeat(48)}`;
const refreshToken=`xoxe-${"b".repeat(48)}`;

function jsonResponse(body:unknown,status=200,headers:HeadersInit={}) {
  return new Response(JSON.stringify(body),{
    status,headers:{"content-type":"application/json",...headers},
  });
}

describe("Slack provider boundary",()=>{
  afterEach(()=>vi.restoreAllMocks());

  it("builds a fixed authorization request with only the reviewed scopes",()=>{
    const state="s".repeat(64);
    const url=new URL(slackAuthorizationUrl(configuration,state));
    expect(url.origin+url.pathname).toBe("https://slack.com/oauth/v2/authorize");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id:configuration.clientId,
      scope:"channels:read,chat:write",
      redirect_uri:configuration.redirectUri,
      state,
    });
    expect(url.search).not.toContain("admin");
    expect(url.search).not.toContain("files:write");
  });

  it("exchanges an authorization code only for the expected app and exact scopes",async()=>{
    const fetchImpl=vi.fn(async(_url:URL|string,init?:RequestInit)=>{
      const form=new URLSearchParams(String(init?.body));
      expect(form.get("redirect_uri")).toBe(configuration.redirectUri);
      expect(form.get("client_secret")).toBe(configuration.clientSecret);
      expect(init?.redirect).toBe("error");
      return jsonResponse({
        ok:true,app_id:configuration.appId,access_token:accessToken,
        token_type:"bot",scope:"chat:write,channels:read",
        bot_user_id:"B123456789",team:{id:"T123456789",name:"Fixture workspace"},
        enterprise:null,expires_in:43_200,refresh_token:refreshToken,
      });
    });
    await expect(exchangeSlackAuthorizationCode({
      configuration,code:"fixture_code_123456",fetchImpl:fetchImpl as typeof fetch,
    })).resolves.toMatchObject({
      appId:configuration.appId,workspaceId:"T123456789",
      scopes:["channels:read","chat:write"],accessToken,refreshToken,
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it.each([
    ["channels:read",configuration.appId],
    ["channels:read,chat:write,users:read",configuration.appId],
    ["channels:read,chat:write","A999999999"],
  ])("rejects scope escalation or the wrong app (%s)",async(scope,appId)=>{
    const fetchImpl=vi.fn(async()=>jsonResponse({
      ok:true,app_id:appId,access_token:accessToken,token_type:"bot",scope,
      bot_user_id:"B123456789",team:{id:"T123456789",name:"Fixture"},
      expires_in:3600,refresh_token:refreshToken,
    }));
    await expect(exchangeSlackAuthorizationCode({
      configuration,code:"fixture_code_123456",fetchImpl:fetchImpl as typeof fetch,
    })).rejects.toMatchObject({category:"SCOPE_MISMATCH"});
  });

  it("rotates refresh tokens and rejects a replay-shaped invalid token locally",async()=>{
    const fetchImpl=vi.fn(async()=>jsonResponse({
      ok:true,access_token:`xoxb-${"c".repeat(48)}`,token_type:"bot",
      scope:"channels:read chat:write",expires_in:3600,
      refresh_token:`xoxe-${"d".repeat(48)}`,
    }));
    await expect(refreshSlackBotToken({
      configuration,refreshToken,fetchImpl:fetchImpl as typeof fetch,
    })).resolves.toMatchObject({expiresIn:3600,scopes:["channels:read","chat:write"]});
    await expect(refreshSlackBotToken({
      configuration,refreshToken:"already-consumed-or-malformed",
      fetchImpl:fetchImpl as typeof fetch,
    })).rejects.toBeInstanceOf(SlackProviderError);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("lists only bounded public-channel records without following redirects",async()=>{
    const fetchImpl=vi.fn(async(url:URL|string,init?:RequestInit)=>{
      expect(new URL(String(url)).searchParams.get("types")).toBe("public_channel");
      expect(init?.redirect).toBe("error");
      return jsonResponse({ok:true,channels:[
        {id:"C123456789",name:"procurement",is_member:true,is_archived:false,
          is_private:false,is_shared:false,is_ext_shared:false,is_org_shared:false},
        {id:"C987654321",name:"general",is_member:false,is_archived:false,
          is_private:false,is_shared:false,is_ext_shared:false,is_org_shared:false},
        {id:"C555555555",name:"external",is_member:true,is_archived:false,
          is_private:false,is_shared:true,is_ext_shared:true,is_org_shared:false},
      ],response_metadata:{next_cursor:""}});
    });
    await expect(listSlackPublicChannels({
      token:accessToken,fetchImpl:fetchImpl as typeof fetch,
    })).resolves.toEqual([
      {id:"C987654321",name:"general",isMember:false,isArchived:false},
      {id:"C123456789",name:"procurement",isMember:true,isArchived:false},
    ]);
  });

  it("enforces signature integrity and the five-minute replay window",()=>{
    const timestamp="1800000000";
    const rawBody=JSON.stringify({type:"event_callback",event_id:"EvFixture123"});
    const signature=`v0=${createHmac("sha256",configuration.signingSecret)
      .update(`v0:${timestamp}:${rawBody}`).digest("hex")}`;
    expect(verifySlackRequestSignature({
      signingSecret:configuration.signingSecret,timestamp,signature,rawBody,
      nowSeconds:1_800_000_299,
    })).toBe(true);
    expect(verifySlackRequestSignature({
      signingSecret:configuration.signingSecret,timestamp,signature,rawBody,
      nowSeconds:1_800_000_301,
    })).toBe(false);
    expect(verifySlackRequestSignature({
      signingSecret:configuration.signingSecret,timestamp,signature,
      rawBody:`${rawBody} `,nowSeconds:1_800_000_000,
    })).toBe(false);
  });

  it("bounds provider responses and preserves Retry-After without leaking bodies",async()=>{
    const rateLimited=vi.fn(async()=>new Response("too many",{
      status:429,headers:{"retry-after":"42"},
    }));
    await expect(exchangeSlackAuthorizationCode({
      configuration,code:"fixture_code_123456",fetchImpl:rateLimited as typeof fetch,
    })).rejects.toMatchObject({category:"RATE_LIMITED",retryAfterSeconds:42});
    const oversized=vi.fn(async()=>new Response("x",{
      status:200,headers:{"content-length":"70000"},
    }));
    await expect(exchangeSlackAuthorizationCode({
      configuration,code:"fixture_code_123456",fetchImpl:oversized as typeof fetch,
    })).rejects.toMatchObject({category:"INVALID_RESPONSE"});
  });

  it("recognizes only the least-privilege scope set",()=>{
    expect(slackScopesAreExact("channels:read chat:write")).toBe(true);
    expect(slackScopesAreExact("channels:read")).toBe(false);
    expect(slackScopesAreExact("channels:read,chat:write,chat:write.public")).toBe(false);
  });

  it("rejects inline provider secrets in production and detects incomplete config",()=>{
    expect(()=>slackProviderConfiguration({
      NODE_ENV:"production",APP_BASE_URL:"https://axora.management",
      AXORA_SLACK_APP_ID:configuration.appId,
      AXORA_SLACK_CLIENT_ID:configuration.clientId,
      AXORA_SLACK_CLIENT_SECRET:configuration.clientSecret,
      AXORA_SLACK_SIGNING_SECRET:configuration.signingSecret,
    })).toThrow(/file-mounted/i);
    expect(slackProviderConfigured({
      NODE_ENV:"production",APP_BASE_URL:"https://axora.management",
      AXORA_SLACK_APP_ID:"",AXORA_SLACK_CLIENT_ID:"",
    })).toBe(false);
  });
});
