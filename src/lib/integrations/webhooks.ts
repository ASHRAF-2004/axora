import { randomUUID } from "node:crypto";
import type { PoolClient, QueryResultRow } from "pg";
import { z } from "zod";
import type { AuthenticatedSessionUser } from "../auth";
import { isDemoMode } from "../db";
import {
  canManageCompanyIntegrations,
  canManageIntegrationApplications,
  canViewIntegrationOperations,
} from "./authorization";
import type { IntegrationPrincipal } from "./api-auth";
import { ExternalApiProblem } from "./api-handler";
import { integrationWebhooksEnabled } from "./config";
import {
  decryptIntegrationValue,
  encryptIntegrationValue,
  hashIntegrationSecret,
  integrationPayloadHash,
  opaqueIntegrationSecret,
  type EncryptedIntegrationValue,
} from "./crypto";
import { withIntegrationTransaction } from "./database";
import {
  INTEGRATION_EVENT_TYPES,
  type IntegrationEventType,
} from "./events";
import { encodeExternalCursor, type ExternalCursor } from "./pagination";
import {
  resolveWebhookDestination,
  type WebhookResolver,
  WebhookDestinationError,
} from "./webhook-destination";

const eventTypeSchema = z.enum(INTEGRATION_EVENT_TYPES);
const MAX_ACTIVE_SUBSCRIPTIONS_PER_CONNECTION=25;
const subscriptionInputSchema = z.object({
  endpoint_url: z.string().trim().min(9).max(2048),
  event_types: z.array(eventTypeSchema).min(1).max(INTEGRATION_EVENT_TYPES.length),
  credential_delivery: z.enum(["one_time","none"]).default("one_time"),
}).strict();

export type WebhookSubscriptionInput = z.input<typeof subscriptionInputSchema>;

export class WebhookManagementError extends Error {
  constructor(public readonly reason: "DENIED" | "INVALID" | "NOT_FOUND" | "CONFLICT" | "UNAVAILABLE") {
    super("Webhook management is unavailable.");
    this.name = "WebhookManagementError";
  }
}

function requireWebhookCapability() {
  if (!integrationWebhooksEnabled()) {
    throw new WebhookManagementError("UNAVAILABLE");
  }
}

export interface WebhookSubscriptionSummary {
  id: string;
  applicationId: string;
  applicationName: string;
  connectionId: string;
  companyId: string;
  companyName: string;
  endpointOrigin: string;
  eventTypes: IntegrationEventType[];
  status: "ACTIVE" | "PAUSED" | "REVOKED";
  credentialDelivery: "ONE_TIME" | "NONE";
  credentialVersion: number;
  authorizedBy?: string;
  createdAt: string;
  updatedAt: string;
  pausedAt?: string;
  revokedAt?: string;
}

export interface WebhookDeliverySummary {
  id: string;
  eventId: string;
  subscriptionId: string;
  companyId: string;
  eventType: IntegrationEventType;
  resourceType: "company" | "request" | "invoice" | "delivery";
  resourceId: string;
  resourceUrl: string;
  status: "PENDING" | "DELIVERING" | "SUCCEEDED" | "RETRY" | "FAILED" | "DEAD";
  attemptCount: number;
  manualRetryCount: number;
  availableAt: string;
  lastAttemptAt?: string;
  completedAt?: string;
  responseStatus?: number;
  errorCategory?: string;
  createdAt: string;
}

export interface WebhookWorkspace {
  subscriptions: WebhookSubscriptionSummary[];
  deliveries: WebhookDeliverySummary[];
  availableConnections: Array<{
    id: string;
    applicationName: string;
    companyId: string;
    companyName: string;
  }>;
  operations?: {
    eventCount24h: number;
    pendingDeliveries: number;
    retryDeliveries: number;
    deadDeliveries: number;
    succeeded24h: number;
  };
}

interface SubscriptionRow extends QueryResultRow, WebhookSubscriptionSummary {}
interface DeliveryRow extends QueryResultRow, WebhookDeliverySummary {}

function orderedEventTypes(values: readonly IntegrationEventType[]) {
  const selected = new Set(values);
  return INTEGRATION_EVENT_TYPES.filter((eventType) => selected.has(eventType));
}

export function parseWebhookSubscriptionInput(value: unknown) {
  const parsed = subscriptionInputSchema.safeParse(value);
  if (!parsed.success || new Set(parsed.data.event_types).size !== parsed.data.event_types.length) {
    throw new ExternalApiProblem(
      "invalid_request",400,"INVALID","body","webhook_subscription",
    );
  }
  return {
    endpoint_url: parsed.data.endpoint_url,
    event_types: orderedEventTypes(parsed.data.event_types),
    credential_delivery: parsed.data.credential_delivery,
  };
}

function idempotencyKeyHash(connectionId: string, key: string) {
  if (!/^[A-Za-z0-9._~:-]{8,128}$/.test(key)) {
    throw new ExternalApiProblem(
      "invalid_request",400,"INVALID","Idempotency-Key","webhook_subscription",
    );
  }
  return hashIntegrationSecret("idempotency-key",`${connectionId}\0${key}`);
}

