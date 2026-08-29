import type { PoolClient, QueryResultRow } from "pg";
import { z } from "zod";
import type { AuthenticatedSessionUser } from "../auth";
import { isDemoMode } from "../db";
import {
  canManageCompanyIntegrations,
  canManageIntegrationApplications,
} from "./authorization";
import {
  INTEGRATION_PROVIDER_APPLICATION_SLUGS,
  slackIntegrationEnabled,
  slackProviderConfiguration,
  slackProviderConfigured,
} from "./config";
import {
  decryptIntegrationValue,
  encryptIntegrationValue,
  hashIntegrationSecret,
  opaqueIntegrationSecret,
  type EncryptedIntegrationValue,
} from "./crypto";
import { withIntegrationTransaction } from "./database";
import { consumeIntegrationRateLimit } from "./rate-limit";
import {
  exchangeSlackAuthorizationCode,
  listSlackPublicChannels,
  refreshSlackBotToken,
  revokeSlackToken,
  slackAuthorizationUrl,
  SLACK_NOTIFICATION_EVENTS,
  type SlackNotificationEvent,
  SlackProviderError,
} from "./slack-provider";

export const SLACK_APPLICATION_ID = "8a0b0000-0000-4000-8000-000000000004";

const uuidSchema=z.uuid();
const stateSchema=z.string().regex(/^[A-Za-z0-9_-]{43,128}$/);
const callbackCodeSchema=z.string().regex(/^[A-Za-z0-9_-]{10,512}$/);
const eventTypeSchema=z.enum(SLACK_NOTIFICATION_EVENTS);

export class SlackIntegrationError extends Error {
  constructor(public readonly reason:
    | "DENIED" | "INVALID" | "NOT_FOUND" | "UNAVAILABLE"
    | "CONFLICT" | "PROVIDER") {
    super("Slack integration is unavailable.");
    this.name="SlackIntegrationError";
  }
}

function accessPurpose(installationId:string,tokenVersion:number) {
  return `slack-access-token:${installationId}:v${tokenVersion}`;
}

function refreshPurpose(installationId:string,tokenVersion:number) {
  return `slack-refresh-token:${installationId}:v${tokenVersion}`;
}

async function requireCompanyManager(
  actor:AuthenticatedSessionUser,
  companyId:string,
) {
  if (!await canManageCompanyIntegrations(actor,companyId)) {
    throw new SlackIntegrationError("DENIED");
  }
}

function requireSlackCapability() {
  if (!slackIntegrationEnabled() || !slackProviderConfigured()) {
    throw new SlackIntegrationError("UNAVAILABLE");
  }
  return slackProviderConfiguration();
}

interface OAuthStateRow extends QueryResultRow {
  id:string;
  companyId:string;
  userId:string;
  roleAssignmentId:string;
  authVersionAtStart:number;
  expiresAt:string;
  status:"PENDING"|"CONSUMED"|"FAILED";
}

export async function beginSlackOAuth(input:{
  actor:AuthenticatedSessionUser;
  requestId:string;
}) {
  const configuration=requireSlackCapability();
  if (!input.actor.companyId || !input.actor.roleAssignmentId) {
    throw new SlackIntegrationError("DENIED");
  }
  await requireCompanyManager(input.actor,input.actor.companyId);
  const state=opaqueIntegrationSecret("axora_slack_");
  await withIntegrationTransaction({
    systemIdentity:"integration-oauth",reason:"Started Slack provider authorization",
    actor:input.actor,correlationId:input.requestId,
  },async(client)=>{
    const application=await client.query<{id:string}>(`
      SELECT id::text FROM public.integration_applications
      WHERE id=$1 AND slug=$2 AND authorization_mode='PROVIDER_OAUTH'
        AND status='ACTIVE'
    `,[SLACK_APPLICATION_ID,INTEGRATION_PROVIDER_APPLICATION_SLUGS.slack]);
    if(!application.rows[0])throw new SlackIntegrationError("UNAVAILABLE");
    const existing=await client.query(`
      SELECT 1 FROM public.integration_slack_installations
      WHERE company_id=$1 AND status<>'REVOKED' LIMIT 1
    `,[input.actor.companyId]);
    if(existing.rows[0])throw new SlackIntegrationError("CONFLICT");
    await client.query(`
      INSERT INTO public.integration_slack_oauth_states(
        state_hash,company_id,user_id,role_assignment_id,
        auth_version_at_start,expires_at
      ) VALUES ($1,$2,$3,$4,$5,now()+interval '10 minutes')
    `,[
      hashIntegrationSecret("slack-oauth-state",state),input.actor.companyId,
      input.actor.id,input.actor.roleAssignmentId,input.actor.authVersion,
    ]);
  });
  return slackAuthorizationUrl(configuration,state);
}

