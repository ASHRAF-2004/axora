import { Buffer } from "node:buffer";
import { afterEach,beforeEach,describe,expect,it,vi } from "vitest";

const mocks=vi.hoisted(()=>{
  const client={query:vi.fn()};
  return {
    client,
    canManageCompanyIntegrations:vi.fn(async()=>false),
    canManageIntegrationApplications:vi.fn(async()=>false),
    consumeRateLimit:vi.fn(async()=>({allowed:true})),
    withIntegrationTransaction:vi.fn(async(
      _context:unknown,work:(client:typeof mocks.client)=>unknown,
    )=>work(client)),
  };
});

vi.mock("@/lib/db",()=>({isDemoMode:()=>false}));
vi.mock("@/lib/integrations/database",()=>({
  withIntegrationTransaction:mocks.withIntegrationTransaction,
}));
vi.mock("@/lib/integrations/authorization",()=>({
  canManageCompanyIntegrations:mocks.canManageCompanyIntegrations,
  canManageIntegrationApplications:mocks.canManageIntegrationApplications,
}));
vi.mock("@/lib/integrations/rate-limit",()=>({
  consumeIntegrationRateLimit:mocks.consumeRateLimit,
}));

import type { AuthenticatedSessionUser } from "@/lib/auth";
import { integrationConfigInternals } from "@/lib/integrations/config";
import {
  beginSlackOAuth,
  completeSlackOAuth,
  configureSlackNotifications,
  handleSlackInboundEvent,
  SLACK_APPLICATION_ID,
  SlackIntegrationError,
  syncSlackChannels,
} from "@/lib/integrations/slack";

const ids={
  admin:"f1322000-0000-4000-8000-000000000001",
  assignment:"f1322000-0000-4000-8000-000000000002",
  company:"f1322000-0000-4000-8000-000000000003",
  foreignCompany:"f1322000-0000-4000-8000-000000000004",
  state:"f1322000-0000-4000-8000-000000000005",
  installation:"f1322000-0000-4000-8000-000000000006",
  connection:"f1322000-0000-4000-8000-000000000007",
} as const;

const administrator:AuthenticatedSessionUser={
  id:ids.admin,email:"admin@example.test",name:"Administrator",role:"COMPANY_ADMIN",
  accountKind:"COMPANY",scopeType:"COMPANY",companyId:ids.company,
  roleAssignmentId:ids.assignment,isOwner:false,authVersion:4,
  preferredLocale:"en",timezone:"Asia/Kuala_Lumpur",
};
const cam:AuthenticatedSessionUser={
  ...administrator,id:"f1322000-0000-4000-8000-000000000008",
  email:"cam@example.test",name:"CAM",role:"CLIENT_ACCOUNT_MANAGER",accountKind:"PLATFORM",
  scopeType:"PLATFORM",companyId:undefined,
  roleAssignmentId:"f1322000-0000-4000-8000-000000000009",
};

function result(rows:unknown[]=[]){return {rowCount:rows.length,rows};}