async function requirePrincipalWebhookManagement(principal: IntegrationPrincipal) {
  if (!await canManageCompanyIntegrations(principal.actor,principal.companyId)) {
    throw new ExternalApiProblem("forbidden",403,"DENIED",undefined,"webhook_subscription");
  }
}

async function prepareDestination(
  input: WebhookSubscriptionInput,
  resolver?: WebhookResolver,
) {
  try {
    const destination = await resolveWebhookDestination(input.endpoint_url,resolver);
    return {
      normalizedUrl: destination.url.href,
      endpointOrigin: destination.endpointOrigin,
      eventTypes: orderedEventTypes(input.event_types),
      credentialDelivery: input.credential_delivery ?? "one_time",
    };
  } catch (error) {
    if (error instanceof WebhookDestinationError) {
      throw new ExternalApiProblem(
        "invalid_request",400,"INVALID","endpoint_url","webhook_subscription",
      );
    }
    throw error;
  }
}

async function validateConnection(
  client: PoolClient,
  input: { connectionId: string; companyId: string; applicationId?: string },
) {
  const values: unknown[] = [input.connectionId,input.companyId];
  let appPredicate = "";
  if (input.applicationId) {
    values.push(input.applicationId);
    appPredicate = "AND application.id=$3";
  }
  const result = await client.query<{
    applicationId: string; applicationName: string;
  }>(`
    SELECT application.id::text AS "applicationId",application.name AS "applicationName"
    FROM public.integration_connections connection
    JOIN public.integration_applications application
      ON application.id=connection.application_id AND application.status='ACTIVE'
    WHERE connection.id=$1 AND connection.company_id=$2
      AND connection.status='ACTIVE' ${appPredicate}
      AND 'webhooks:manage'=ANY(application.allowed_scopes)
    FOR UPDATE OF connection
  `,values);
  return result.rows[0];
}

async function requireSubscriptionCapacity(
  client:PoolClient,
  connectionId:string,
){
  const result=await client.query<{count:number}>(`
    SELECT count(*)::int AS count
    FROM public.integration_webhook_subscriptions
    WHERE connection_id=$1 AND status<>'REVOKED'
  `,[connectionId]);
  if(Number(result.rows[0]?.count??0)>=MAX_ACTIVE_SUBSCRIPTIONS_PER_CONNECTION){
    throw new ExternalApiProblem(
      "conflict",409,"INVALID",undefined,"webhook_subscription",
    );
  }
}

async function beginIdempotency(
  client: PoolClient,
  input: {
    principal: IntegrationPrincipal;
    command: string;
    keyHash: string;
    payloadHash: string;
  },
) {
  await client.query(`
    INSERT INTO public.integration_api_idempotency(
      connection_id,company_id,grant_id,command,idempotency_key_hash,
      payload_hash,expires_at
    ) VALUES ($1,$2,$3,$4,$5,$6,now()+interval '24 hours')
    ON CONFLICT(connection_id,command,idempotency_key_hash) DO NOTHING
  `,[
    input.principal.connectionId,input.principal.companyId,input.principal.grantId,
    input.command,input.keyHash,input.payloadHash,
  ]);
  const result = await client.query<{
    id: string; payloadHash: string; status: string;
    responseBody?: Record<string,unknown>;
  }>(`
    SELECT id::text,payload_hash AS "payloadHash",status,
      response_body AS "responseBody"
    FROM public.integration_api_idempotency
    WHERE connection_id=$1 AND command=$2 AND idempotency_key_hash=$3
    FOR UPDATE
  `,[input.principal.connectionId,input.command,input.keyHash]);
  const row=result.rows[0];
  if (!row) throw new Error("Webhook idempotency state is unavailable.");
  if (row.payloadHash!==input.payloadHash) {
    throw new ExternalApiProblem(
      "conflict",409,"INVALID","Idempotency-Key","webhook_subscription",
    );
  }
  return row;
}

async function completeIdempotency(
  client: PoolClient,
  id: string,
  response: Record<string,unknown>,
  resourceType: "webhook_subscription" | "webhook_delivery",
  resourceId: string,
  status = 200,
) {
  await client.query(`
    UPDATE public.integration_api_idempotency
    SET status='COMPLETED',response_status=$2,response_body=$3::jsonb,
      resource_type=$4,resource_id=$5,completed_at=now()
    WHERE id=$1
  `,[id,status,JSON.stringify(response),resourceType,resourceId]);
}

async function recordMutationAudit(
  client: PoolClient,
  input: {
    principal: IntegrationPrincipal; requestId: string; networkHash: string;
    route: string; action: string; resourceType: string; resourceId: string;
    status: number;
  },
) {
  await client.query(`
    INSERT INTO public.integration_api_audit(
      request_id,application_id,connection_id,company_id,grant_id,
      delegating_user_id,scopes,route,action,resource_type,resource_id,
      result,http_status,network_hash,details
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'SUCCESS',$12,$13,'{}'::jsonb)
  `,[
    input.requestId,input.principal.applicationId,input.principal.connectionId,
    input.principal.companyId,input.principal.grantId,input.principal.actor.id,
    input.principal.scopes,input.route,input.action,input.resourceType,
    input.resourceId,input.status,input.networkHash,
  ]);
}