async function consumeSlackOAuthState(input:{
  actor:AuthenticatedSessionUser;
  state:string;
  requestId:string;
}) {
  if(!stateSchema.safeParse(input.state).success) {
    throw new SlackIntegrationError("INVALID");
  }
  return withIntegrationTransaction({
    systemIdentity:"integration-oauth",reason:"Consumed Slack OAuth state",
    actor:input.actor,correlationId:input.requestId,
  },async(client)=>{
    const result=await client.query<OAuthStateRow>(`
      SELECT id::text,company_id::text AS "companyId",user_id::text AS "userId",
        role_assignment_id::text AS "roleAssignmentId",
        auth_version_at_start::int AS "authVersionAtStart",
        expires_at::text AS "expiresAt",status
      FROM public.integration_slack_oauth_states
      WHERE state_hash=$1 FOR UPDATE
    `,[hashIntegrationSecret("slack-oauth-state",input.state)]);
    const state=result.rows[0];
    if(!state || state.status!=="PENDING"
      || new Date(state.expiresAt).getTime()<=Date.now()
      || state.userId!==input.actor.id
      || state.roleAssignmentId!==input.actor.roleAssignmentId
      || state.companyId!==input.actor.companyId
      || state.authVersionAtStart!==input.actor.authVersion) {
      throw new SlackIntegrationError("INVALID");
    }
    await requireCompanyManager(input.actor,state.companyId);
    await client.query(`
      UPDATE public.integration_slack_oauth_states
      SET status='CONSUMED',consumed_at=now() WHERE id=$1
    `,[state.id]);
    return state;
  });
}

async function markSlackOAuthStateFailed(
  stateId:string,
  actor:AuthenticatedSessionUser,
  category:"ACCESS_DENIED"|"PROVIDER_ERROR"|"SCOPE_MISMATCH"|"WORKSPACE_CONFLICT",
) {
  try {
    await withIntegrationTransaction({
      systemIdentity:"integration-oauth",reason:"Recorded failed Slack OAuth result",
      actor,outcome:"FAILURE",resultCode:category,
    },(client)=>client.query(`
      UPDATE public.integration_slack_oauth_states
      SET status='FAILED',failure_category=$2,consumed_at=COALESCE(consumed_at,now())
      WHERE id=$1 AND status='CONSUMED'
    `,[stateId,category]));
  } catch {}
}

export async function cancelSlackOAuth(input:{
  actor:AuthenticatedSessionUser;
  state:string;
  requestId:string;
}) {
  requireSlackCapability();
  const state=await consumeSlackOAuthState(input);
  await markSlackOAuthStateFailed(state.id,input.actor,"ACCESS_DENIED");
}