describe("Slack management and tenant authorization",()=>{
  beforeEach(()=>{
    vi.clearAllMocks();
    vi.stubEnv("NODE_ENV","test");
    vi.stubEnv("APP_BASE_URL","https://axora.management");
    vi.stubEnv("AXORA_SLACK_ENABLED","true");
    vi.stubEnv("AXORA_SLACK_APP_ID","A123456789");
    vi.stubEnv("AXORA_SLACK_CLIENT_ID","123456789.987654321");
    vi.stubEnv("AXORA_SLACK_CLIENT_SECRET","fixture-client-secret-that-is-never-real");
    vi.stubEnv("AXORA_SLACK_SIGNING_SECRET","a".repeat(64));
    vi.stubEnv(
      "AXORA_INTEGRATION_ENCRYPTION_KEY",
      Buffer.alloc(32,0x61).toString("base64url"),
    );
    delete process.env.AXORA_INTEGRATION_ENCRYPTION_KEY_FILE;
    delete process.env.AXORA_SLACK_CLIENT_SECRET_FILE;
    delete process.env.AXORA_SLACK_SIGNING_SECRET_FILE;
    integrationConfigInternals.clearKeyCache();
  });
  afterEach(()=>{
    vi.unstubAllEnvs();
    integrationConfigInternals.clearKeyCache();
  });

  it("fails closed before database or provider access while Slack is disabled",async()=>{
    vi.stubEnv("AXORA_SLACK_ENABLED","false");
    await expect(beginSlackOAuth({actor:administrator,requestId:crypto.randomUUID()}))
      .rejects.toMatchObject({reason:"UNAVAILABLE"});
    expect(mocks.canManageCompanyIntegrations).not.toHaveBeenCalled();
    expect(mocks.withIntegrationTransaction).not.toHaveBeenCalled();
  });

  it("does not give CAM provider-installation authority",async()=>{
    await expect(beginSlackOAuth({actor:cam,requestId:crypto.randomUUID()}))
      .rejects.toBeInstanceOf(SlackIntegrationError);
    expect(mocks.withIntegrationTransaction).not.toHaveBeenCalled();
  });

  it("stores only a state hash and binds OAuth to the live company role",async()=>{
    mocks.canManageCompanyIntegrations.mockResolvedValue(true);
    mocks.client.query
      .mockResolvedValueOnce(result([{id:SLACK_APPLICATION_ID}]))
      .mockResolvedValueOnce(result())
      .mockResolvedValueOnce(result());
    const destination=await beginSlackOAuth({
      actor:administrator,requestId:crypto.randomUUID(),
    });
    const state=new URL(destination).searchParams.get("state")!;
    expect(state).toMatch(/^axora_slack_[A-Za-z0-9_-]+$/);
    expect(new URL(destination).searchParams.get("scope"))
      .toBe("channels:read,chat:write");
    expect(JSON.stringify(mocks.client.query.mock.calls)).not.toContain(state);
    expect(mocks.client.query.mock.calls.at(-1)?.[1]).toEqual(expect.arrayContaining([
      expect.stringMatching(/^[0-9a-f]{64}$/),ids.company,ids.admin,
      ids.assignment,administrator.authVersion,
    ]));
  });

  it("rejects a wrong or replayed state before calling Slack",async()=>{
    mocks.client.query.mockResolvedValueOnce(result());
    const fetchImpl=vi.fn();
    await expect(completeSlackOAuth({
      actor:administrator,state:"s".repeat(64),code:"fixture_code_123456",
      requestId:crypto.randomUUID(),fetchImpl,
    })).rejects.toMatchObject({reason:"INVALID"});
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("encrypts rotating provider tokens and never persists plaintext",async()=>{
    mocks.canManageCompanyIntegrations.mockResolvedValue(true);
    mocks.client.query
      .mockResolvedValueOnce(result([{
        id:ids.state,companyId:ids.company,userId:ids.admin,
        roleAssignmentId:ids.assignment,authVersionAtStart:4,
        expiresAt:new Date(Date.now()+60_000).toISOString(),status:"PENDING",
      }]))
      .mockResolvedValueOnce(result())
      .mockResolvedValueOnce(result([{id:ids.connection}]))
      .mockResolvedValueOnce(result());
    const accessToken=`xoxe.xoxb-${"b".repeat(48)}`;
    const refreshToken=`xoxe-${"c".repeat(48)}`;
    const fetchImpl=vi.fn(async()=>new Response(JSON.stringify({
      ok:true,app_id:"A123456789",access_token:accessToken,token_type:"bot",
      scope:"channels:read,chat:write",bot_user_id:"B123456789",
      team:{id:"T123456789",name:"Fixture workspace"},enterprise:null,
      expires_in:43_200,refresh_token:refreshToken,
    }),{status:200}));
    await expect(completeSlackOAuth({
      actor:administrator,state:"s".repeat(64),code:"fixture_code_123456",
      requestId:crypto.randomUUID(),fetchImpl:fetchImpl as typeof fetch,
    })).resolves.toMatch(/^[0-9a-f-]{36}$/);
    const serialized=JSON.stringify(mocks.client.query.mock.calls);
    expect(serialized).not.toContain(accessToken);
    expect(serialized).not.toContain(refreshToken);
    const installationValues=mocks.client.query.mock.calls.at(-1)?.[1] as unknown[];
    expect(JSON.parse(String(installationValues[9]))).toMatchObject({version:1});
    expect(JSON.parse(String(installationValues[10]))).toMatchObject({version:1});
    expect(serialized).toContain("T123456789");
  });

  it("accepts only a fresh public channel where the bot is a member",async()=>{
    mocks.canManageCompanyIntegrations.mockResolvedValue(true);
    mocks.client.query
      .mockResolvedValueOnce(result([{companyId:ids.company}]))
      .mockResolvedValueOnce(result([{name:"procurement"}]))
      .mockResolvedValueOnce(result());
    await expect(configureSlackNotifications({
      actor:administrator,installationId:ids.installation,
      channelId:"C123456789",eventTypes:["request.approved","delivery.completed"],
    })).resolves.toBeUndefined();
    expect(String(mocks.client.query.mock.calls[1]?.[0])).toContain("is_member");
    expect(String(mocks.client.query.mock.calls[1]?.[0])).toContain("24 hours");
    expect(mocks.client.query.mock.calls[2]?.[1]).toEqual([
      ids.installation,"C123456789","procurement",
      ["delivery.completed","request.approved"],
    ]);
  });

  it("rate-limits provider channel synchronization before token access",async()=>{
    mocks.consumeRateLimit.mockResolvedValueOnce({allowed:false});
    await expect(syncSlackChannels({
      actor:administrator,installationId:ids.installation,
    })).rejects.toMatchObject({reason:"UNAVAILABLE"});
    expect(mocks.consumeRateLimit).toHaveBeenCalledWith(expect.objectContaining({
      routeClass:"SLACK_API",
    }));
    expect(mocks.withIntegrationTransaction).not.toHaveBeenCalled();
  });

  it("does not mutate a foreign-company installation after authorization fails",async()=>{
    mocks.canManageCompanyIntegrations.mockResolvedValue(false);
    mocks.client.query.mockResolvedValueOnce(result([{companyId:ids.foreignCompany}]));
    await expect(configureSlackNotifications({
      actor:administrator,installationId:ids.installation,
      channelId:"C123456789",eventTypes:["request.approved"],
    })).rejects.toMatchObject({reason:"DENIED"});
    expect(mocks.client.query).toHaveBeenCalledOnce();
  });

  it("deduplicates signed uninstall events and revokes only the matching workspace",async()=>{
    mocks.client.query
      .mockResolvedValueOnce(result([{
        id:ids.installation,companyId:ids.company,
        connectionId:ids.connection,botUserId:"B123456789",
      }]))
      .mockResolvedValueOnce(result([{event_id:"EvFixture123"}]))
      .mockResolvedValueOnce(result())
      .mockResolvedValueOnce(result());
    const payload={
      type:"event_callback",api_app_id:"A123456789",team_id:"T123456789",
      event_id:"EvFixture123",event:{type:"app_uninstalled"},
    };
    await expect(handleSlackInboundEvent({payload,requestId:crypto.randomUUID()}))
      .resolves.toEqual({duplicate:false,revoked:true});
    expect(String(mocks.client.query.mock.calls[2]?.[0])).toContain("integration_connections");
    expect(String(mocks.client.query.mock.calls[3]?.[0])).toContain("access_token_ciphertext=NULL");

    vi.clearAllMocks();
    mocks.client.query
      .mockResolvedValueOnce(result([{
        id:ids.installation,companyId:ids.company,
        connectionId:ids.connection,botUserId:"B123456789",
      }]))
      .mockResolvedValueOnce(result());
    await expect(handleSlackInboundEvent({payload,requestId:crypto.randomUUID()}))
      .resolves.toEqual({duplicate:true,revoked:false});
    expect(mocks.client.query).toHaveBeenCalledTimes(2);
  });
});