async function insertSubscription(
  client: PoolClient,
  input: {
    id: string; applicationId: string; connectionId: string; companyId: string;
    actor: AuthenticatedSessionUser; normalizedUrl: string; endpointOrigin: string;
    eventTypes: readonly IntegrationEventType[]; credential: string;
    credentialDelivery: "one_time" | "none";
  },
) {
  const endpointCiphertext=encryptIntegrationValue(
    `webhook-endpoint:${input.id}`,input.normalizedUrl,
  );
  const credentialCiphertext=encryptIntegrationValue(
    `webhook-credential:${input.id}`,input.credential,
  );
  const endpointHash=hashIntegrationSecret(
    "webhook-endpoint",`${input.connectionId}\0${input.normalizedUrl}`,
  );
  try {
    const result=await client.query<{createdAt:string;updatedAt:string}>(`
      INSERT INTO public.integration_webhook_subscriptions(
        id,application_id,connection_id,company_id,endpoint_ciphertext,
        endpoint_hash,endpoint_origin,event_types,credential_delivery,
        current_credential_ciphertext,
        authorized_user_id,authorized_role_assignment_id,
        auth_version_at_authorization,created_by
      ) VALUES (
        $1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10::jsonb,$11,$12,$13,$11
      )
      RETURNING created_at::text AS "createdAt",updated_at::text AS "updatedAt"
    `,[
      input.id,input.applicationId,input.connectionId,input.companyId,
      JSON.stringify(endpointCiphertext),endpointHash,input.endpointOrigin,
      input.eventTypes,input.credentialDelivery.toUpperCase(),
      JSON.stringify(credentialCiphertext),input.actor.id,
      input.actor.roleAssignmentId,input.actor.authVersion,
    ]);
    return result.rows[0]!;
  } catch (error) {
    if ((error as {code?:string}).code==="23505") {
      throw new ExternalApiProblem(
        "conflict",409,"INVALID","endpoint_url","webhook_subscription",
      );
    }
    throw error;
  }
}

export async function createExternalWebhookSubscription(input: {
  principal: IntegrationPrincipal;
  payload: WebhookSubscriptionInput;
  idempotencyKey: string;
  requestId: string;
  networkHash: string;
  resolver?: WebhookResolver;
}) {
  await requirePrincipalWebhookManagement(input.principal);
  const prepared=await prepareDestination(input.payload,input.resolver);
  const payloadHash=integrationPayloadHash({
    endpoint_url:prepared.normalizedUrl,event_types:prepared.eventTypes,
    ...(prepared.credentialDelivery==="none"?{credential_delivery:"none"}:{}),
  });
  const keyHash=idempotencyKeyHash(input.principal.connectionId,input.idempotencyKey);
  return withIntegrationTransaction({
    systemIdentity:"integration-api",reason:"Create signed webhook subscription",
    actor:input.principal.actor,correlationId:input.requestId,
  },async (client)=>{
    const replay=await beginIdempotency(client,{
      principal:input.principal,command:"webhook_subscription.create",
      keyHash,payloadHash,
    });
    if (replay.status==="COMPLETED" && replay.responseBody) {
      const id=String(replay.responseBody.id??"");
      const version=Number(replay.responseBody.signing_version??0);
      const revealCredential=replay.responseBody.credential_delivery!=="none";
      const current=await client.query<{
        credentialVersion:number; credentialCiphertext:EncryptedIntegrationValue;
      }>(`
        SELECT credential_version AS "credentialVersion",
          current_credential_ciphertext AS "credentialCiphertext"
        FROM public.integration_webhook_subscriptions
        WHERE id=$1 AND connection_id=$2 AND company_id=$3
          AND status='ACTIVE'
      `,[id,input.principal.connectionId,input.principal.companyId]);
      const row=current.rows[0];
      return {
        data:{
          id,
          status:replay.responseBody.status,
          endpoint_origin:replay.responseBody.endpoint_origin,
          event_types:replay.responseBody.event_types,
          credential_version:version,
          created_at:replay.responseBody.created_at,
          updated_at:replay.responseBody.updated_at,
          credential_available:Boolean(
            revealCredential && row && row.credentialVersion===version,
          ),
          ...(revealCredential && row && row.credentialVersion===version ? {
            signing_secret:decryptIntegrationValue(
              `webhook-credential:${id}`,row.credentialCiphertext,
            ),
          }:{}),
        },replayed:true,
      };
    }
    const connection=await validateConnection(client,{
      connectionId:input.principal.connectionId,
      companyId:input.principal.companyId,
      applicationId:input.principal.applicationId,
    });
    if (!connection) throw new ExternalApiProblem(
      "not_found",404,"NOT_FOUND",undefined,"webhook_subscription",
    );
    await requireSubscriptionCapacity(client,input.principal.connectionId);
    const id=randomUUID();
    const credential=opaqueIntegrationSecret("axora_whsec_");
    const created=await insertSubscription(client,{
      id,applicationId:connection.applicationId,
      connectionId:input.principal.connectionId,companyId:input.principal.companyId,
      actor:input.principal.actor,normalizedUrl:prepared.normalizedUrl,
      endpointOrigin:prepared.endpointOrigin,eventTypes:prepared.eventTypes,credential,
      credentialDelivery:prepared.credentialDelivery,
    });
    const response={
      id,application_id:connection.applicationId,
      connection_id:input.principal.connectionId,
      company_id:input.principal.companyId,
      status:"active",endpoint_origin:prepared.endpointOrigin,
      event_types:prepared.eventTypes,
      credential_delivery:prepared.credentialDelivery,
      created_at:created.createdAt,updated_at:created.updatedAt,
    };
    const storedResponse={...response,signing_version:1};
    await completeIdempotency(
      client,replay.id,storedResponse,"webhook_subscription",id,201,
    );
    await recordMutationAudit(client,{
      principal:input.principal,requestId:input.requestId,
      networkHash:input.networkHash,route:"/api/v1/webhook-subscriptions",
      action:"WEBHOOK_SUBSCRIPTION_CREATE",resourceType:"webhook_subscription",
      resourceId:id,status:201,
    });
    const revealCredential=prepared.credentialDelivery==="one_time";
    return {data:{...response,credential_version:1,
      credential_available:revealCredential,
      ...(revealCredential?{signing_secret:credential}:{})},replayed:false};
  });
}