export async function completeSlackOAuth(input:{
  actor:AuthenticatedSessionUser;
  state:string;
  code:string;
  requestId:string;
  fetchImpl?:typeof fetch;
}) {
  const configuration=requireSlackCapability();
  if(!callbackCodeSchema.safeParse(input.code).success) {
    throw new SlackIntegrationError("INVALID");
  }
  const state=await consumeSlackOAuthState(input);
  let provider:Awaited<ReturnType<typeof exchangeSlackAuthorizationCode>>;
  try {
    provider=await exchangeSlackAuthorizationCode({
      configuration,code:input.code,fetchImpl:input.fetchImpl,
    });
  } catch(error) {
    await markSlackOAuthStateFailed(
      state.id,input.actor,
      error instanceof SlackProviderError && error.category==="SCOPE_MISMATCH"
        ? "SCOPE_MISMATCH":"PROVIDER_ERROR",
    );
    throw new SlackIntegrationError("PROVIDER");
  }
  const installationId=crypto.randomUUID();
  const tokenVersion=1;
  try {
    await requireCompanyManager(input.actor,state.companyId);
    await withIntegrationTransaction({
      systemIdentity:"integration-oauth",reason:"Installed native Slack connection",
      actor:input.actor,correlationId:input.requestId,
    },async(client)=>{
      const connection=await client.query<{id:string}>(`
        INSERT INTO public.integration_connections(
          application_id,company_id,status,connected_by
        ) VALUES ($1,$2,'ACTIVE',$3)
        RETURNING id::text
      `,[SLACK_APPLICATION_ID,state.companyId,input.actor.id]);
      await client.query(`
        INSERT INTO public.integration_slack_installations(
          id,application_id,connection_id,company_id,workspace_id,
          workspace_name,enterprise_id,bot_user_id,granted_scopes,
          access_token_ciphertext,refresh_token_ciphertext,
          access_token_expires_at,token_version,installed_by,
          authorized_role_assignment_id,auth_version_at_install
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,
          now()+make_interval(secs=>$12),$13,$14,$15,$16
        )
      `,[
        installationId,SLACK_APPLICATION_ID,connection.rows[0]!.id,state.companyId,
        provider.workspaceId,provider.workspaceName,provider.enterpriseId??null,
        provider.botUserId,provider.scopes,
        JSON.stringify(encryptIntegrationValue(
          accessPurpose(installationId,tokenVersion),provider.accessToken,
        )),
        JSON.stringify(encryptIntegrationValue(
          refreshPurpose(installationId,tokenVersion),provider.refreshToken,
        )),
        provider.expiresIn,tokenVersion,input.actor.id,
        input.actor.roleAssignmentId,input.actor.authVersion,
      ]);
    });
  } catch {
    await markSlackOAuthStateFailed(state.id,input.actor,"WORKSPACE_CONFLICT");
    await Promise.allSettled([
      revokeSlackToken({token:provider.accessToken,fetchImpl:input.fetchImpl}),
      revokeSlackToken({token:provider.refreshToken,fetchImpl:input.fetchImpl}),
    ]);
    throw new SlackIntegrationError("CONFLICT");
  }
  return installationId;
}

interface SlackInstallationCredentialRow extends QueryResultRow {
  id:string;
  companyId:string;
  status:"ACTIVE"|"PAUSED"|"REVOKING"|"REVOKED";
  tokenVersion:number;
  accessTokenCiphertext:EncryptedIntegrationValue;
  refreshTokenCiphertext:EncryptedIntegrationValue;
  accessTokenExpiresAt:string;
}

async function freshSlackAccessToken(
  actor:AuthenticatedSessionUser,
  installationId:string,
  fetchImpl?:typeof fetch,
) {
  const configuration=requireSlackCapability();
  return withIntegrationTransaction({
    systemIdentity:"integration-management",reason:"Refreshed Slack provider credential",
    actor,
  },async(client)=>{
    const result=await client.query<SlackInstallationCredentialRow>(`
      SELECT id::text,company_id::text AS "companyId",status,
        token_version::int AS "tokenVersion",
        access_token_ciphertext AS "accessTokenCiphertext",
        refresh_token_ciphertext AS "refreshTokenCiphertext",
        access_token_expires_at::text AS "accessTokenExpiresAt"
      FROM public.integration_slack_installations
      WHERE id=$1 FOR UPDATE
    `,[installationId]);
    const installation=result.rows[0];
    if(!installation || installation.status!=="ACTIVE") {
      throw new SlackIntegrationError("NOT_FOUND");
    }
    await requireCompanyManager(actor,installation.companyId);
    const accessToken=decryptIntegrationValue(
      accessPurpose(installation.id,installation.tokenVersion),
      installation.accessTokenCiphertext,
    );
    if(new Date(installation.accessTokenExpiresAt).getTime()>Date.now()+5*60_000) {
      return accessToken;
    }
    const refreshToken=decryptIntegrationValue(
      refreshPurpose(installation.id,installation.tokenVersion),
      installation.refreshTokenCiphertext,
    );
    let rotated:Awaited<ReturnType<typeof refreshSlackBotToken>>;
    try {
      rotated=await refreshSlackBotToken({
        configuration,refreshToken,fetchImpl,
      });
    } catch(error) {
      if(error instanceof SlackProviderError
        && ["TOKEN_REVOKED","MISSING_SCOPE"].includes(error.category)) {
        await client.query(`
          UPDATE public.integration_connections
          SET status='REVOKED',revoked_at=now(),
            revoke_reason='Slack provider authorization revoked',updated_at=now()
          WHERE id=(SELECT connection_id FROM public.integration_slack_installations
            WHERE id=$1) AND status='ACTIVE'
        `,[installation.id]);
      }
      throw new SlackIntegrationError("PROVIDER");
    }
    const nextVersion=installation.tokenVersion+1;
    await client.query(`
      UPDATE public.integration_slack_installations
      SET token_version=$2,access_token_ciphertext=$3::jsonb,
        refresh_token_ciphertext=$4::jsonb,
        access_token_expires_at=now()+make_interval(secs=>$5),updated_at=now()
      WHERE id=$1 AND status='ACTIVE'
    `,[
      installation.id,nextVersion,
      JSON.stringify(encryptIntegrationValue(
        accessPurpose(installation.id,nextVersion),rotated.accessToken,
      )),
      JSON.stringify(encryptIntegrationValue(
        refreshPurpose(installation.id,nextVersion),rotated.refreshToken,
      )),rotated.expiresIn,
    ]);
    return rotated.accessToken;
  });
}

