import { beforeEach,describe,expect,it,vi } from "vitest";

const mocks=vi.hoisted(()=>({
  enabled:true,
  replayed:true,
  create:vi.fn(),
  mutate:vi.fn(),
  handle:vi.fn(),
}));

const principal={companyId:"f1295000-0000-4000-8000-000000000001"};

vi.mock("@/lib/integrations/api-handler",()=>({
  ExternalApiProblem:class ExternalApiProblem extends Error {
    constructor(
      public readonly code:string,
      public readonly status:number,
      public readonly auditResult:string,
      public readonly field?:string,
      public readonly resourceType?:string,
    ){
      super(code);
    }
  },
  handleExternalApiRequest:mocks.handle,
}));
vi.mock("@/lib/integrations/config",()=>({
  integrationWebhooksEnabled:()=>mocks.enabled,
}));
vi.mock("@/lib/integrations/network",()=>({
  integrationNetworkHash:()=>"a".repeat(64),
}));
vi.mock("@/lib/integrations/pagination",()=>({
  parseExternalPagination:()=>({ok:true,limit:25}),
}));
vi.mock("@/lib/integrations/webhooks",()=>({
  createExternalWebhookSubscription:mocks.create,
  listExternalWebhookSubscriptions:vi.fn(),
  listExternalWebhookDeliveries:vi.fn(),
  mutateExternalWebhook:mocks.mutate,
  parseWebhookSubscriptionInput:(value:unknown)=>value,
}));

import { POST as createSubscription } from "@/app/api/v1/webhook-subscriptions/route";
import { DELETE as revokeSubscription } from "@/app/api/v1/webhook-subscriptions/[id]/route";
import { POST as rotateSecret } from "@/app/api/v1/webhook-subscriptions/[id]/rotate-secret/route";
import { POST as retryDelivery } from "@/app/api/v1/webhook-deliveries/[id]/retry/route";

const resourceId="f1295000-0000-4000-8000-000000000002";
const context={params:Promise.resolve({id:resourceId})};

describe("webhook external routes",()=>{
  beforeEach(()=>{
    vi.clearAllMocks();
    mocks.enabled=true;
    mocks.replayed=true;
    mocks.handle.mockImplementation(async(
      _request:Request,
      _config:unknown,
      handler:(value:typeof principal,requestId:string)=>unknown,
    )=>handler(principal,"f1295000-0000-4000-8000-000000000003"));
    mocks.create.mockImplementation(async()=>({
      data:{id:resourceId},replayed:mocks.replayed,
    }));
    mocks.mutate.mockImplementation(async()=>({
      data:{id:resourceId},replayed:mocks.replayed,
    }));
  });

  it("returns an indistinguishable 404 before authentication while disabled",async()=>{
    mocks.enabled=false;
    const response=await createSubscription(new Request(
      "https://axora.management/api/v1/webhook-subscriptions",
      {method:"POST"},
    ));
    expect(response).toBeInstanceOf(Response);
    expect((response as Response).status).toBe(404);
    expect(mocks.handle).not.toHaveBeenCalled();
  });

  it("leaves idempotent replays for the common request-level audit",async()=>{
    const headers={"idempotency-key":"route-replay-fixture"};
    const createResult=await createSubscription(new Request(
      "https://axora.management/api/v1/webhook-subscriptions",
      {method:"POST",headers:{...headers,"content-type":"application/json"},
        body:JSON.stringify({endpoint_url:"https://hooks.receiver.dev/axora",
          event_types:["request.approved"]})},
    ));
    const mutationResults=await Promise.all([
      revokeSubscription(new Request(
        `https://axora.management/api/v1/webhook-subscriptions/${resourceId}`,
        {method:"DELETE",headers},
      ),context),
      rotateSecret(new Request(
        `https://axora.management/api/v1/webhook-subscriptions/${resourceId}/rotate-secret`,
        {method:"POST",headers},
      ),context),
      retryDelivery(new Request(
        `https://axora.management/api/v1/webhook-deliveries/${resourceId}/retry`,
        {method:"POST",headers},
      ),context),
    ]);
    expect(createResult).toMatchObject({auditRecorded:false,status:201});
    for(const result of mutationResults){
      expect(result).toMatchObject({auditRecorded:false});
    }
  });

  it("marks the transaction-local audit only for a new mutation",async()=>{
    mocks.replayed=false;
    const result=await retryDelivery(new Request(
      `https://axora.management/api/v1/webhook-deliveries/${resourceId}/retry`,
      {method:"POST",headers:{"idempotency-key":"route-new-fixture"}},
    ),context);
    expect(result).toMatchObject({auditRecorded:true});
  });

  it("rejects a body on bodyless mutations without buffering an unlimited stream",async()=>{
    await expect(retryDelivery(new Request(
      `https://axora.management/api/v1/webhook-deliveries/${resourceId}/retry`,
      {method:"POST",body:"unexpected"},
    ),context)).rejects.toMatchObject({
      code:"invalid_request",status:400,field:"body",
    });
    expect(mocks.mutate).not.toHaveBeenCalled();
  });

  it("rejects an oversized chunked subscription body before parsing",async()=>{
    const body=new ReadableStream<Uint8Array>({
      start(controller){
        controller.enqueue(new Uint8Array(16_385));
        controller.close();
      },
    });
    await expect(createSubscription(new Request(
      "https://axora.management/api/v1/webhook-subscriptions",
      {method:"POST",headers:{"content-type":"application/json"},body,
        duplex:"half"} as RequestInit & {duplex:"half"},
    ))).rejects.toMatchObject({
      code:"invalid_request",status:400,field:"body",
    });
    expect(mocks.create).not.toHaveBeenCalled();
  });
});