function subscriptionSelect() {
  return `SELECT subscription.id::text,
    subscription.application_id::text AS "applicationId",
    application.name AS "applicationName",
    subscription.connection_id::text AS "connectionId",
    subscription.company_id::text AS "companyId",company.name AS "companyName",
    subscription.endpoint_origin AS "endpointOrigin",
    subscription.event_types AS "eventTypes",subscription.status,
    subscription.credential_delivery AS "credentialDelivery",
    subscription.credential_version AS "credentialVersion",
    COALESCE(profile.display_name,account.display_name) AS "authorizedBy",
    subscription.created_at::text AS "createdAt",
    subscription.updated_at::text AS "updatedAt",
    subscription.paused_at::text AS "pausedAt",
    subscription.revoked_at::text AS "revokedAt"
  FROM public.integration_webhook_subscriptions subscription
  JOIN public.integration_applications application
    ON application.id=subscription.application_id
  JOIN public.companies company ON company.id=subscription.company_id
  LEFT JOIN public.users account ON account.id=subscription.authorized_user_id
  LEFT JOIN public.user_profiles profile ON profile.user_id=account.id`;
}

function deliverySelect() {
  return `SELECT delivery.id::text,event.id::text AS "eventId",
    delivery.subscription_id::text AS "subscriptionId",
    delivery.company_id::text AS "companyId",event.event_type AS "eventType",
    event.resource_type AS "resourceType",event.resource_id::text AS "resourceId",
    event.resource_url AS "resourceUrl",delivery.status,
    delivery.attempt_count AS "attemptCount",
    delivery.manual_retry_count AS "manualRetryCount",
    delivery.available_at::text AS "availableAt",
    delivery.last_attempt_at::text AS "lastAttemptAt",
    delivery.completed_at::text AS "completedAt",
    delivery.response_status AS "responseStatus",
    delivery.error_category AS "errorCategory",
    delivery.created_at::text AS "createdAt"
  FROM public.integration_webhook_deliveries delivery
  JOIN public.integration_events event ON event.id=delivery.event_id
  JOIN public.integration_webhook_subscriptions subscription
    ON subscription.id=delivery.subscription_id`;
}

export async function listExternalWebhookSubscriptions(input: {
  principal: IntegrationPrincipal; limit: number; cursor?: ExternalCursor;
}) {
  await requirePrincipalWebhookManagement(input.principal);
  const values:unknown[]=[input.principal.connectionId,input.principal.companyId];
  let cursorSql="";
  if (input.cursor) {
    values.push(input.cursor.sort,input.cursor.id);
    cursorSql=`AND (subscription.created_at,subscription.id)<($3::timestamptz,$4::uuid)`;
  }
  values.push(input.limit+1);
  const result=await withIntegrationTransaction({
    systemIdentity:"integration-api",reason:"List webhook subscriptions",
    actor:input.principal.actor,
  },(client)=>client.query<SubscriptionRow>(`
    ${subscriptionSelect()}
    WHERE subscription.connection_id=$1 AND subscription.company_id=$2
      ${cursorSql}
    ORDER BY subscription.created_at DESC,subscription.id DESC
    LIMIT $${values.length}
  `,values));
  const hasMore=result.rows.length>input.limit;
  const rows=result.rows.slice(0,input.limit);
  const last=rows.at(-1);
  return {
    data:rows.map(subscriptionDto),hasMore,
    nextCursor:hasMore&&last?encodeExternalCursor({
      route:"/api/v1/webhook-subscriptions",companyId:input.principal.companyId,
      sort:last.createdAt,id:last.id,
    }):null,
  };
}