export interface SlackInstallationSummary {
  id:string;
  connectionId:string;
  companyId:string;
  companyName:string;
  workspaceId:string;
  workspaceName:string;
  status:"ACTIVE"|"PAUSED"|"REVOKING"|"REVOKED";
  channelId?:string;
  channelName?:string;
  enabledEventTypes:SlackNotificationEvent[];
  installedBy?:string;
  installedAt:string;
  lastChannelSyncAt?:string;
  revocationErrorCategory?:string;
}

export interface SlackChannelSummary {
  id:string;
  name:string;
  isMember:boolean;
  isArchived:boolean;
}

export interface SlackDeliverySummary {
  id:string;
  companyId:string;
  eventType:SlackNotificationEvent;
  status:"PENDING"|"DELIVERING"|"SUCCEEDED"|"RETRY"|"FAILED"|"DEAD";
  attemptCount:number;
  errorCategory?:string;
  lastAttemptAt?:string;
  createdAt:string;
}

export interface SlackWorkspace {
  mode:"OWNER"|"COMPANY";
  enabled:boolean;
  configured:boolean;
  installations:SlackInstallationSummary[];
  channels:SlackChannelSummary[];
  deliveries:SlackDeliverySummary[];
  operations?:{
    activeInstallations:number;
    pendingDeliveries:number;
    retryDeliveries:number;
    deadDeliveries:number;
    succeeded24h:number;
  };
}

