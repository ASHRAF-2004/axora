import type { PoolClient, QueryResultRow } from "pg";
import { z } from "zod";
import type { AuthenticatedSessionUser } from "../auth";
import { isDemoMode } from "../db";
import {
  canManageCompanyIntegrations,
  canManageIntegrationApplications,
  canViewIntegrationOperations,
} from "./authorization";
import { hashIntegrationSecret, opaqueIntegrationSecret } from "./crypto";
import { withIntegrationTransaction } from "./database";
import { oauthInternals } from "./oauth";
import { integrationScopeSchema, type IntegrationScope } from "./scopes";

export class IntegrationManagementError extends Error {
  constructor(public readonly reason: "DENIED" | "INVALID" | "NOT_FOUND" | "UNAVAILABLE") {
    super("Integration management is unavailable.");
    this.name = "IntegrationManagementError";
  }
}

export interface IntegrationApplicationSummary {
  id: string;
  clientId: string;
  slug: string;
  name: string;
  description: string;
  status: "ACTIVE" | "INACTIVE";
  clientType: "CONFIDENTIAL" | "PUBLIC";
  tokenEndpointAuthMethod: string;
  redirectUris: string[];
  allowedScopes: IntegrationScope[];
  createdAt: string;
  updatedAt: string;
  activeConnectionCount: number;
}

export interface IntegrationConnectionSummary {
  id: string;
  applicationId: string;
  applicationName: string;
  companyId: string;
  companyName: string;
  status: "ACTIVE" | "REVOKED";
  connectedBy?: string;
  connectedAt: string;
  revokedAt?: string;
  scopes: IntegrationScope[];
}

export interface IntegrationOperationsSummary {
  activeApplications: number;
  activeConnections: number;
  activeGrants: number;
  activeAccessTokens: number;
  apiRequests24h: number;
  apiErrors24h: number;
}

export interface IntegrationWorkspace {
  mode: "OWNER" | "COMPANY";
  applications: IntegrationApplicationSummary[];
  connections: IntegrationConnectionSummary[];
  operations?: IntegrationOperationsSummary;
}

interface ApplicationSummaryRow extends QueryResultRow, IntegrationApplicationSummary {}
interface ConnectionSummaryRow extends QueryResultRow, IntegrationConnectionSummary {}
interface IntegrationOperationsRow extends QueryResultRow, IntegrationOperationsSummary {}