function subscriptionDto(row: WebhookSubscriptionSummary) {
  return {
    id:row.id,application_id:row.applicationId,connection_id:row.connectionId,
    company_id:row.companyId,endpoint_origin:row.endpointOrigin,
    event_types:row.eventTypes,status:row.status.toLowerCase(),
    credential_delivery:row.credentialDelivery.toLowerCase(),
    credential_version:Number(row.credentialVersion),created_at:row.createdAt,
    updated_at:row.updatedAt,paused_at:row.pausedAt,revoked_at:row.revokedAt,
  };
}

export async function listExternalWebhookDeliveries(input: {
  principal: IntegrationPrincipal; limit: number; cursor?: ExternalCursor;
}) {
  await requirePrincipalWebhookManagement(input.principal);
  const values:unknown[]=[input.principal.connectionId,input.principal.companyId];
  let cursorSql="";
  if (input.cursor) {
    values.push(input.cursor.sort,input.cursor.id);
    cursorSql=`AND (delivery.created_at,delivery.id)<($3::timestamptz,$4::uuid)`;
  }
  values.push(input.limit+1);
  const result=await withIntegrationTransaction({
    systemIdentity:"integration-api",reason:"List webhook delivery status",
    actor:input.principal.actor,
  },(client)=>client.query<DeliveryRow>(`
    ${deliverySelect()}
    WHERE subscription.connection_id=$1 AND delivery.company_id=$2 ${cursorSql}
    ORDER BY delivery.created_at DESC,delivery.id DESC LIMIT $${values.length}
  `,values));
  const hasMore=result.rows.length>input.limit;
  const rows=result.rows.slice(0,input.limit);
  const last=rows.at(-1);
  return {
    data:rows.map(deliveryDto),hasMore,
    nextCursor:hasMore&&last?encodeExternalCursor({
      route:"/api/v1/webhook-deliveries",companyId:input.principal.companyId,
      sort:last.createdAt,id:last.id,
    }):null,
  };
}

function deliveryDto(row: WebhookDeliverySummary) {
  return {
    id:row.id,event_id:row.eventId,subscription_id:row.subscriptionId,
    company_id:row.companyId,event_type:row.eventType,
    resource_type:row.resourceType,resource_id:row.resourceId,
    resource_url:row.resourceUrl,status:row.status.toLowerCase(),
    attempt_count:Number(row.attemptCount),manual_retry_count:Number(row.manualRetryCount),
    available_at:row.availableAt,last_attempt_at:row.lastAttemptAt,
    completed_at:row.completedAt,response_status:row.responseStatus,
    error_category:row.errorCategory,created_at:row.createdAt,
  };
}

type MutationKind="revoke"|"rotate"|"retry";

