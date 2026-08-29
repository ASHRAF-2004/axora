import { beforeEach,describe,expect,it,vi } from "vitest";

const mocks=vi.hoisted(()=>({
  enabled:true,configured:true,signatureValid:true,
  actor:{
    id:"f1323000-0000-4000-8000-000000000001",
    companyId:"f1323000-0000-4000-8000-000000000002",
  } as Record<string,unknown>|null,
  getSession:vi.fn(),begin:vi.fn(),cancel:vi.fn(),complete:vi.fn(),
  handleEvent:vi.fn(),consumeRateLimit:vi.fn(),verifySignature:vi.fn(),
}));

vi.mock("@/lib/auth",()=>({getSession:mocks.getSession}));
vi.mock("@/lib/integrations/config",()=>({
  slackIntegrationEnabled:()=>mocks.enabled,
  integrationOrigin:()=>"https://axora.management",
  slackProviderConfiguration:()=>{
    if(!mocks.configured)throw new Error("unavailable");
    return {
      appId:"A123456789",clientId:"123456789.987654321",
      clientSecret:"fixture-client-secret-that-is-never-real",
      signingSecret:"a".repeat(64),
      redirectUri:"https://axora.management/api/integrations/slack/oauth/callback",
      eventsUri:"https://axora.management/api/integrations/slack/events",
    };
  },
}));
vi.mock("@/lib/integrations/http",()=>({
  externalRequestId:()=>"f1323000-0000-4000-8000-000000000003",
}));
vi.mock("@/lib/integrations/network",()=>({
  integrationNetworkHash:()=>"a".repeat(64),
}));
vi.mock("@/lib/integrations/rate-limit",()=>({
  consumeIntegrationRateLimit:mocks.consumeRateLimit,
}));
vi.mock("@/lib/integrations/slack",()=>({
  SlackIntegrationError:class SlackIntegrationError extends Error {
    constructor(public readonly reason:string){super(reason)}
  },
  beginSlackOAuth:mocks.begin,
  cancelSlackOAuth:mocks.cancel,
  completeSlackOAuth:mocks.complete,
  handleSlackInboundEvent:mocks.handleEvent,
}));
vi.mock("@/lib/integrations/slack-provider",()=>({
  verifySlackRequestSignature:mocks.verifySignature,
}));

import { POST as slackEvents } from "@/app/api/integrations/slack/events/route";
import { GET as slackCallback } from "@/app/api/integrations/slack/oauth/callback/route";
import { GET as slackStart } from "@/app/api/integrations/slack/oauth/start/route";