export async function getIntegrationWorkspace(
  actor: AuthenticatedSessionUser,
): Promise<IntegrationWorkspace> {
  const owner = await canManageIntegrationApplications(actor);
  const companyManager = Boolean(actor.companyId)
    && await canManageCompanyIntegrations(actor, actor.companyId!);
  if (!owner && !companyManager) throw new IntegrationManagementError("DENIED");
  const operationsAllowed = owner && await canViewIntegrationOperations(actor);
  if (isDemoMode()) return {
    mode: owner ? "OWNER" : "COMPANY",
    applications: [],
    connections: [],
    ...(operationsAllowed ? { operations: {
      activeApplications: 0,
      activeConnections: 0,
      activeGrants: 0,
      activeAccessTokens: 0,
      apiRequests24h: 0,
      apiErrors24h: 0,
    } } : {}),
  };
  return withIntegrationTransaction({
    systemIdentity: "integration-management",
    reason: "Viewed integration management workspace",
    actor,
  }, async (client) => {
    const applications = await client.query<ApplicationSummaryRow>(`
      SELECT application.id::text,application.client_id AS "clientId",
        application.slug,application.name,application.description,
        application.status,application.client_type AS "clientType",
        application.token_endpoint_auth_method AS "tokenEndpointAuthMethod",
        application.redirect_uris AS "redirectUris",
        application.allowed_scopes AS "allowedScopes",
        application.created_at::text AS "createdAt",
        application.updated_at::text AS "updatedAt",
        count(connection.id) FILTER (WHERE connection.status='ACTIVE')::int
          AS "activeConnectionCount"
      FROM public.integration_applications application
      LEFT JOIN public.integration_connections connection
        ON connection.application_id=application.id
      ${owner ? "" : "WHERE application.status='ACTIVE'"}
      GROUP BY application.id
      ORDER BY application.name,application.id
    `);
    const values: unknown[] = [];
    const companyWhere = owner ? "" : "WHERE connection.company_id=$1";
    if (!owner) values.push(actor.companyId);
    const connections = await client.query<ConnectionSummaryRow>(`
      SELECT connection.id::text,
        connection.application_id::text AS "applicationId",
        application.name AS "applicationName",
        connection.company_id::text AS "companyId",company.name AS "companyName",
        connection.status,COALESCE(profile.display_name,account.display_name)
          AS "connectedBy",connection.connected_at::text AS "connectedAt",
        connection.revoked_at::text AS "revokedAt",
        COALESCE(grant_record.scopes,'{}'::text[]) AS scopes
      FROM public.integration_connections connection
      JOIN public.integration_applications application
        ON application.id=connection.application_id
      JOIN public.companies company ON company.id=connection.company_id
      LEFT JOIN public.users account ON account.id=connection.connected_by
      LEFT JOIN public.user_profiles profile ON profile.user_id=account.id
      LEFT JOIN LATERAL (
        SELECT grant_candidate.scopes
        FROM public.integration_oauth_grants grant_candidate
        WHERE grant_candidate.connection_id=connection.id
        ORDER BY (grant_candidate.status='ACTIVE') DESC,
          grant_candidate.granted_at DESC,grant_candidate.id DESC LIMIT 1
      ) grant_record ON true
      ${companyWhere}
      ORDER BY connection.connected_at DESC,connection.id DESC
    `, values);
    let operations: IntegrationOperationsSummary | undefined;
    if (operationsAllowed) {
      const health = await client.query<IntegrationOperationsRow>(`
        SELECT
          (SELECT count(*)::int FROM public.integration_applications
            WHERE status='ACTIVE') AS "activeApplications",
          (SELECT count(*)::int FROM public.integration_connections
            WHERE status='ACTIVE') AS "activeConnections",
          (SELECT count(*)::int FROM public.integration_oauth_grants
            WHERE status='ACTIVE' AND expires_at>now()) AS "activeGrants",
          (SELECT count(*)::int FROM public.integration_oauth_access_tokens
            WHERE revoked_at IS NULL AND expires_at>now()) AS "activeAccessTokens",
          (SELECT count(*)::int FROM public.integration_api_audit
            WHERE occurred_at>=now()-interval '24 hours') AS "apiRequests24h",
          (SELECT count(*)::int FROM public.integration_api_audit
            WHERE occurred_at>=now()-interval '24 hours'
              AND result IN ('ERROR','DENIED','INVALID','RATE_LIMITED'))
            AS "apiErrors24h"
      `);
      operations = health.rows[0];
    }
    return {
      mode: owner ? "OWNER" : "COMPANY",
      applications: applications.rows,
      connections: connections.rows,
      ...(operations ? { operations } : {}),
    };
  });
}

const applicationInputSchema = z.object({
  name: z.string().trim().min(2).max(120),
  slug: z.string().trim().regex(/^[a-z][a-z0-9-]{1,62}[a-z0-9]$/),
  description: z.string().trim().max(1000),
  clientType: z.enum(["CONFIDENTIAL","PUBLIC"]),
  tokenEndpointAuthMethod: z.enum(["client_secret_basic","client_secret_post","none"]),
  redirectUris: z.array(z.string().trim().min(8).max(2048)).min(1).max(20),
  allowedScopes: z.array(integrationScopeSchema).min(1).max(6),
}).strict().superRefine((value, context) => {
  if ((value.clientType === "PUBLIC") !== (value.tokenEndpointAuthMethod === "none")) {
    context.addIssue({ code: "custom", message: "Client authentication does not match the client type." });
  }
});

export type CreateIntegrationApplicationInput = z.input<typeof applicationInputSchema>;

