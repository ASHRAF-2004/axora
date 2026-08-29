import { Buffer } from "node:buffer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks=vi.hoisted(()=>{
  const client={query:vi.fn()};
  return {
    client,
    canManageCompanyIntegrations:vi.fn(async()=>false),
    canManageIntegrationApplications:vi.fn(async()=>false),
    canViewIntegrationOperations:vi.fn(async()=>false),
    withIntegrationTransaction:vi.fn(
      async(_context:unknown,work:(client:typeof mocks.client)=>unknown)=>work(mocks.client),
    ),
  };
});

vi.mock("@/lib/db",()=>({isDemoMode:()=>false}));
vi.mock("@/lib/integrations/database",()=>({
  withIntegrationTransaction:mocks.withIntegrationTransaction,
}));
vi.mock("@/lib/integrations/authorization",()=>({
  canManageCompanyIntegrations:mocks.canManageCompanyIntegrations,
  canManageIntegrationApplications:mocks.canManageIntegrationApplications,
  canViewIntegrationOperations:mocks.canViewIntegrationOperations,
}));

import type { AuthenticatedSessionUser } from "@/lib/auth";
import { integrationConfigInternals } from "@/lib/integrations/config";
import { integrationPayloadHash } from "@/lib/integrations/crypto";
import type { IntegrationPrincipal } from "@/lib/integrations/api-auth";
import {
  createExternalWebhookSubscription,
  createManagedWebhookSubscription,
  retryManagedWebhookDelivery,
  revokeManagedWebhookSubscription,
  rotateManagedWebhookCredential,
  WebhookManagementError,
} from "@/lib/integrations/webhooks";

const ids={
  owner:"f1294000-0000-4000-8000-000000000001",
  ownerAssignment:"f1294000-0000-4000-8000-000000000002",
  admin:"f1294000-0000-4000-8000-000000000003",
  adminAssignment:"f1294000-0000-4000-8000-000000000004",
  company:"f1294000-0000-4000-8000-000000000005",
  foreignCompany:"f1294000-0000-4000-8000-000000000006",
  application:"f1294000-0000-4000-8000-000000000007",
  connection:"f1294000-0000-4000-8000-000000000008",
  subscription:"f1294000-0000-4000-8000-000000000009",
  delivery:"f1294000-0000-4000-8000-000000000010",
} as const;

const owner:AuthenticatedSessionUser={
  id:ids.owner,email:"owner@example.test",name:"Owner",role:"PLATFORM_OWNER",
  accountKind:"PLATFORM",scopeType:"PLATFORM",roleAssignmentId:ids.ownerAssignment,
  isOwner:true,authVersion:1,preferredLocale:"en",timezone:"Asia/Kuala_Lumpur",
};
const administrator:AuthenticatedSessionUser={
  id:ids.admin,email:"admin@example.test",name:"Administrator",role:"COMPANY_ADMIN",
  accountKind:"COMPANY",scopeType:"COMPANY",companyId:ids.company,
  roleAssignmentId:ids.adminAssignment,isOwner:false,authVersion:4,
  preferredLocale:"en",timezone:"Asia/Kuala_Lumpur",
};
const principal={
  accessTokenId:"f1294000-0000-4000-8000-000000000020",
  applicationId:ids.application,connectionId:ids.connection,companyId:ids.company,
  grantId:"f1294000-0000-4000-8000-000000000021",
  clientId:`axora_client_${"a".repeat(24)}`,
  scopes:["webhooks:manage"],actor:administrator,
} as unknown as IntegrationPrincipal;

function queryResult(rows:unknown[]=[]){return {rowCount:rows.length,rows};}