describe("native Slack routes",()=>{
  beforeEach(()=>{
    vi.clearAllMocks();
    mocks.enabled=true;mocks.configured=true;mocks.signatureValid=true;
    mocks.actor={
      id:"f1323000-0000-4000-8000-000000000001",
      companyId:"f1323000-0000-4000-8000-000000000002",
    };
    mocks.getSession.mockImplementation(async()=>mocks.actor);
    mocks.consumeRateLimit.mockResolvedValue({allowed:true});
    mocks.begin.mockResolvedValue(
      `https://slack.com/oauth/v2/authorize?state=${"s".repeat(64)}`,
    );
    mocks.verifySignature.mockImplementation(()=>mocks.signatureValid);
    mocks.handleEvent.mockResolvedValue({duplicate:false,revoked:true});
  });

  it("returns an indistinguishable 404 before session access while disabled",async()=>{
    mocks.enabled=false;
    const response=await slackStart(new Request(
      "https://axora.management/api/integrations/slack/oauth/start",
    ));
    expect(response.status).toBe(404);
    expect(mocks.getSession).not.toHaveBeenCalled();
  });

  it("requires a live session and same-origin navigation before starting OAuth",async()=>{
    mocks.actor=null;
    expect((await slackStart(new Request(
      "https://axora.management/api/integrations/slack/oauth/start",
    ))).status).toBe(401);
    mocks.actor={id:"user",companyId:"company"};
    const crossSite=await slackStart(new Request(
      "https://axora.management/api/integrations/slack/oauth/start",
      {headers:{"sec-fetch-site":"cross-site"}},
    ));
    expect(crossSite.status).toBe(403);
    expect(mocks.begin).not.toHaveBeenCalled();
  });

  it("rate-limits Slack OAuth independently and redirects without referrer leakage",async()=>{
    mocks.consumeRateLimit.mockResolvedValueOnce({allowed:false});
    expect((await slackStart(new Request(
      "https://axora.management/api/integrations/slack/oauth/start",
      {headers:{"sec-fetch-site":"same-origin"}},
    ))).status).toBe(429);
    mocks.consumeRateLimit.mockResolvedValueOnce({allowed:true});
    const response=await slackStart(new Request(
      "https://axora.management/api/integrations/slack/oauth/start",
      {headers:{"sec-fetch-site":"same-origin"}},
    ));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toMatch(/^https:\/\/slack\.com\//);
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(mocks.consumeRateLimit).toHaveBeenCalledWith(expect.objectContaining({
      routeClass:"SLACK_OAUTH",
    }));
  });

  it("rejects duplicate callback parameters and never returns codes or state",async()=>{
    const response=await slackCallback(new Request(
      `https://axora.management/api/integrations/slack/oauth/callback?state=${"s".repeat(64)}&state=${"t".repeat(64)}&code=fixture_code_123456`,
    ));
    expect(response.status).toBe(303);
    const location=new URL(response.headers.get("location")!);
    expect(location.pathname).toBe("/integrations");
    expect(location.searchParams.get("slack")).toBe("error");
    expect(location.search).not.toContain("fixture_code");
    expect(mocks.complete).not.toHaveBeenCalled();
  });

  it("validates state even when a user cancels provider authorization",async()=>{
    const state="s".repeat(64);
    const response=await slackCallback(new Request(
      `https://axora.management/api/integrations/slack/oauth/callback?error=access_denied&state=${state}`,
    ));
    expect(response.status).toBe(303);
    expect(new URL(response.headers.get("location")!).searchParams.get("slack"))
      .toBe("cancelled");
    expect(mocks.cancel).toHaveBeenCalledWith(expect.objectContaining({state}));
    expect(mocks.complete).not.toHaveBeenCalled();
  });

  it("completes only one exact callback and keeps the redirect secret-free",async()=>{
    const state="s".repeat(64);
    const code="fixture_code_123456";
    const response=await slackCallback(new Request(
      `https://axora.management/api/integrations/slack/oauth/callback?state=${state}&code=${code}`,
    ));
    expect(response.status).toBe(303);
    expect(mocks.complete).toHaveBeenCalledWith(expect.objectContaining({state,code}));
    const location=response.headers.get("location")!;
    expect(location).toBe("https://axora.management/integrations?slack=connected");
    expect(location).not.toContain(code);
    expect(location).not.toContain(state);
  });

  it("redirects callbacks to the configured origin instead of the request host",async()=>{
    const response=await slackCallback(new Request(
      `https://attacker.invalid/api/integrations/slack/oauth/callback?state=${"s".repeat(64)}&code=fixture_code_123456`,
    ));
    expect(response.headers.get("location"))
      .toBe("https://axora.management/integrations?slack=connected");
  });

  it("verifies the raw signature before parsing or using a database rate bucket",async()=>{
    mocks.signatureValid=false;
    const response=await slackEvents(new Request(
      "https://axora.management/api/integrations/slack/events",{
        method:"POST",headers:{
          "x-slack-request-timestamp":"1800000000",
          "x-slack-signature":`v0=${"a".repeat(64)}`,
        },body:"not json",
      },
    ));
    expect(response.status).toBe(401);
    expect(mocks.consumeRateLimit).not.toHaveBeenCalled();
    expect(mocks.handleEvent).not.toHaveBeenCalled();
  });

  it("answers signed URL verification and processes only signed revocation events",async()=>{
    const headers={
      "x-slack-request-timestamp":"1800000000",
      "x-slack-signature":`v0=${"a".repeat(64)}`,
      "content-type":"application/json",
    };
    const challenge=await slackEvents(new Request(
      "https://axora.management/api/integrations/slack/events",{
        method:"POST",headers,body:JSON.stringify({
          type:"url_verification",challenge:"fixture_challenge_123",
        }),
      },
    ));
    expect(challenge.status).toBe(200);
    expect(await challenge.json()).toEqual({challenge:"fixture_challenge_123"});
    expect(mocks.handleEvent).not.toHaveBeenCalled();

    const payload={
      type:"event_callback",api_app_id:"A123456789",team_id:"T123456789",
      event_id:"EvFixture123",event:{type:"app_uninstalled"},
    };
    const event=await slackEvents(new Request(
      "https://axora.management/api/integrations/slack/events",{
        method:"POST",headers,body:JSON.stringify(payload),
      },
    ));
    expect(event.status).toBe(200);
    expect(mocks.handleEvent).toHaveBeenCalledWith(expect.objectContaining({payload}));
  });

  it("bounds callback bodies and fails closed when provider config is absent",async()=>{
    const oversized=await slackEvents(new Request(
      "https://axora.management/api/integrations/slack/events",{
        method:"POST",headers:{"content-length":"262145"},body:"{}",
      },
    ));
    expect(oversized.status).toBe(413);
    mocks.configured=false;
    const unavailable=await slackEvents(new Request(
      "https://axora.management/api/integrations/slack/events",{
        method:"POST",body:"{}",
      },
    ));
    expect(unavailable.status).toBe(503);
  });
});
