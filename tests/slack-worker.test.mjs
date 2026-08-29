import { describe,expect,it,vi } from "vitest";
import {
  deliverSlackAttempt,
  encryptWorkerIntegrationValue,
  pollIntegrationWorkerOnce,
  slackMessageForJob,
  slackWorkerConfiguration,
} from "../server-tools/integration-worker.mjs";

const ids={
  delivery:"f1321000-0000-4000-8000-000000000001",
  event:"f1321000-0000-4000-8000-000000000002",
  installation:"f1321000-0000-4000-8000-000000000003",
  connection:"f1321000-0000-4000-8000-000000000004",
  company:"f1321000-0000-4000-8000-000000000005",
  resource:"f1321000-0000-4000-8000-000000000006",
  lease:"f1321000-0000-4000-8000-000000000007",
};
const accessToken=`xoxe.xoxb-${"a".repeat(48)}`;
const refreshToken=`xoxe-${"b".repeat(48)}`;
const rootKey=Buffer.alloc(32,0x42);
const configuration={
  clientId:"123456789.987654321",
  clientSecret:"fixture-client-secret-that-is-never-real",
  origin:"https://axora.management",
};

function job(overrides={}) {
  return {
    delivery_id:ids.delivery,event_id:ids.event,installation_id:ids.installation,
    connection_id:ids.connection,company_id:ids.company,attempt_number:1,
    cycle_attempt_number:1,token_version:1,
    access_token_ciphertext:encryptWorkerIntegrationValue(
      rootKey,`slack-access-token:${ids.installation}:v1`,accessToken,
    ),
    refresh_token_ciphertext:encryptWorkerIntegrationValue(
      rootKey,`slack-refresh-token:${ids.installation}:v1`,refreshToken,
    ),
    access_token_expires_at:new Date(Date.now()+60*60_000).toISOString(),
    workspace_id:"T123456789",channel_id:"C123456789",
    event_type:"request.approved",schema_version:1,
    occurred_at:"2026-08-29T00:00:00.000Z",resource_type:"request",
    resource_id:ids.resource,
    resource_url:`/api/v1/requests/${ids.resource}`,
    summary:{
      order_code:"ORD-FICTIONAL",branch_name:"Fixture branch",
      currency:"MYR",total:"125.50",
      supplier_cost:"1.00",margin:"99",raw_coordinates:"3.1,101.6",
      proof_path:"/private/proof",otp:"123456",receiver_phone:"+6000000000",
    },
    lease_token:ids.lease,...overrides,
  };
}

function slackResponse(body,status=200,headers={}) {
  return new Response(JSON.stringify(body),{status,headers});
}