export async function createIntegrationApplication(
  actor: AuthenticatedSessionUser,
  raw: CreateIntegrationApplicationInput,
) {
  if (!await canManageIntegrationApplications(actor)) {
    throw new IntegrationManagementError("DENIED");
  }
  const parsed = applicationInputSchema.safeParse(raw);
  if (!parsed.success) throw new IntegrationManagementError("INVALID");
  const redirectUris = [...new Set(parsed.data.redirectUris)];
  const allowedScopes = [...new Set(parsed.data.allowedScopes)]
    .sort((left,right) => left.localeCompare(right));
  if (redirectUris.length !== parsed.data.redirectUris.length
    || allowedScopes.length !== parsed.data.allowedScopes.length
    || redirectUris.some((uri) => !oauthInternals.exactHttpsRedirect(uri))) {
    throw new IntegrationManagementError("INVALID");
  }
  const clientId = opaqueIntegrationSecret("axora_client_",24);
  const clientSecret = parsed.data.clientType === "CONFIDENTIAL"
    ? opaqueIntegrationSecret("axora_cs_") : undefined;
  const id = await withIntegrationTransaction({
    systemIdentity: "integration-management",
    reason: "Registered integration application",
    actor,
  }, async (client) => {
    try {
      const result = await client.query<{ id: string }>(`
        INSERT INTO public.integration_applications(
          client_id,client_secret_hash,client_type,token_endpoint_auth_method,
          slug,name,description,redirect_uris,allowed_scopes,created_by,
          secret_rotated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
        RETURNING id::text
      `, [
        clientId,
        clientSecret ? hashIntegrationSecret("client-secret",clientSecret) : null,
        parsed.data.clientType,parsed.data.tokenEndpointAuthMethod,
        parsed.data.slug,parsed.data.name,parsed.data.description,
        redirectUris,allowedScopes,actor.id,clientSecret ? new Date() : null,
      ]);
      return result.rows[0]!.id;
    } catch {
      throw new IntegrationManagementError("INVALID");
    }
  });
  return { id,clientId,clientSecret };
}

export async function rotateIntegrationClientSecret(
  actor: AuthenticatedSessionUser,
  applicationId: string,
) {
  if (!await canManageIntegrationApplications(actor)
    || !z.uuid().safeParse(applicationId).success) {
    throw new IntegrationManagementError("DENIED");
  }
  const clientSecret = opaqueIntegrationSecret("axora_cs_");
  const rotated = await withIntegrationTransaction({
    systemIdentity: "integration-management",
    reason: "Rotated integration application client secret",
    actor,
  }, async (client) => {
    const app = await client.query<{ id: string }>(`
      UPDATE public.integration_applications
      SET client_secret_hash=$2,secret_rotated_at=now(),updated_at=now()
      WHERE id=$1 AND client_type='CONFIDENTIAL' AND status='ACTIVE'
      RETURNING id::text
    `, [applicationId,hashIntegrationSecret("client-secret",clientSecret)]);
    if (!app.rows[0]) return false;
    const grants = await client.query<{ id: string }>(`
      UPDATE public.integration_oauth_grants
      SET status='REVOKED',revoked_at=COALESCE(revoked_at,now()),revoked_by=$2,
        revoke_reason=COALESCE(revoke_reason,'Application client secret rotated'),
        updated_at=now()
      WHERE application_id=$1 AND status='ACTIVE' RETURNING id::text
    `, [applicationId,actor.id]);
    const grantIds = grants.rows.map((grant) => grant.id);
    if (grantIds.length) {
      await client.query(`UPDATE public.integration_oauth_access_tokens
        SET revoked_at=COALESCE(revoked_at,now()) WHERE grant_id=ANY($1::uuid[])`,[grantIds]);
      await client.query(`UPDATE public.integration_oauth_refresh_families
        SET status='REVOKED',revoked_at=COALESCE(revoked_at,now()),
          revoke_reason=COALESCE(revoke_reason,'Application client secret rotated')
        WHERE grant_id=ANY($1::uuid[]) AND status='ACTIVE'`,[grantIds]);
      await client.query(`UPDATE public.integration_oauth_refresh_tokens
        SET revoked_at=COALESCE(revoked_at,now()) WHERE grant_id=ANY($1::uuid[])`,[grantIds]);
    }
    return true;
  });
  if (!rotated) throw new IntegrationManagementError("NOT_FOUND");
  return { clientSecret };
}

export async function setIntegrationApplicationActive(
  actor: AuthenticatedSessionUser,
  applicationId: string,
  active: boolean,
) {
  if (!await canManageIntegrationApplications(actor)
    || !z.uuid().safeParse(applicationId).success) {
    throw new IntegrationManagementError("DENIED");
  }
  const changed = await withIntegrationTransaction({
    systemIdentity: "integration-management",
    reason: active ? "Activated integration application" : "Deactivated integration application",
    actor,
  }, async (client) => {
    const app = await client.query<{ id: string }>(`
      UPDATE public.integration_applications SET status=$2,updated_at=now()
      WHERE id=$1 AND status<>$2 RETURNING id::text
    `, [applicationId,active ? "ACTIVE" : "INACTIVE"]);
    if (!app.rows[0]) return false;
    if (!active) await revokeApplicationAccess(client,applicationId,actor.id,"Application deactivated");
    return true;
  });
  if (!changed) throw new IntegrationManagementError("NOT_FOUND");
}