export async function getSlackWorkspace(
  actor:AuthenticatedSessionUser,
):Promise<SlackWorkspace> {
  const owner=await canManageIntegrationApplications(actor);
  const companyManager=Boolean(actor.companyId)
    && await canManageCompanyIntegrations(actor,actor.companyId!);
  if(!owner&&!companyManager)throw new SlackIntegrationError("DENIED");
  const base={
    mode:(owner?"OWNER":"COMPANY") as "OWNER"|"COMPANY",
    enabled:slackIntegrationEnabled(),configured:slackProviderConfigured(),
  };
  if(isDemoMode())return {
    ...base,installations:[],channels:[],deliveries:[],
    ...(owner?{operations:{
      activeInstallations:0,pendingDeliveries:0,retryDeliveries:0,
      deadDeliveries:0,succeeded24h:0,
    }}:{}),
  };
  return withIntegrationTransaction({
    systemIdentity:"integration-management",reason:"Viewed Slack integration workspace",
    actor,
  },async(client)=>{
    const values=owner?[]:[actor.companyId];
    const filter=owner?"":"AND installation.company_id=$1";
    const installations=await client.query<SlackInstallationSummary>(`
      SELECT installation.id::text,
        installation.connection_id::text AS "connectionId",
        installation.company_id::text AS "companyId",company.name AS "companyName",
        installation.workspace_id AS "workspaceId",
        installation.workspace_name AS "workspaceName",installation.status,
        installation.selected_channel_id AS "channelId",
        installation.selected_channel_name AS "channelName",
        installation.enabled_event_types AS "enabledEventTypes",
        COALESCE(profile.display_name,account.display_name) AS "installedBy",
        installation.installed_at::text AS "installedAt",
        installation.last_channel_sync_at::text AS "lastChannelSyncAt",
        installation.revocation_error_category AS "revocationErrorCategory"
      FROM public.integration_slack_installations installation
      JOIN public.companies company ON company.id=installation.company_id
      LEFT JOIN public.users account ON account.id=installation.installed_by
      LEFT JOIN public.user_profiles profile ON profile.user_id=account.id
      WHERE true ${filter}
      ORDER BY installation.installed_at DESC,installation.id DESC
      LIMIT 100
    `,values);
    const active=installations.rows.find((item)=>item.status==="ACTIVE");
    const channels=active?await client.query<SlackChannelSummary>(`
      SELECT channel_id AS id,channel_name AS name,
        is_member AS "isMember",is_archived AS "isArchived"
      FROM public.integration_slack_channels
      WHERE installation_id=$1 AND company_id=$2
      ORDER BY channel_name,channel_id LIMIT 1000
    `,[active.id,active.companyId]):{rows:[] as SlackChannelSummary[]};
    const deliveries=await client.query<SlackDeliverySummary>(`
      SELECT delivery.id::text,delivery.company_id::text AS "companyId",
        event.event_type AS "eventType",delivery.status,
        delivery.attempt_count::int AS "attemptCount",
        delivery.error_category AS "errorCategory",
        delivery.last_attempt_at::text AS "lastAttemptAt",
        delivery.created_at::text AS "createdAt"
      FROM public.integration_slack_deliveries delivery
      JOIN public.integration_events event ON event.id=delivery.event_id
      WHERE true ${owner?"":"AND delivery.company_id=$1"}
      ORDER BY delivery.created_at DESC,delivery.id DESC LIMIT 50
    `,values);
    const operations=owner?await client.query<{
      activeInstallations:number;pendingDeliveries:number;
      retryDeliveries:number;deadDeliveries:number;succeeded24h:number;
    }>(`
      SELECT
        (SELECT count(*)::int FROM public.integration_slack_installations
          WHERE status='ACTIVE') AS "activeInstallations",
        count(*) FILTER (WHERE status IN ('PENDING','DELIVERING'))::int
          AS "pendingDeliveries",
        count(*) FILTER (WHERE status='RETRY')::int AS "retryDeliveries",
        count(*) FILTER (WHERE status='DEAD')::int AS "deadDeliveries",
        count(*) FILTER (WHERE status='SUCCEEDED'
          AND completed_at>=now()-interval '24 hours')::int AS "succeeded24h"
      FROM public.integration_slack_deliveries
    `):undefined;
    return {
      ...base,installations:installations.rows,
      channels:channels.rows,deliveries:deliveries.rows,
      ...(operations?{operations:operations.rows[0]}:{}),
    };
  });
}

export async function syncSlackChannels(input:{
  actor:AuthenticatedSessionUser;
  installationId:string;
  fetchImpl?:typeof fetch;
}) {
  if(!uuidSchema.safeParse(input.installationId).success) {
    throw new SlackIntegrationError("INVALID");
  }
  const rate=await consumeIntegrationRateLimit({
    routeClass:"SLACK_API",correlationId:crypto.randomUUID(),
    scopes:[
      {kind:"CONNECTION",identifier:input.installationId,limit:10},
      {kind:"TOKEN",identifier:input.actor.id,limit:30},
    ],
  });
  if(!rate.allowed)throw new SlackIntegrationError("UNAVAILABLE");
  const token=await freshSlackAccessToken(
    input.actor,input.installationId,input.fetchImpl,
  );
  let channels:Awaited<ReturnType<typeof listSlackPublicChannels>>;
  try {
    channels=await listSlackPublicChannels({token,fetchImpl:input.fetchImpl});
  } catch {
    throw new SlackIntegrationError("PROVIDER");
  }
  await withIntegrationTransaction({
    systemIdentity:"integration-management",reason:"Synchronized public Slack channels",
    actor:input.actor,
  },async(client)=>{
    const installation=await client.query<{companyId:string}>(`
      SELECT company_id::text AS "companyId"
      FROM public.integration_slack_installations
      WHERE id=$1 AND status='ACTIVE' FOR UPDATE
    `,[input.installationId]);
    if(!installation.rows[0])throw new SlackIntegrationError("NOT_FOUND");
    await requireCompanyManager(input.actor,installation.rows[0].companyId);
    await client.query(`DELETE FROM public.integration_slack_channels
      WHERE installation_id=$1`,[input.installationId]);
    for(const channel of channels) {
      await client.query(`
        INSERT INTO public.integration_slack_channels(
          installation_id,company_id,channel_id,channel_name,
          is_member,is_archived,synced_at
        ) VALUES ($1,$2,$3,$4,$5,$6,now())
      `,[
        input.installationId,installation.rows[0].companyId,channel.id,channel.name,
        channel.isMember,channel.isArchived,
      ]);
    }
    await client.query(`
      UPDATE public.integration_slack_installations installation
      SET last_channel_sync_at=now(),updated_at=now(),
        selected_channel_id=CASE WHEN EXISTS (
          SELECT 1 FROM public.integration_slack_channels channel
          WHERE channel.installation_id=installation.id
            AND channel.channel_id=installation.selected_channel_id
            AND channel.is_member AND NOT channel.is_archived
        ) THEN selected_channel_id ELSE NULL END,
        selected_channel_name=CASE WHEN EXISTS (
          SELECT 1 FROM public.integration_slack_channels channel
          WHERE channel.installation_id=installation.id
            AND channel.channel_id=installation.selected_channel_id
            AND channel.is_member AND NOT channel.is_archived
        ) THEN selected_channel_name ELSE NULL END
      WHERE id=$1
    `,[input.installationId]);
  });
  return channels.length;
}