export async function mutateExternalWebhook(input: {
  principal:IntegrationPrincipal;kind:MutationKind;resourceId:string;
  idempotencyKey:string;requestId:string;networkHash:string;
}) {
  await requirePrincipalWebhookManagement(input.principal);
  if (!z.uuid().safeParse(input.resourceId).success) throw new ExternalApiProblem(
    "invalid_request",400,"INVALID","id",
    input.kind==="retry"?"webhook_delivery":"webhook_subscription",
  );
  const command=`webhook_${input.kind}.execute`;
  const payloadHash=integrationPayloadHash({id:input.resourceId});
  const keyHash=idempotencyKeyHash(input.principal.connectionId,input.idempotencyKey);
  return withIntegrationTransaction({
    systemIdentity:"integration-api",reason:`Webhook ${input.kind}`,
    actor:input.principal.actor,correlationId:input.requestId,
  },async(client)=>{
    const replay=await beginIdempotency(client,{
      principal:input.principal,command,keyHash,payloadHash,
    });
    if(replay.status==="COMPLETED"&&replay.responseBody){
      if(input.kind!=="rotate") return {data:replay.responseBody,replayed:true};
      const version=Number(replay.responseBody.signing_version??0);
      const revealCredential=replay.responseBody.credential_delivery!=="none";
      if(!revealCredential)return {data:{
        id:replay.responseBody.id,status:replay.responseBody.status,
        credential_version:version,credential_available:false,
      },replayed:true};
      const current=await client.query<{
        credentialVersion:number;credentialCiphertext:EncryptedIntegrationValue;
      }>(`SELECT credential_version AS "credentialVersion",
          current_credential_ciphertext AS "credentialCiphertext"
        FROM public.integration_webhook_subscriptions
        WHERE id=$1 AND connection_id=$2 AND company_id=$3
          AND status='ACTIVE'`,[
        input.resourceId,input.principal.connectionId,input.principal.companyId,
      ]);
      const row=current.rows[0];
      return {data:{id:replay.responseBody.id,status:replay.responseBody.status,
        credential_version:version,
        credential_available:Boolean(row&&row.credentialVersion===version),
        ...(row&&row.credentialVersion===version?{
          signing_secret:decryptIntegrationValue(
            `webhook-credential:${input.resourceId}`,row.credentialCiphertext,
          ),
        }:{}),
      },replayed:true};
    }
    let response:Record<string,unknown>;
    let resourceType:"webhook_subscription"|"webhook_delivery";
    if(input.kind==="revoke"){
      const changed=await revokeSubscription(client,{
        id:input.resourceId,connectionId:input.principal.connectionId,
        companyId:input.principal.companyId,actorId:input.principal.actor.id,
      });
      if(!changed)throw new ExternalApiProblem(
        "not_found",404,"NOT_FOUND",undefined,"webhook_subscription",input.resourceId,
      );
      response={id:input.resourceId,status:"revoked"};resourceType="webhook_subscription";
    }else if(input.kind==="rotate"){
      const credential=opaqueIntegrationSecret("axora_whsec_");
      const rotated=await rotateSubscription(client,{
        id:input.resourceId,connectionId:input.principal.connectionId,
        companyId:input.principal.companyId,actor:input.principal.actor,credential,
      });
      if(!rotated)throw new ExternalApiProblem(
        "not_found",404,"NOT_FOUND",undefined,"webhook_subscription",input.resourceId,
      );
      response={id:input.resourceId,status:"active",
        signing_version:rotated.credentialVersion,
        credential_delivery:rotated.credentialDelivery.toLowerCase()};
      resourceType="webhook_subscription";
      await completeIdempotency(client,replay.id,response,resourceType,input.resourceId);
      await recordMutationAudit(client,{
        principal:input.principal,requestId:input.requestId,networkHash:input.networkHash,
        route:`/api/v1/webhook-subscriptions/${input.resourceId}/rotate-secret`,
        action:"WEBHOOK_SECRET_ROTATE",resourceType,resourceId:input.resourceId,status:200,
      });
      const revealCredential=rotated.credentialDelivery==="ONE_TIME";
      return {data:{id:input.resourceId,status:"active",
        credential_version:rotated.credentialVersion,
        credential_available:revealCredential,
        ...(revealCredential?{signing_secret:credential}:{})},replayed:false};
    }else{
      const retried=await retryDelivery(client,{
        id:input.resourceId,connectionId:input.principal.connectionId,
        companyId:input.principal.companyId,
      });
      if(!retried)throw new ExternalApiProblem(
        "not_found",404,"NOT_FOUND",undefined,"webhook_delivery",input.resourceId,
      );
      response={id:input.resourceId,event_id:retried.eventId,status:"retry"};
      resourceType="webhook_delivery";
    }
    await completeIdempotency(client,replay.id,response,resourceType,input.resourceId);
    await recordMutationAudit(client,{
      principal:input.principal,requestId:input.requestId,networkHash:input.networkHash,
      route:input.kind==="retry"
        ?`/api/v1/webhook-deliveries/${input.resourceId}/retry`
        :`/api/v1/webhook-subscriptions/${input.resourceId}`,
      action:input.kind==="retry"?"WEBHOOK_DELIVERY_RETRY":"WEBHOOK_SUBSCRIPTION_REVOKE",
      resourceType,resourceId:input.resourceId,status:200,
    });
    return {data:response,replayed:false};
  });
}

async function revokeSubscription(client:PoolClient,input:{
  id:string;connectionId?:string;companyId:string;actorId:string;
}){
  const values:unknown[]=[input.id,input.companyId,input.actorId];
  let connectionPredicate="";
  if(input.connectionId){values.push(input.connectionId);connectionPredicate="AND connection_id=$4";}
  const result=await client.query<{id:string}>(`
    UPDATE public.integration_webhook_subscriptions
    SET status='REVOKED',revoked_at=now(),revoked_by=$3,
      revoke_reason='Webhook subscription revoked',paused_at=NULL,pause_reason=NULL,
      updated_at=now()
    WHERE id=$1 AND company_id=$2 AND status<>'REVOKED' ${connectionPredicate}
    RETURNING id::text
  `,values);
  if(!result.rows[0])return false;
  await client.query(`
    UPDATE public.integration_webhook_deliveries
    SET status='FAILED',completed_at=now(),error_category='SUBSCRIPTION_INACTIVE',
      response_status=NULL,
      leased_by=NULL,lease_token=NULL,lease_credential_version=NULL,
      lease_expires_at=NULL,updated_at=now()
    WHERE subscription_id=$1 AND status IN ('PENDING','RETRY','DELIVERING')
  `,[input.id]);
  return true;
}