async function revokeApplicationAccess(
  client: PoolClient,
  applicationId: string,
  actorId: string,
  reason: string,
) {
  await client.query(`
    UPDATE public.integration_connections
    SET status='REVOKED',revoked_at=COALESCE(revoked_at,now()),revoked_by=$2,
      revoke_reason=COALESCE(revoke_reason,$3),updated_at=now()
    WHERE application_id=$1 AND status='ACTIVE'
  `,[applicationId,actorId,reason]);
  const grants = await client.query<{ id: string }>(`
    UPDATE public.integration_oauth_grants
    SET status='REVOKED',revoked_at=COALESCE(revoked_at,now()),revoked_by=$2,
      revoke_reason=COALESCE(revoke_reason,$3),updated_at=now()
    WHERE application_id=$1 AND status='ACTIVE' RETURNING id::text
  `,[applicationId,actorId,reason]);
  const ids = grants.rows.map((grant) => grant.id);
  if (!ids.length) return;
  await client.query(`UPDATE public.integration_oauth_access_tokens
    SET revoked_at=COALESCE(revoked_at,now()) WHERE grant_id=ANY($1::uuid[])`,[ids]);
  await client.query(`UPDATE public.integration_oauth_refresh_families
    SET status='REVOKED',revoked_at=COALESCE(revoked_at,now()),
      revoke_reason=COALESCE(revoke_reason,$2)
    WHERE grant_id=ANY($1::uuid[]) AND status='ACTIVE'`,[ids,reason]);
  await client.query(`UPDATE public.integration_oauth_refresh_tokens
    SET revoked_at=COALESCE(revoked_at,now()) WHERE grant_id=ANY($1::uuid[])`,[ids]);
}

export async function disconnectIntegration(
  actor: AuthenticatedSessionUser,
  connectionId: string,
) {
  if (!z.uuid().safeParse(connectionId).success) {
    throw new IntegrationManagementError("INVALID");
  }
  const owner = await canManageIntegrationApplications(actor);
  const companyManager = Boolean(actor.companyId)
    && await canManageCompanyIntegrations(actor,actor.companyId!);
  if (!owner && !companyManager) throw new IntegrationManagementError("DENIED");
  const disconnected = await withIntegrationTransaction({
    systemIdentity: "integration-management",reason: "Disconnected company integration",
    actor,
  }, async (client) => {
    const connection = await client.query<{ id: string; companyId: string }>(`
      SELECT id::text,company_id::text AS "companyId"
      FROM public.integration_connections
      WHERE id=$1 AND status='ACTIVE' ${owner ? "" : "AND company_id=$2"}
      FOR UPDATE
    `, owner ? [connectionId] : [connectionId,actor.companyId]);
    if (!connection.rows[0]) return false;
    await client.query(`
      UPDATE public.integration_connections
      SET status='REVOKED',revoked_at=now(),revoked_by=$2,
        revoke_reason='Disconnected by an authorized Axora administrator',updated_at=now()
      WHERE id=$1
    `,[connectionId,actor.id]);
    const grants = await client.query<{ id: string }>(`
      UPDATE public.integration_oauth_grants
      SET status='REVOKED',revoked_at=COALESCE(revoked_at,now()),revoked_by=$2,
        revoke_reason=COALESCE(revoke_reason,'Company integration disconnected'),
        updated_at=now()
      WHERE connection_id=$1 AND status='ACTIVE' RETURNING id::text
    `,[connectionId,actor.id]);
    const ids = grants.rows.map((grant) => grant.id);
    if (ids.length) {
      await client.query(`UPDATE public.integration_oauth_access_tokens
        SET revoked_at=COALESCE(revoked_at,now()) WHERE grant_id=ANY($1::uuid[])`,[ids]);
      await client.query(`UPDATE public.integration_oauth_refresh_families
        SET status='REVOKED',revoked_at=COALESCE(revoked_at,now()),
          revoke_reason=COALESCE(revoke_reason,'Company integration disconnected')
        WHERE grant_id=ANY($1::uuid[]) AND status='ACTIVE'`,[ids]);
      await client.query(`UPDATE public.integration_oauth_refresh_tokens
        SET revoked_at=COALESCE(revoked_at,now()) WHERE grant_id=ANY($1::uuid[])`,[ids]);
    }
    return true;
  });
  if (!disconnected) throw new IntegrationManagementError("NOT_FOUND");
}