export async function configureSlackNotifications(input:{
  actor:AuthenticatedSessionUser;
  installationId:string;
  channelId:string;
  eventTypes:readonly SlackNotificationEvent[];
}) {
  const parsed=z.object({
    installationId:uuidSchema,
    channelId:z.string().regex(/^C[A-Z0-9]{8,32}$/),
    eventTypes:z.array(eventTypeSchema).min(1).max(5),
  }).safeParse(input);
  if(!parsed.success || new Set(parsed.data.eventTypes).size!==parsed.data.eventTypes.length) {
    throw new SlackIntegrationError("INVALID");
  }
  await withIntegrationTransaction({
    systemIdentity:"integration-management",reason:"Configured Slack notifications",
    actor:input.actor,
  },async(client)=>{
    const installation=await client.query<{companyId:string}>(`
      SELECT company_id::text AS "companyId"
      FROM public.integration_slack_installations
      WHERE id=$1 AND status='ACTIVE' FOR UPDATE
    `,[parsed.data.installationId]);
    if(!installation.rows[0])throw new SlackIntegrationError("NOT_FOUND");
    await requireCompanyManager(input.actor,installation.rows[0].companyId);
    const channel=await client.query<{name:string}>(`
      SELECT channel_name AS name FROM public.integration_slack_channels
      WHERE installation_id=$1 AND company_id=$2 AND channel_id=$3
        AND is_member AND NOT is_archived
        AND synced_at>now()-interval '24 hours'
    `,[parsed.data.installationId,installation.rows[0].companyId,parsed.data.channelId]);
    if(!channel.rows[0])throw new SlackIntegrationError("INVALID");
    await client.query(`
      UPDATE public.integration_slack_installations
      SET selected_channel_id=$2,selected_channel_name=$3,
        enabled_event_types=$4,updated_at=now()
      WHERE id=$1
    `,[
      parsed.data.installationId,parsed.data.channelId,channel.rows[0].name,
      [...parsed.data.eventTypes].sort(),
    ]);
  });
}

export async function retrySlackDelivery(input:{
  actor:AuthenticatedSessionUser;
  deliveryId:string;
  companyId:string;
}) {
  if(!uuidSchema.safeParse(input.deliveryId).success
    || !uuidSchema.safeParse(input.companyId).success) {
    throw new SlackIntegrationError("INVALID");
  }
  await requireCompanyManager(input.actor,input.companyId);
  const retried=await withIntegrationTransaction({
    systemIdentity:"integration-management",reason:"Retried dead Slack delivery",
    actor:input.actor,
  },async(client)=>{
    const result=await client.query(`
      UPDATE public.integration_slack_deliveries delivery
      SET status='RETRY',cycle_attempt_count=0,available_at=now(),
        completed_at=NULL,response_status=NULL,error_category=NULL,
        manual_retry_count=manual_retry_count+1,last_manual_retry_at=now(),
        last_manual_retry_by=$3,updated_at=now()
      FROM public.integration_slack_installations installation
      WHERE delivery.id=$1 AND delivery.company_id=$2 AND delivery.status='DEAD'
        AND delivery.manual_retry_count<10
        AND installation.id=delivery.installation_id
        AND installation.status='ACTIVE'
        AND public.axora_slack_installation_is_authorized(installation.id,now())
      RETURNING delivery.id
    `,[input.deliveryId,input.companyId,input.actor.id]);
    return Boolean(result.rows[0]);
  });
  if(!retried)throw new SlackIntegrationError("NOT_FOUND");
}