async function rotateSubscription(client:PoolClient,input:{
  id:string;connectionId?:string;companyId:string;actor:AuthenticatedSessionUser;
  credential:string;
}){
  const ciphertext=encryptIntegrationValue(
    `webhook-credential:${input.id}`,input.credential,
  );
  const values:unknown[]=[input.id,input.companyId,JSON.stringify(ciphertext),
    input.actor.id,input.actor.roleAssignmentId,input.actor.authVersion];
  let connectionPredicate="";
  if(input.connectionId){values.push(input.connectionId);connectionPredicate="AND subscription.connection_id=$7";}
  const result=await client.query<{
    credentialVersion:number;credentialDelivery:"ONE_TIME"|"NONE";
  }>(`
    UPDATE public.integration_webhook_subscriptions subscription
    SET previous_credential_ciphertext=subscription.current_credential_ciphertext,
      previous_credential_valid_until=now()+interval '24 hours',
      current_credential_ciphertext=$3::jsonb,
      credential_version=subscription.credential_version+1,
      authorized_user_id=$4,authorized_role_assignment_id=$5,
      auth_version_at_authorization=$6,status='ACTIVE',paused_at=NULL,pause_reason=NULL,
      updated_at=now()
    FROM public.integration_connections connection
    WHERE subscription.id=$1 AND subscription.company_id=$2
      AND subscription.status<>'REVOKED' ${connectionPredicate}
      AND connection.id=subscription.connection_id AND connection.status='ACTIVE'
    RETURNING subscription.credential_version AS "credentialVersion",
      subscription.credential_delivery AS "credentialDelivery"
  `,values);
  return result.rows[0];
}

async function retryDelivery(client:PoolClient,input:{
  id:string;connectionId?:string;companyId:string;
}){
  const values:unknown[]=[input.id,input.companyId];
  let connectionPredicate="";
  if(input.connectionId){values.push(input.connectionId);connectionPredicate="AND subscription.connection_id=$3";}
  const result=await client.query<{eventId:string}>(`
    UPDATE public.integration_webhook_deliveries delivery
    SET status='RETRY',cycle_attempt_count=0,
      manual_retry_count=delivery.manual_retry_count+1,available_at=now(),
      completed_at=NULL,response_status=NULL,error_category=NULL,
      last_duration_ms=NULL,updated_at=now()
    FROM public.integration_webhook_subscriptions subscription
    WHERE delivery.id=$1 AND delivery.company_id=$2 AND delivery.status='DEAD'
      AND delivery.manual_retry_count<3
      AND subscription.id=delivery.subscription_id AND subscription.status='ACTIVE'
      ${connectionPredicate}
    RETURNING delivery.event_id::text AS "eventId"
  `,values);
  return result.rows[0];
}

export async function getWebhookWorkspace(
  actor:AuthenticatedSessionUser,
):Promise<WebhookWorkspace>{
  requireWebhookCapability();
  const companyId=actor.companyId;
  const owner=await canViewIntegrationOperations(actor);
  if(!owner&&(!companyId||!await canManageCompanyIntegrations(actor,companyId))){
    throw new WebhookManagementError("DENIED");
  }
  if(isDemoMode())return {subscriptions:[],deliveries:[],availableConnections:[],
    ...(owner?{operations:{eventCount24h:0,pendingDeliveries:0,retryDeliveries:0,
      deadDeliveries:0,succeeded24h:0}}:{}),
  };
  return withIntegrationTransaction({
    systemIdentity:"integration-management",reason:"Viewed webhook operations",actor,
  },async(client)=>{
    const values=owner?[]:[companyId];
    const where=owner?"":"WHERE subscription.company_id=$1";
    const subscriptions=await client.query<SubscriptionRow>(`
      ${subscriptionSelect()} ${where}
      ORDER BY subscription.created_at DESC,subscription.id DESC LIMIT 100
    `,values);
    const deliveryWhere=owner?"":"WHERE delivery.company_id=$1";
    const deliveries=await client.query<DeliveryRow>(`
      ${deliverySelect()} ${deliveryWhere}
      ORDER BY delivery.created_at DESC,delivery.id DESC LIMIT 50
    `,values);
    const available=await client.query<{
      id:string;applicationName:string;companyId:string;companyName:string;
    }>(`
      SELECT connection.id::text,application.name AS "applicationName",
        connection.company_id::text AS "companyId",company.name AS "companyName"
      FROM public.integration_connections connection
      JOIN public.integration_applications application
        ON application.id=connection.application_id AND application.status='ACTIVE'
        AND 'webhooks:manage'=ANY(application.allowed_scopes)
      JOIN public.companies company ON company.id=connection.company_id
      WHERE connection.status='ACTIVE' ${owner?"":"AND connection.company_id=$1"}
      ORDER BY application.name,company.name,connection.id
    `,values);
    let operations:WebhookWorkspace["operations"];
    if(owner){
      const metrics=await client.query<QueryResultRow&NonNullable<WebhookWorkspace["operations"]>>(`
        SELECT
          (SELECT count(*)::int FROM public.integration_events
            WHERE recorded_at>=now()-interval '24 hours') AS "eventCount24h",
          (SELECT count(*)::int FROM public.integration_webhook_deliveries
            WHERE status='PENDING') AS "pendingDeliveries",
          (SELECT count(*)::int FROM public.integration_webhook_deliveries
            WHERE status='RETRY') AS "retryDeliveries",
          (SELECT count(*)::int FROM public.integration_webhook_deliveries
            WHERE status='DEAD') AS "deadDeliveries",
          (SELECT count(*)::int FROM public.integration_webhook_deliveries
            WHERE status='SUCCEEDED' AND completed_at>=now()-interval '24 hours')
            AS "succeeded24h"
      `);
      operations=metrics.rows[0];
    }
    return {subscriptions:subscriptions.rows,deliveries:deliveries.rows,
      availableConnections:available.rows,...(operations?{operations}:{}),
    };
  });
}