describe("webhook management authorization",()=>{
  beforeEach(()=>{
    vi.clearAllMocks();
    vi.stubEnv("NODE_ENV","test");
    vi.stubEnv("AXORA_INTEGRATION_WEBHOOKS_ENABLED","true");
    vi.stubEnv(
      "AXORA_INTEGRATION_ENCRYPTION_KEY",
      Buffer.alloc(32,0x29).toString("base64url"),
    );
    delete process.env.AXORA_INTEGRATION_ENCRYPTION_KEY_FILE;
    integrationConfigInternals.clearKeyCache();
  });

  it("fails closed before database access when the capability is disabled",async()=>{
    vi.stubEnv("AXORA_INTEGRATION_WEBHOOKS_ENABLED","false");
    await expect(createManagedWebhookSubscription({
      actor:administrator,connectionId:ids.connection,
      payload:{
        endpoint_url:"https://hooks.receiver.dev/disabled",
        event_types:["request.approved"],
      },
    })).rejects.toMatchObject({reason:"UNAVAILABLE"});
    expect(mocks.canManageCompanyIntegrations).not.toHaveBeenCalled();
    expect(mocks.withIntegrationTransaction).not.toHaveBeenCalled();
  });
  afterEach(()=>{
    vi.unstubAllEnvs();
    integrationConfigInternals.clearKeyCache();
  });

  it("encrypts the full destination and signing secret for an authorized company",async()=>{
    mocks.canManageCompanyIntegrations.mockResolvedValueOnce(true);
    mocks.client.query
      .mockResolvedValueOnce(queryResult([{
        applicationId:ids.application,applicationName:"Fixture",
      }]))
      .mockResolvedValueOnce(queryResult([{count:0}]))
      .mockResolvedValueOnce(queryResult([{
        createdAt:"2026-08-29T00:00:00.000Z",
        updatedAt:"2026-08-29T00:00:00.000Z",
      }]));
    const created=await createManagedWebhookSubscription({
      actor:administrator,connectionId:ids.connection,
      payload:{
        endpoint_url:"https://hooks.receiver.dev/private-path?sensitive-marker=1",
        event_types:["request.approved"],
      },
      resolver:async()=>[{address:"93.184.216.34",family:4}],
    });
    expect(created.credential).toMatch(/^axora_whsec_[A-Za-z0-9_-]{43}$/);
    const serialized=JSON.stringify(mocks.client.query.mock.calls);
    expect(serialized).not.toContain("sensitive-marker");
    expect(serialized).not.toContain(created.credential);
    expect(serialized).toContain("https://hooks.receiver.dev");
    expect(mocks.withIntegrationTransaction).toHaveBeenCalledWith(
      expect.objectContaining({systemIdentity:"integration-management",actor:administrator}),
      expect.any(Function),
    );
  });

  it("rejects an empty managed event selection before opening a transaction",async()=>{
    mocks.canManageCompanyIntegrations.mockResolvedValueOnce(true);
    await expect(createManagedWebhookSubscription({
      actor:administrator,connectionId:ids.connection,
      payload:{endpoint_url:"https://hooks.receiver.dev/empty",event_types:[]},
      resolver:async()=>[{address:"93.184.216.34",family:4}],
    })).rejects.toMatchObject({reason:"INVALID"});
    expect(mocks.withIntegrationTransaction).not.toHaveBeenCalled();
  });

  it("allows the Platform Owner to revoke but not rotate a company credential",async()=>{
    mocks.canManageCompanyIntegrations.mockResolvedValue(false);
    mocks.canManageIntegrationApplications.mockResolvedValueOnce(true);
    mocks.client.query
      .mockResolvedValueOnce(queryResult([{id:ids.subscription}]))
      .mockResolvedValueOnce(queryResult());
    await expect(revokeManagedWebhookSubscription(
      owner,ids.subscription,ids.company,
    )).resolves.toBeUndefined();
    expect(String(mocks.client.query.mock.calls[0]?.[0])).toContain("company_id=$2");

    vi.clearAllMocks();
    mocks.canManageCompanyIntegrations.mockResolvedValueOnce(false);
    await expect(rotateManagedWebhookCredential(
      owner,ids.subscription,ids.company,
    )).rejects.toBeInstanceOf(WebhookManagementError);
    expect(mocks.withIntegrationTransaction).not.toHaveBeenCalled();
  });

  it("does not let a company administrator operate on a foreign company",async()=>{
    mocks.canManageCompanyIntegrations.mockResolvedValueOnce(false);
    await expect(retryManagedWebhookDelivery(
      administrator,ids.delivery,ids.foreignCompany,
    )).rejects.toBeInstanceOf(WebhookManagementError);
    expect(mocks.canViewIntegrationOperations).toHaveBeenCalledWith(administrator);
    expect(mocks.withIntegrationTransaction).not.toHaveBeenCalled();
  });

  it("stores an idempotent webhook creation without persisting its plaintext secret",async()=>{
    mocks.canManageCompanyIntegrations.mockResolvedValueOnce(true);
    const normalizedUrl="https://hooks.receiver.dev/private?sensitive-marker=1";
    const payloadHash=integrationPayloadHash({
      endpoint_url:normalizedUrl,event_types:["request.approved"],
    });
    mocks.client.query
      .mockResolvedValueOnce(queryResult())
      .mockResolvedValueOnce(queryResult([{
        id:"f1294000-0000-4000-8000-000000000022",
        payloadHash,status:"PENDING",
      }]))
      .mockResolvedValueOnce(queryResult([{
        applicationId:ids.application,applicationName:"Fixture",
      }]))
      .mockResolvedValueOnce(queryResult([{count:0}]))
      .mockResolvedValueOnce(queryResult([{
        createdAt:"2026-08-29T00:00:00.000Z",
        updatedAt:"2026-08-29T00:00:00.000Z",
      }]))
      .mockResolvedValueOnce(queryResult())
      .mockResolvedValueOnce(queryResult());
    const result=await createExternalWebhookSubscription({
      principal,payload:{endpoint_url:normalizedUrl,event_types:["request.approved"]},
      idempotencyKey:"webhook-create-fixture",requestId:randomRequestId(),
      networkHash:"a".repeat(64),
      resolver:async()=>[{address:"93.184.216.34",family:4}],
    });
    expect(result.replayed).toBe(false);
    expect(result.data).toMatchObject({
      application_id:ids.application,connection_id:ids.connection,
      company_id:ids.company,
    });
    expect(result.data.signing_secret).toMatch(/^axora_whsec_/);
    const calls=mocks.client.query.mock.calls;
    const idempotencyUpdate=calls.find(([statement])=>
      String(statement).includes("response_body=$3::jsonb"));
    expect(String(idempotencyUpdate?.[1]?.[2])).toContain("signing_version");
    expect(String(idempotencyUpdate?.[1]?.[2])).not.toContain(result.data.signing_secret!);
    const serialized=JSON.stringify(calls);
    expect(serialized).not.toContain("sensitive-marker");
    expect(serialized).not.toContain(result.data.signing_secret!);
  });

  it("rejects an idempotency key reused with a different webhook payload",async()=>{
    mocks.canManageCompanyIntegrations.mockResolvedValueOnce(true);
    mocks.client.query
      .mockResolvedValueOnce(queryResult())
      .mockResolvedValueOnce(queryResult([{
        id:"f1294000-0000-4000-8000-000000000023",
        payloadHash:"0".repeat(64),status:"PENDING",
      }]));
    await expect(createExternalWebhookSubscription({
      principal,
      payload:{
        endpoint_url:"https://hooks.receiver.dev/changed",
        event_types:["request.approved"],
      },
      idempotencyKey:"webhook-reused-fixture",requestId:randomRequestId(),
      networkHash:"a".repeat(64),
      resolver:async()=>[{address:"93.184.216.34",family:4}],
    })).rejects.toMatchObject({
      code:"conflict",status:409,field:"Idempotency-Key",
    });
    expect(mocks.client.query).toHaveBeenCalledTimes(2);
  });

  it("serializes and bounds non-revoked subscriptions per connection",async()=>{
    mocks.canManageCompanyIntegrations.mockResolvedValueOnce(true);
    mocks.client.query
      .mockResolvedValueOnce(queryResult([{
        applicationId:ids.application,applicationName:"Fixture",
      }]))
      .mockResolvedValueOnce(queryResult([{count:25}]));
    await expect(createManagedWebhookSubscription({
      actor:administrator,connectionId:ids.connection,
      payload:{
        endpoint_url:"https://hooks.receiver.dev/capacity",
        event_types:["request.approved"],
      },
      resolver:async()=>[{address:"93.184.216.34",family:4}],
    })).rejects.toMatchObject({reason:"CONFLICT"});
    expect(String(mocks.client.query.mock.calls[0]?.[0]))
      .toContain("FOR UPDATE OF connection");
    expect(mocks.client.query).toHaveBeenCalledTimes(2);
  });
});

function randomRequestId(){
  return "f1294000-0000-4000-8000-000000000099";
}