const inboundEventSchema=z.object({
  type:z.literal("event_callback"),
  api_app_id:z.string().regex(/^A[A-Z0-9]{8,32}$/),
  team_id:z.string().regex(/^T[A-Z0-9]{8,32}$/),
  event_id:z.string().regex(/^Ev[A-Za-z0-9]{6,80}$/),
  event:z.discriminatedUnion("type",[
    z.object({type:z.literal("app_uninstalled")}).passthrough(),
    z.object({
      type:z.literal("tokens_revoked"),
      tokens:z.object({
        bot:z.array(z.string().regex(/^[UB][A-Z0-9]{8,32}$/)).max(100).optional(),
        oauth:z.array(z.string().regex(/^U[A-Z0-9]{8,32}$/)).max(100).optional(),
      }).strict(),
    }).passthrough(),
  ]),
}).passthrough();

export async function handleSlackInboundEvent(input:{
  payload:unknown;
  requestId:string;
}) {
  const configuration=requireSlackCapability();
  const parsed=inboundEventSchema.safeParse(input.payload);
  if(!parsed.success || parsed.data.api_app_id!==configuration.appId) {
    throw new SlackIntegrationError("INVALID");
  }
  return withIntegrationTransaction({
    systemIdentity:"integration-maintenance",reason:"Processed signed Slack revocation event",
    correlationId:input.requestId,
  },async(client:PoolClient)=>{
    const installation=await client.query<{
      id:string;companyId:string;connectionId:string;botUserId:string;
    }>(`
      SELECT id::text,company_id::text AS "companyId",
        connection_id::text AS "connectionId",bot_user_id AS "botUserId"
      FROM public.integration_slack_installations
      WHERE workspace_id=$1 AND status<>'REVOKED'
      ORDER BY installed_at DESC LIMIT 1 FOR UPDATE
    `,[parsed.data.team_id]);
    const row=installation.rows[0];
    const inserted=await client.query(`
      INSERT INTO public.integration_slack_inbound_events(
        event_id,workspace_id,event_type,company_id
      ) VALUES ($1,$2,$3,$4)
      ON CONFLICT(event_id) DO NOTHING RETURNING event_id
    `,[
      parsed.data.event_id,parsed.data.team_id,parsed.data.event.type,
      row?.companyId??null,
    ]);
    if(!inserted.rows[0]||!row)return {duplicate:!inserted.rows[0],revoked:false};
    if(parsed.data.event.type==="tokens_revoked"
      && !(parsed.data.event.tokens.bot??[]).includes(row.botUserId)) {
      return {duplicate:false,revoked:false};
    }
    await client.query(`
      UPDATE public.integration_connections
      SET status='REVOKED',revoked_at=COALESCE(revoked_at,now()),
        revoke_reason=COALESCE(revoke_reason,'Slack app uninstalled or token revoked'),
        updated_at=now()
      WHERE id=$1 AND status='ACTIVE'
    `,[row.connectionId]);
    await client.query(`
      UPDATE public.integration_slack_installations
      SET status='REVOKED',pause_reason=NULL,
        revocation_requested_at=COALESCE(revocation_requested_at,now()),
        revoked_at=COALESCE(revoked_at,now()),
        revoke_reason=COALESCE(revoke_reason,'Slack app uninstalled or token revoked'),
        access_token_ciphertext=NULL,refresh_token_ciphertext=NULL,
        access_token_expires_at=NULL,selected_channel_id=NULL,
        selected_channel_name=NULL,revocation_leased_by=NULL,
        revocation_lease_token=NULL,revocation_lease_expires_at=NULL,updated_at=now()
      WHERE id=$1
    `,[row.id]);
    return {duplicate:false,revoked:true};
  });
}

export const slackIntegrationInternals={
  accessPurpose,refreshPurpose,inboundEventSchema,
};