export async function createManagedWebhookSubscription(input:{
  actor:AuthenticatedSessionUser;connectionId:string;payload:WebhookSubscriptionInput;
  resolver?:WebhookResolver;
}){
  requireWebhookCapability();
  if(!input.actor.companyId
    ||!await canManageCompanyIntegrations(input.actor,input.actor.companyId)
    ||!z.uuid().safeParse(input.connectionId).success){
    throw new WebhookManagementError("DENIED");
  }
  let prepared;
  try{
    const payload=parseWebhookSubscriptionInput(input.payload);
    prepared=await prepareDestination(payload,input.resolver);
  }
  catch{throw new WebhookManagementError("INVALID");}
  return withIntegrationTransaction({
    systemIdentity:"integration-management",reason:"Created webhook subscription",
    actor:input.actor,
  },async(client)=>{
    const connection=await validateConnection(client,{
      connectionId:input.connectionId,companyId:input.actor.companyId!,
    });
    if(!connection)throw new WebhookManagementError("NOT_FOUND");
    try{await requireSubscriptionCapacity(client,input.connectionId);}
    catch(error){
      if(error instanceof ExternalApiProblem)throw new WebhookManagementError("CONFLICT");
      throw error;
    }
    const id=randomUUID();const credential=opaqueIntegrationSecret("axora_whsec_");
    try{
      const created=await insertSubscription(client,{
        id,applicationId:connection.applicationId,connectionId:input.connectionId,
        companyId:input.actor.companyId!,actor:input.actor,
        normalizedUrl:prepared.normalizedUrl,endpointOrigin:prepared.endpointOrigin,
        eventTypes:prepared.eventTypes,credential,
        credentialDelivery:prepared.credentialDelivery,
      });
      return {id,createdAt:created.createdAt,
        ...(prepared.credentialDelivery==="one_time"?{credential}:{}),
      };
    }catch(error){
      if(error instanceof ExternalApiProblem&&error.code==="conflict"){
        throw new WebhookManagementError("CONFLICT");
      }
      throw error;
    }
  });
}

async function requireManagedCompany(
  actor:AuthenticatedSessionUser,
  companyId:string,
  ownerCapability:"NONE"|"REVOKE"|"OPERATIONS",
){
  const companyManager=await canManageCompanyIntegrations(actor,companyId);
  const ownerAllowed=ownerCapability==="REVOKE"
    ? await canManageIntegrationApplications(actor)
    : ownerCapability==="OPERATIONS"
      ? await canViewIntegrationOperations(actor)
      : false;
  if(!companyManager&&!ownerAllowed){
    throw new WebhookManagementError("DENIED");
  }
}

export async function revokeManagedWebhookSubscription(
  actor:AuthenticatedSessionUser,id:string,companyId:string,
){
  requireWebhookCapability();
  await requireManagedCompany(actor,companyId,"REVOKE");
  if(!z.uuid().safeParse(id).success||!z.uuid().safeParse(companyId).success){
    throw new WebhookManagementError("NOT_FOUND");
  }
  const changed=await withIntegrationTransaction({
    systemIdentity:"integration-management",reason:"Revoked webhook subscription",actor,
  },(client)=>revokeSubscription(client,{id,companyId,actorId:actor.id}));
  if(!changed)throw new WebhookManagementError("NOT_FOUND");
}

export async function rotateManagedWebhookCredential(
  actor:AuthenticatedSessionUser,id:string,companyId:string,
){
  requireWebhookCapability();
  await requireManagedCompany(actor,companyId,"NONE");
  if(!z.uuid().safeParse(id).success||!z.uuid().safeParse(companyId).success){
    throw new WebhookManagementError("NOT_FOUND");
  }
  const credential=opaqueIntegrationSecret("axora_whsec_");
  const result=await withIntegrationTransaction({
    systemIdentity:"integration-management",reason:"Rotated webhook credential",actor,
  },(client)=>rotateSubscription(client,{id,companyId,actor,credential}));
  if(!result)throw new WebhookManagementError("NOT_FOUND");
  return {credentialVersion:result.credentialVersion,
    ...(result.credentialDelivery==="ONE_TIME"?{credential}:{}),
  };
}

export async function retryManagedWebhookDelivery(
  actor:AuthenticatedSessionUser,id:string,companyId:string,
){
  requireWebhookCapability();
  await requireManagedCompany(actor,companyId,"OPERATIONS");
  if(!z.uuid().safeParse(id).success||!z.uuid().safeParse(companyId).success){
    throw new WebhookManagementError("NOT_FOUND");
  }
  const result=await withIntegrationTransaction({
    systemIdentity:"integration-management",reason:"Retried dead webhook delivery",actor,
  },(client)=>retryDelivery(client,{id,companyId}));
  if(!result)throw new WebhookManagementError("NOT_FOUND");
  return result;
}