describe("isolated Slack delivery worker",()=>{
  it("builds a minimal deep-link message with no sensitive or financial controls",()=>{
    const message=slackMessageForJob(job(),configuration.origin);
    const serialized=JSON.stringify(message);
    expect(message.client_msg_id).toBe(ids.event);
    expect(message.channel).toBe("C123456789");
    expect(message.mrkdwn).toBe(false);
    expect(serialized).toContain(`https://axora.management/requests/${ids.resource}`);
    expect(serialized).toContain("MYR 125.50");
    for(const forbidden of [
      "supplier_cost","margin","raw_coordinates","proof_path","otp",
      "receiver_phone","Approve","Reject","Pay","Top Up","Complete Delivery",
    ])expect(serialized).not.toContain(forbidden);
    expect(serialized).not.toContain(accessToken);
    expect(message.blocks.at(-1)).toMatchObject({
      type:"actions",elements:[{action_id:"open_in_axora"}],
    });
  });

  it("maps invoice and delivery notifications to authorization-preserving portal routes",()=>{
    expect(JSON.stringify(slackMessageForJob(job({
      event_type:"invoice.finalized",resource_type:"invoice",
    }),configuration.origin))).toContain("https://axora.management/finance");
    expect(JSON.stringify(slackMessageForJob(job({
      event_type:"delivery.completed",resource_type:"delivery",
    }),configuration.origin))).toContain("https://axora.management/deliveries");
  });

  it.each([
    [429,{ok:false,error:"ratelimited"},"RETRY","RATE_LIMITED"],
    [500,{ok:false,error:"internal_error"},"RETRY","PROVIDER_UNAVAILABLE"],
    [200,{ok:false,error:"token_revoked"},"FAILED","TOKEN_REVOKED"],
    [200,{ok:false,error:"not_in_channel"},"FAILED","CHANNEL_UNAVAILABLE"],
  ])("classifies Slack response %s independently",async(status,body,outcome,category)=>{
    const fetchImpl=vi.fn(async()=>slackResponse(body,status,
      status===429?{"retry-after":"31"}:{}));
    await expect(deliverSlackAttempt({
      accessToken,message:slackMessageForJob(job(),configuration.origin),
    },{fetchImpl})).resolves.toMatchObject({outcome,errorCategory:category});
  });

  it("uses the stable event ID across a retry and never follows redirects",async()=>{
    const message=slackMessageForJob(job(),configuration.origin);
    const fetchImpl=vi.fn(async(_url,init)=>{
      expect(init.redirect).toBe("error");
      expect(JSON.parse(init.body).client_msg_id).toBe(ids.event);
      return slackResponse({ok:true,ts:"1800000000.000001"});
    });
    await expect(deliverSlackAttempt({accessToken,message},{fetchImpl}))
      .resolves.toMatchObject({outcome:"SUCCEEDED",responseStatus:200});
    await expect(deliverSlackAttempt({accessToken,message},{fetchImpl}))
      .resolves.toMatchObject({outcome:"SUCCEEDED",responseStatus:200});
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("bounds responses and treats provider timeout as retryable",async()=>{
    await expect(deliverSlackAttempt({
      accessToken,message:slackMessageForJob(job(),configuration.origin),
    },{fetchImpl:async()=>new Response("x",{
      status:200,headers:{"content-length":"70000"},
    })})).resolves.toMatchObject({outcome:"FAILED",errorCategory:"INVALID_RESPONSE"});
    await expect(deliverSlackAttempt({
      accessToken,message:slackMessageForJob(job(),configuration.origin),
    },{fetchImpl:async()=>{throw Object.assign(new Error("timeout"),{name:"TimeoutError"})}}))
      .resolves.toMatchObject({outcome:"RETRY",errorCategory:"TIMEOUT"});
  });

  it("rechecks live authorization before and after token access",async()=>{
    let authorizationChecks=0;
    const completions=[];
    const outbound=vi.fn(async()=>({outcome:"SUCCEEDED",responseStatus:200,durationMs:1}));
    const db={query:vi.fn(async(statement,values)=>{
      const sql=String(statement);
      if(sql.includes("axora_project_integration_events_with_capabilities"))return {rows:[{result:{}}]};
      if(sql.includes("axora_claim_integration_slack_deliveries"))return {rows:[job()]};
      if(sql.includes("axora_claimed_slack_delivery_is_authorized")){
        authorizationChecks+=1;return {rows:[{allowed:true}]};
      }
      if(sql.includes("axora_complete_integration_slack_delivery")){
        completions.push(values);return {rows:[{status:"SUCCEEDED"}]};
      }
      if(sql.includes("axora_claim_slack_revocations"))return {rows:[]};
      throw new Error(`Unexpected query: ${sql}`);
    })};
    await expect(pollIntegrationWorkerOnce({
      db,workerId:"integration-fixture01",enabled:true,webhooksEnabled:false,
      slackEnabled:true,slackConfiguration:configuration,rootKey,deliverSlack:outbound,
    })).resolves.toMatchObject({slackClaimed:1,failedJobs:0});
    expect(authorizationChecks).toBe(2);
    expect(outbound).toHaveBeenCalledOnce();
    expect(completions[0]).toEqual(expect.arrayContaining([
      "integration-fixture01",ids.delivery,ids.lease,"SUCCEEDED",200,null,
    ]));
  });

  it("fails a claimed message closed when current authorization is revoked",async()=>{
    const completions=[];
    const outbound=vi.fn();
    const db={query:vi.fn(async(statement,values)=>{
      const sql=String(statement);
      if(sql.includes("axora_project_integration_events_with_capabilities"))return {rows:[{}]};
      if(sql.includes("axora_claim_integration_slack_deliveries"))return {rows:[job()]};
      if(sql.includes("axora_claimed_slack_delivery_is_authorized"))return {rows:[{allowed:false}]};
      if(sql.includes("axora_complete_integration_slack_delivery")){
        completions.push(values);return {rows:[{status:"FAILED"}]};
      }
      if(sql.includes("axora_claim_slack_revocations"))return {rows:[]};
      throw new Error(`Unexpected query: ${sql}`);
    })};
    await pollIntegrationWorkerOnce({
      db,workerId:"integration-fixture01",enabled:true,webhooksEnabled:false,
      slackEnabled:true,slackConfiguration:configuration,rootKey,deliverSlack:outbound,
    });
    expect(outbound).not.toHaveBeenCalled();
    expect(completions[0]).toEqual(expect.arrayContaining([
      "FAILED",null,"AUTHORIZATION_REVOKED",0,
    ]));
  });

  it("contains a Slack outage without preventing an ordinary webhook completion",async()=>{
    const webhookJob={
      delivery_id:"f1321000-0000-4000-8000-000000000021",
      event_id:ids.event,subscription_id:"f1321000-0000-4000-8000-000000000022",
      company_id:ids.company,attempt_number:1,cycle_attempt_number:1,
      credential_version:1,event_type:"request.approved",schema_version:1,
      occurred_at:"2026-08-29T00:00:00.000Z",resource_type:"request",
      resource_id:ids.resource,resource_url:`/api/v1/requests/${ids.resource}`,
      summary:{order_code:"ORD-FICTIONAL"},lease_token:"f1321000-0000-4000-8000-000000000023",
      endpoint:"https://hooks.receiver.dev/axora",
    };
    const webhookSecret=`axora_whsec_${"c".repeat(43)}`;
    webhookJob.endpoint_ciphertext=encryptWorkerIntegrationValue(
      rootKey,`webhook-endpoint:${webhookJob.subscription_id}`,webhookJob.endpoint,
    );
    webhookJob.credential_ciphertext=encryptWorkerIntegrationValue(
      rootKey,`webhook-credential:${webhookJob.subscription_id}`,webhookSecret,
    );
    const completions=[];
    const db={query:vi.fn(async(statement,values)=>{
      const sql=String(statement);
      if(sql.includes("axora_project_integration_events_with_capabilities"))return {rows:[{}]};
      if(sql.includes("axora_claim_integration_webhook_deliveries"))return {rows:[webhookJob]};
      if(sql.includes("axora_claim_integration_slack_deliveries"))return {rows:[job()]};
      if(sql.includes("claimed_webhook_delivery_is_authorized")
        ||sql.includes("claimed_slack_delivery_is_authorized"))return {rows:[{allowed:true}]};
      if(sql.includes("axora_complete_integration_webhook_delivery")
        ||sql.includes("axora_complete_integration_slack_delivery")){
        completions.push({sql,values});return {rows:[{}]};
      }
      if(sql.includes("axora_claim_slack_revocations"))return {rows:[]};
      throw new Error(`Unexpected query: ${sql}`);
    })};
    const result=await pollIntegrationWorkerOnce({
      db,workerId:"integration-fixture01",enabled:true,webhooksEnabled:true,
      slackEnabled:true,slackConfiguration:configuration,rootKey,
      deliver:async()=>({outcome:"SUCCEEDED",responseStatus:204,durationMs:1}),
      deliverSlack:async()=>{throw new Error("Slack unavailable")},
    });
    expect(result).toMatchObject({webhookClaimed:1,slackClaimed:1,failedJobs:1});
    expect(completions.some(({sql})=>sql.includes("webhook_delivery"))).toBe(true);
  });

  it("revokes provider credentials asynchronously and preserves bounded retry",async()=>{
    const revocation={
      installation_id:ids.installation,token_version:1,
      access_token_ciphertext:job().access_token_ciphertext,
      refresh_token_ciphertext:job().refresh_token_ciphertext,
      attempt_number:1,lease_token:ids.lease,
    };
    const completions=[];
    const db={query:vi.fn(async(statement,values)=>{
      const sql=String(statement);
      if(sql.includes("axora_project_integration_events_with_capabilities"))return {rows:[{}]};
      if(sql.includes("axora_claim_integration_slack_deliveries"))return {rows:[]};
      if(sql.includes("axora_claim_slack_revocations"))return {rows:[revocation]};
      if(sql.includes("axora_complete_slack_revocation")){
        completions.push(values);return {rows:[{status:"REVOKING"}]};
      }
      throw new Error(`Unexpected query: ${sql}`);
    })};
    const revokeSlack=vi.fn()
      .mockResolvedValueOnce({succeeded:true})
      .mockResolvedValueOnce({
        succeeded:false,errorCategory:"RATE_LIMITED",retryAfterSeconds:37,
      });
    await expect(pollIntegrationWorkerOnce({
      db,workerId:"integration-fixture01",enabled:true,webhooksEnabled:false,
      slackEnabled:true,slackConfiguration:configuration,rootKey,revokeSlack,
    })).resolves.toMatchObject({revocationsClaimed:1,failedJobs:0});
    expect(revokeSlack).toHaveBeenCalledTimes(2);
    expect(revokeSlack).toHaveBeenNthCalledWith(1,accessToken);
    expect(revokeSlack).toHaveBeenNthCalledWith(2,refreshToken);
    expect(completions[0]).toEqual([
      "integration-fixture01",ids.installation,ids.lease,false,
      "RATE_LIMITED",37,
    ]);
  });

  it("requires file-mounted Slack client credentials in production",()=>{
    expect(()=>slackWorkerConfiguration({
      NODE_ENV:"production",AXORA_SLACK_CLIENT_ID:configuration.clientId,
      AXORA_SLACK_CLIENT_SECRET:configuration.clientSecret,
      APP_BASE_URL:configuration.origin,
    })).toThrow(/file-mounted/i);
    expect(()=>slackWorkerConfiguration({
      AXORA_SLACK_CLIENT_ID:"invalid",AXORA_SLACK_CLIENT_SECRET:"short",
      APP_BASE_URL:"http://internal.invalid",
    })).toThrow(/unavailable/i);
  });
});
