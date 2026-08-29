import { createHash, timingSafeEqual } from "node:crypto";
import type { PoolClient, QueryResultRow } from "pg";
import { z } from "zod";
import type { AuthenticatedSessionUser } from "../auth";
import { canManageCompanyIntegrations } from "./authorization";
import {
  hashIntegrationSecret,
  integrationSecretHashMatches,
  opaqueIntegrationSecret,
} from "./crypto";
import { withIntegrationTransaction } from "./database";
import { integrationApplicationEnabled, integrationOrigin } from "./config";
import {
  parseIntegrationScopes,
  scopesAreSubset,
  type IntegrationScope,
} from "./scopes";

const clientIdSchema = z.string().regex(/^axora_client_[A-Za-z0-9_-]{24,96}$/);
const authorizationCodeSchema = z.string().regex(/^axora_ac_[A-Za-z0-9_-]{43}$/);
const authorizationHandleSchema = z.string().regex(/^axora_ar_[A-Za-z0-9_-]{43}$/);
const refreshTokenSchema = z.string().regex(/^axora_rt_[A-Za-z0-9_-]{43}$/);
const stateSchema = z.string().min(16).max(1024).refine((value) => !/[\u0000-\u001f\u007f]/.test(value));
const codeChallengeSchema = z.string().regex(/^[A-Za-z0-9_-]{43,128}$/);
const codeVerifierSchema = z.string().regex(/^[A-Za-z0-9._~-]{43,128}$/);

export type OAuthFailure =
  | "invalid_request"
  | "invalid_client"
  | "invalid_grant"
  | "unauthorized_client"
  | "unsupported_grant_type"
  | "invalid_scope"
  | "temporarily_unavailable";

interface ApplicationRow extends QueryResultRow {
  id: string;
  clientId: string;
  clientSecretHash?: string;
  clientType: "CONFIDENTIAL" | "PUBLIC";
  tokenEndpointAuthMethod: "client_secret_basic" | "client_secret_post" | "none";
  slug: string;
  name: string;
  description: string;
  redirectUris: string[];
  allowedScopes: IntegrationScope[];
}

interface AuthorizationRequestRow extends QueryResultRow {
  id: string;
  applicationId: string;
  userId: string;
  roleAssignmentId: string;
  companyId: string;
  redirectUri: string;
  clientState: string;
  requestedScopes: IntegrationScope[];
  codeChallenge: string;
  expiresAt: string;
  status: "PENDING" | "APPROVED" | "DENIED" | "EXPIRED";
  clientId: string;
  applicationName: string;
  applicationSlug: string;
  applicationStatus: string;
  allowedScopes: IntegrationScope[];
}

interface AuthorizationCodeRow extends QueryResultRow {
  id: string;
  applicationId: string;
  connectionId: string;
  companyId: string;
  grantId: string;
  userId: string;
  roleAssignmentId: string;
  authVersionAtGrant: number;
  redirectUri: string;
  scopes: IntegrationScope[];
  codeChallenge: string;
  expiresAt: string;
}

interface RefreshTokenRow extends QueryResultRow {
  id: string;
  familyId: string;
  grantId: string;
  applicationId: string;
  connectionId: string;
  companyId: string;
  userId: string;
  roleAssignmentId: string;
  authVersionAtGrant: number;
  scopes: IntegrationScope[];
  generation: number;
  tokenExpiresAt: string;
  consumedAt?: string;
  tokenRevokedAt?: string;
  familyStatus: "ACTIVE" | "REVOKED" | "REUSE_DETECTED" | "EXPIRED";
  familyExpiresAt: string;
  grantStatus: "ACTIVE" | "REVOKED" | "EXPIRED";
  grantExpiresAt: string;
}

async function insertOAuthAudit(client: PoolClient, input: {
  requestId: string;
  applicationId?: string;
  connectionId?: string;
  companyId?: string;
  grantId?: string;
  userId?: string;
  scopes?: readonly IntegrationScope[];
  route: "/oauth/authorize" | "/oauth/token" | "/oauth/revoke";
  action: "GRANT_APPROVE" | "GRANT_DENY" | "TOKEN_ISSUE" | "TOKEN_REFRESH" | "TOKEN_REPLAY" | "TOKEN_REVOKE";
  result: "SUCCESS" | "DENIED" | "INVALID";
  httpStatus: number;
  networkHash?: string;
}) {
  await client.query(`
    INSERT INTO public.integration_api_audit(
      request_id,application_id,connection_id,company_id,grant_id,
      delegating_user_id,scopes,route,action,result,http_status,
      network_hash,details
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'{}'::jsonb)
  `, [
    input.requestId,input.applicationId ?? null,input.connectionId ?? null,
    input.companyId ?? null,input.grantId ?? null,input.userId ?? null,
    input.scopes ?? [],input.route,input.action,input.result,input.httpStatus,
    input.networkHash ?? null,
  ]);
}

export interface PreparedAuthorization {
  handle: string;
  application: { name: string; description: string };
  scopes: readonly IntegrationScope[];
  companyId: string;
  companyName: string;
  expiresAt: Date;
}

export type PrepareAuthorizationResult =
  | { ok: true; authorization: PreparedAuthorization }
  | { ok: false; error: OAuthFailure };

export type AuthorizationDecisionResult =
  | { ok: true; redirect: string }
  | { ok: false; error: OAuthFailure };

export type TokenResult =
  | {
      ok: true;
      accessToken: string;
      refreshToken: string;
      expiresIn: number;
      scope: string;
      audit: {
        applicationId: string;
        connectionId: string;
        companyId: string;
        grantId: string;
        userId: string;
        scopes: readonly IntegrationScope[];
      };
    }
  | { ok: false; error: OAuthFailure };

function exactHttpsRedirect(value: string) {
  if (value.length > 2048) return null;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password
      || parsed.hash || parsed.origin === integrationOrigin()) return null;
    return parsed.toString() === value ? value : null;
  } catch {
    return null;
  }
}

async function applicationByClientId(
  client: PoolClient,
  clientId: string,
  lock = false,
  allowDisabledProvider = false,
) {
  const result = await client.query<ApplicationRow>(`
    SELECT id::text,client_id AS "clientId",
      client_secret_hash AS "clientSecretHash",client_type AS "clientType",
      token_endpoint_auth_method AS "tokenEndpointAuthMethod",slug,name,
      description,redirect_uris AS "redirectUris",
      allowed_scopes AS "allowedScopes"
    FROM public.integration_applications
    WHERE client_id=$1 AND status='ACTIVE'
    ${lock ? "FOR KEY SHARE" : ""}
  `, [clientId]);
  const application = result.rows[0];
  return application && (allowDisabledProvider
    || integrationApplicationEnabled(application.slug))
    ? application
    : undefined;
}

export async function prepareAuthorization(input: {
  actor: AuthenticatedSessionUser;
  parameters: URLSearchParams;
  requestId: string;
}): Promise<PrepareAuthorizationResult> {
  const raw = {
    responseType: input.parameters.get("response_type"),
    clientId: input.parameters.get("client_id"),
    redirectUri: input.parameters.get("redirect_uri"),
    scope: input.parameters.get("scope"),
    state: input.parameters.get("state"),
    codeChallenge: input.parameters.get("code_challenge"),
    codeChallengeMethod: input.parameters.get("code_challenge_method"),
  };
  const parsed = z.object({
    responseType: z.literal("code"),
    clientId: clientIdSchema,
    redirectUri: z.string().min(8).max(2048),
    scope: z.string().min(1).max(512),
    state: stateSchema,
    codeChallenge: codeChallengeSchema,
    codeChallengeMethod: z.literal("S256"),
  }).safeParse(raw);
  if (!parsed.success || !exactHttpsRedirect(parsed.data.redirectUri)) {
    return { ok: false, error: "invalid_request" };
  }
  const scopes = parseIntegrationScopes(parsed.data.scope);
  if (!scopes) return { ok: false, error: "invalid_scope" };
  if (!input.actor.companyId || !await canManageCompanyIntegrations(
    input.actor,
    input.actor.companyId,
  )) return { ok: false, error: "unauthorized_client" };

  const handle = opaqueIntegrationSecret("axora_ar_");
  const expiresAt = new Date(Date.now() + 10 * 60_000);
  const application = await withIntegrationTransaction({
    systemIdentity: "integration-oauth",
    reason: "Prepared OAuth authorization consent",
    actor: input.actor,
    correlationId: input.requestId,
  }, async (client) => {
    const app = await applicationByClientId(client, parsed.data.clientId, true);
    if (!app || !app.redirectUris.includes(parsed.data.redirectUri)) return null;
    if (!scopesAreSubset(scopes, app.allowedScopes)) return null;
    const company = await client.query<{ name: string }>(`
      SELECT name FROM public.companies WHERE id=$1 AND active=true
    `, [input.actor.companyId]);
    if (!company.rows[0]) return null;
    await client.query(`
      INSERT INTO public.integration_oauth_authorization_requests(
        request_handle_hash,application_id,user_id,role_assignment_id,
        company_id,redirect_uri,client_state,requested_scopes,
        code_challenge,code_challenge_method,expires_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'S256',$10)
    `, [
      hashIntegrationSecret("authorization-request", handle),
      app.id,
      input.actor.id,
      input.actor.roleAssignmentId,
      input.actor.companyId,
      parsed.data.redirectUri,
      parsed.data.state,
      scopes,
      parsed.data.codeChallenge,
      expiresAt,
    ]);
    return { ...app, companyName: company.rows[0].name };
  });
  if (!application) return { ok: false, error: "invalid_request" };
  return {
    ok: true,
    authorization: {
      handle,
      application: {
        name: application.name,
        description: application.description,
      },
      scopes,
      companyId: input.actor.companyId,
      companyName: application.companyName,
      expiresAt,
    },
  };
}

function redirectWithResult(
  redirectUri: string,
  state: string,
  result: { code: string } | { error: "access_denied" },
) {
  const redirect = new URL(redirectUri);
  if ("code" in result) redirect.searchParams.set("code", result.code);
  else redirect.searchParams.set("error", result.error);
  redirect.searchParams.set("state", state);
  redirect.searchParams.set("iss", integrationOrigin());
  return redirect.toString();
}

export async function decideAuthorization(input: {
  actor: AuthenticatedSessionUser;
  handle: string;
  decision: "approve" | "deny";
  requestId: string;
  networkHash?: string;
}): Promise<AuthorizationDecisionResult> {
  if (!authorizationHandleSchema.safeParse(input.handle).success) {
    return { ok: false, error: "invalid_request" };
  }
  if (!input.actor.companyId || !await canManageCompanyIntegrations(
    input.actor,
    input.actor.companyId,
  )) return { ok: false, error: "unauthorized_client" };

  const code = opaqueIntegrationSecret("axora_ac_");
  return withIntegrationTransaction({
    systemIdentity: "integration-oauth",
    reason: input.decision === "approve"
      ? "Approved OAuth authorization consent"
      : "Denied OAuth authorization consent",
    actor: input.actor,
    correlationId: input.requestId,
  }, async (client) => {
    const requestResult = await client.query<AuthorizationRequestRow>(`
      SELECT request.id::text,request.application_id::text AS "applicationId",
        request.user_id::text AS "userId",
        request.role_assignment_id::text AS "roleAssignmentId",
        request.company_id::text AS "companyId",
        request.redirect_uri AS "redirectUri",
        request.client_state AS "clientState",
        request.requested_scopes AS "requestedScopes",
        request.code_challenge AS "codeChallenge",
        request.expires_at::text AS "expiresAt",request.status,
        application.client_id AS "clientId",
        application.name AS "applicationName",
        application.slug AS "applicationSlug",
        application.status AS "applicationStatus",
        application.allowed_scopes AS "allowedScopes"
      FROM public.integration_oauth_authorization_requests request
      JOIN public.integration_applications application
        ON application.id=request.application_id
      WHERE request.request_handle_hash=$1
      FOR UPDATE OF request
    `, [hashIntegrationSecret("authorization-request", input.handle)]);
    const request = requestResult.rows[0];
    if (!request || request.status !== "PENDING"
      || new Date(request.expiresAt).getTime() <= Date.now()
      || request.applicationStatus !== "ACTIVE"
      || request.userId !== input.actor.id
      || request.roleAssignmentId !== input.actor.roleAssignmentId
      || request.companyId !== input.actor.companyId
      || !scopesAreSubset(request.requestedScopes, request.allowedScopes)) {
      return { ok: false, error: "invalid_request" } as const;
    }

    if (input.decision === "deny") {
      await client.query(`
        UPDATE public.integration_oauth_authorization_requests
        SET status='DENIED',decided_at=now() WHERE id=$1
      `, [request.id]);
      await insertOAuthAudit(client, {
        requestId: input.requestId,
        applicationId: request.applicationId,
        companyId: request.companyId,
        userId: request.userId,
        scopes: request.requestedScopes,
        route: "/oauth/authorize",
        action: "GRANT_DENY",
        result: "DENIED",
        httpStatus: 303,
        networkHash: input.networkHash,
      });
      return {
        ok: true,
        redirect: redirectWithResult(
          request.redirectUri,
          request.clientState,
          { error: "access_denied" },
        ),
      } as const;
    }

    if (!integrationApplicationEnabled(request.applicationSlug)) {
      return { ok: false, error: "unauthorized_client" } as const;
    }

    // Re-evaluate the canonical permission inside the transaction immediately
    // before creating a connection/grant. The earlier UI check is not an
    // authorization boundary and may have become stale while consent was open.
    const live = await client.query<{ valid: boolean }>(`
      SELECT public.axora_snapshot_has_permission(
        public.axora_live_authorization_snapshot($1,$2,now()),
        'integration.connection.manage','COMPANY',$3,NULL,NULL,NULL
      ) AS valid
    `, [request.userId,request.roleAssignmentId,request.companyId]);
    if (!live.rows[0]?.valid) {
      return { ok: false, error: "unauthorized_client" } as const;
    }

    let connectionId: string;
    const existingConnection = await client.query<{ id: string }>(`
      SELECT id::text FROM public.integration_connections
      WHERE application_id=$1 AND company_id=$2 AND status='ACTIVE'
      FOR UPDATE
    `, [request.applicationId, request.companyId]);
    if (existingConnection.rows[0]) {
      connectionId = existingConnection.rows[0].id;
    } else {
      const createdConnection = await client.query<{ id: string }>(`
        INSERT INTO public.integration_connections(
          application_id,company_id,connected_by
        ) VALUES ($1,$2,$3) RETURNING id::text
      `, [request.applicationId, request.companyId, input.actor.id]);
      connectionId = createdConnection.rows[0]!.id;
    }

    const oldGrants = await client.query<{ id: string }>(`
      UPDATE public.integration_oauth_grants
      SET status='REVOKED',revoked_at=now(),revoked_by=$3,
        revoke_reason='Replaced by a new user authorization',updated_at=now()
      WHERE connection_id=$1 AND user_id=$2 AND status='ACTIVE'
      RETURNING id::text
    `, [connectionId, input.actor.id, input.actor.id]);
    if (oldGrants.rowCount) {
      const grantIds = oldGrants.rows.map((grant) => grant.id);
      await client.query(`
        UPDATE public.integration_oauth_access_tokens
        SET revoked_at=COALESCE(revoked_at,now())
        WHERE grant_id=ANY($1::uuid[])
      `, [grantIds]);
      await client.query(`
        UPDATE public.integration_oauth_refresh_families
        SET status='REVOKED',revoked_at=COALESCE(revoked_at,now()),
          revoke_reason=COALESCE(revoke_reason,'Grant replaced by reauthorization')
        WHERE grant_id=ANY($1::uuid[]) AND status='ACTIVE'
      `, [grantIds]);
    }

    const grantExpiresAt = new Date(Date.now() + 90 * 24 * 60 * 60_000);
    const grantResult = await client.query<{ id: string }>(`
      INSERT INTO public.integration_oauth_grants(
        application_id,connection_id,company_id,user_id,role_assignment_id,
        auth_version_at_grant,scopes,expires_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      RETURNING id::text
    `, [
      request.applicationId,
      connectionId,
      request.companyId,
      input.actor.id,
      input.actor.roleAssignmentId,
      input.actor.authVersion,
      request.requestedScopes,
      grantExpiresAt,
    ]);
    await client.query(`
      INSERT INTO public.integration_oauth_authorization_codes(
        code_hash,application_id,connection_id,company_id,grant_id,user_id,
        redirect_uri,scopes,code_challenge,code_challenge_method,expires_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'S256',now()+interval '5 minutes')
    `, [
      hashIntegrationSecret("authorization-code", code),
      request.applicationId,
      connectionId,
      request.companyId,
      grantResult.rows[0]!.id,
      input.actor.id,
      request.redirectUri,
      request.requestedScopes,
      request.codeChallenge,
    ]);
    await client.query(`
      UPDATE public.integration_oauth_authorization_requests
      SET status='APPROVED',decided_at=now() WHERE id=$1
    `, [request.id]);
    await insertOAuthAudit(client, {
      requestId: input.requestId,
      applicationId: request.applicationId,
      connectionId,
      companyId: request.companyId,
      grantId: grantResult.rows[0]!.id,
      userId: request.userId,
      scopes: request.requestedScopes,
      route: "/oauth/authorize",
      action: "GRANT_APPROVE",
      result: "SUCCESS",
      httpStatus: 303,
      networkHash: input.networkHash,
    });
    return {
      ok: true,
      redirect: redirectWithResult(
        request.redirectUri,
        request.clientState,
        { code },
      ),
    } as const;
  });
}

export interface OAuthClientCredentials {
  clientId: string;
  clientSecret?: string;
  method: "client_secret_basic" | "client_secret_post" | "none";
}

export function parseOAuthClientCredentials(
  request: Request,
  form: URLSearchParams,
): OAuthClientCredentials | null {
  const authorization = request.headers.get("authorization")?.trim();
  const bodyClientId = form.get("client_id")?.trim();
  const bodySecret = form.get("client_secret") ?? undefined;
  if (authorization) {
    const match = /^Basic ([A-Za-z0-9+/]+={0,2})$/.exec(authorization);
    if (!match || bodySecret !== undefined) return null;
    try {
      const decoded = Buffer.from(match[1], "base64").toString("utf8");
      const separator = decoded.indexOf(":");
      if (separator < 1 || decoded.indexOf(":", separator + 1) !== -1) return null;
      const clientId = decoded.slice(0, separator);
      const clientSecret = decoded.slice(separator + 1);
      if (bodyClientId && bodyClientId !== clientId) return null;
      return { clientId, clientSecret, method: "client_secret_basic" };
    } catch {
      return null;
    }
  }
  if (!bodyClientId) return null;
  return bodySecret !== undefined
    ? { clientId: bodyClientId, clientSecret: bodySecret, method: "client_secret_post" }
    : { clientId: bodyClientId, method: "none" };
}

async function authenticatedApplication(
  client: PoolClient,
  credentials: OAuthClientCredentials,
  allowDisabledProvider = false,
) {
  if (!clientIdSchema.safeParse(credentials.clientId).success) return null;
  const application = await applicationByClientId(
    client,
    credentials.clientId,
    true,
    allowDisabledProvider,
  );
  if (!application || application.tokenEndpointAuthMethod !== credentials.method) return null;
  if (application.clientType === "PUBLIC") {
    return credentials.method === "none" && !credentials.clientSecret
      ? application : null;
  }
  return credentials.clientSecret && application.clientSecretHash
    && integrationSecretHashMatches(
      "client-secret",
      credentials.clientSecret,
      application.clientSecretHash,
    ) ? application : null;
}

function pkceMatches(verifier: string, challenge: string) {
  const actual = Buffer.from(createHash("sha256").update(verifier, "ascii").digest("base64url"));
  const expected = Buffer.from(challenge);
  return actual.byteLength === expected.byteLength && timingSafeEqual(actual, expected);
}

function minimumDate(...dates: Date[]) {
  return new Date(Math.min(...dates.map((date) => date.getTime())));
}

async function issueTokenSet(input: {
  client: PoolClient;
  applicationId: string;
  connectionId: string;
  companyId: string;
  grantId: string;
  userId: string;
  roleAssignmentId: string;
  authVersion: number;
  scopes: readonly IntegrationScope[];
  familyId?: string;
  familyExpiresAt?: Date;
  parentRefreshTokenId?: string;
  generation?: number;
}) {
  const accessToken = opaqueIntegrationSecret("axora_at_");
  const refreshToken = opaqueIntegrationSecret("axora_rt_");
  const now = new Date();
  const accessExpiresAt = new Date(now.getTime() + 15 * 60_000);
  let familyId = input.familyId;
  let familyExpiresAt = input.familyExpiresAt;
  if (!familyId || !familyExpiresAt) {
    familyExpiresAt = new Date(now.getTime() + 90 * 24 * 60 * 60_000);
    const familyResult = await input.client.query<{ id: string }>(`
      INSERT INTO public.integration_oauth_refresh_families(
        application_id,connection_id,company_id,grant_id,user_id,expires_at
      ) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id::text
    `, [
      input.applicationId,input.connectionId,input.companyId,input.grantId,
      input.userId,familyExpiresAt,
    ]);
    familyId = familyResult.rows[0]!.id;
  }
  const refreshExpiresAt = minimumDate(
    familyExpiresAt,
    new Date(now.getTime() + 30 * 24 * 60 * 60_000),
  );
  const refreshResult = await input.client.query<{ id: string }>(`
    INSERT INTO public.integration_oauth_refresh_tokens(
      family_id,grant_id,token_hash,generation,parent_token_id,expires_at
    ) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id::text
  `, [
    familyId,
    input.grantId,
    hashIntegrationSecret("refresh-token", refreshToken),
    input.generation ?? 1,
    input.parentRefreshTokenId ?? null,
    refreshExpiresAt,
  ]);
  await input.client.query(`
    INSERT INTO public.integration_oauth_access_tokens(
      application_id,connection_id,company_id,grant_id,refresh_family_id,
      user_id,role_assignment_id,auth_version_at_issue,token_hash,audience,
      scopes,expires_at
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,'https://axora.management/api/v1',$10,$11
    )
  `, [
    input.applicationId,input.connectionId,input.companyId,input.grantId,
    familyId,input.userId,input.roleAssignmentId,input.authVersion,
    hashIntegrationSecret("access-token", accessToken),input.scopes,
    accessExpiresAt,
  ]);
  return {
    accessToken,
    refreshToken,
    refreshTokenId: refreshResult.rows[0]!.id,
    familyId,
    expiresIn: 15 * 60,
  };
}

export async function exchangeAuthorizationCode(input: {
  credentials: OAuthClientCredentials;
  code: string;
  redirectUri: string;
  codeVerifier: string;
  requestId: string;
  networkHash?: string;
}): Promise<TokenResult> {
  if (!authorizationCodeSchema.safeParse(input.code).success
    || !codeVerifierSchema.safeParse(input.codeVerifier).success
    || !exactHttpsRedirect(input.redirectUri)) {
    return { ok: false, error: "invalid_grant" };
  }
  return withIntegrationTransaction({
    systemIdentity: "integration-oauth",
    reason: "Exchanged OAuth authorization code",
    correlationId: input.requestId,
  }, async (client) => {
    const application = await authenticatedApplication(client, input.credentials);
    if (!application) return { ok: false, error: "invalid_client" } as const;
    const result = await client.query<AuthorizationCodeRow>(`
      SELECT code.id::text,code.application_id::text AS "applicationId",
        code.connection_id::text AS "connectionId",
        code.company_id::text AS "companyId",code.grant_id::text AS "grantId",
        code.user_id::text AS "userId",
        grant_record.role_assignment_id::text AS "roleAssignmentId",
        grant_record.auth_version_at_grant::int AS "authVersionAtGrant",
        code.redirect_uri AS "redirectUri",code.scopes,
        code.code_challenge AS "codeChallenge",code.expires_at::text AS "expiresAt"
      FROM public.integration_oauth_authorization_codes code
      JOIN public.integration_connections connection
        ON connection.id=code.connection_id
       AND connection.application_id=code.application_id
       AND connection.company_id=code.company_id
       AND connection.status='ACTIVE'
      JOIN public.integration_oauth_grants grant_record
        ON grant_record.id=code.grant_id
       AND grant_record.application_id=code.application_id
       AND grant_record.connection_id=code.connection_id
       AND grant_record.company_id=code.company_id
       AND grant_record.user_id=code.user_id
       AND grant_record.status='ACTIVE'
       AND grant_record.expires_at>now()
      JOIN public.users account
        ON account.id=grant_record.user_id AND account.active
       AND account.account_status='ACTIVE'
       AND account.account_setup_completed_at IS NOT NULL
       AND account.auth_version=grant_record.auth_version_at_grant
      JOIN public.role_assignments assignment
        ON assignment.id=grant_record.role_assignment_id
       AND assignment.user_id=grant_record.user_id
       AND assignment.active AND assignment.revoked_at IS NULL
      WHERE code.code_hash=$1 AND code.consumed_at IS NULL
        AND code.expires_at>now()
      FOR UPDATE OF code
    `, [hashIntegrationSecret("authorization-code", input.code)]);
    const code = result.rows[0];
    if (!code || code.applicationId !== application.id
      || code.redirectUri !== input.redirectUri
      || !pkceMatches(input.codeVerifier, code.codeChallenge)) {
      return { ok: false, error: "invalid_grant" } as const;
    }
    const live = await client.query<{ valid: boolean }>(`
      SELECT public.axora_snapshot_has_permission(
        public.axora_live_authorization_snapshot($1,$2,now()),
        'integration.connection.manage','COMPANY',$3,NULL,NULL,NULL
      ) AS valid
    `, [code.userId, code.roleAssignmentId,code.companyId]);
    if (!live.rows[0]?.valid
      || !scopesAreSubset(code.scopes,application.allowedScopes)) {
      return { ok: false, error: "invalid_grant" } as const;
    }
    await client.query(`
      UPDATE public.integration_oauth_authorization_codes
      SET consumed_at=now() WHERE id=$1
    `, [code.id]);
    const issued = await issueTokenSet({
      client,
      applicationId: code.applicationId,
      connectionId: code.connectionId,
      companyId: code.companyId,
      grantId: code.grantId,
      userId: code.userId,
      roleAssignmentId: code.roleAssignmentId,
      authVersion: code.authVersionAtGrant,
      scopes: code.scopes,
    });
    await insertOAuthAudit(client, {
      requestId: input.requestId,
      applicationId: code.applicationId,
      connectionId: code.connectionId,
      companyId: code.companyId,
      grantId: code.grantId,
      userId: code.userId,
      scopes: code.scopes,
      route: "/oauth/token",
      action: "TOKEN_ISSUE",
      result: "SUCCESS",
      httpStatus: 200,
      networkHash: input.networkHash,
    });
    return {
      ok: true,
      accessToken: issued.accessToken,
      refreshToken: issued.refreshToken,
      expiresIn: issued.expiresIn,
      scope: code.scopes.join(" "),
      audit: {
        applicationId: code.applicationId,
        connectionId: code.connectionId,
        companyId: code.companyId,
        grantId: code.grantId,
        userId: code.userId,
        scopes: code.scopes,
      },
    } as const;
  });
}

async function revokeRefreshFamilyForReuse(
  client: PoolClient,
  refresh: RefreshTokenRow,
) {
  await client.query(`
    UPDATE public.integration_oauth_refresh_families
    SET status='REUSE_DETECTED',revoked_at=COALESCE(revoked_at,now()),
      reuse_detected_at=COALESCE(reuse_detected_at,now()),
      revoke_reason=COALESCE(revoke_reason,'Refresh token replay detected')
    WHERE id=$1
  `, [refresh.familyId]);
  await client.query(`
    UPDATE public.integration_oauth_refresh_tokens
    SET revoked_at=COALESCE(revoked_at,now()) WHERE family_id=$1
  `, [refresh.familyId]);
  await client.query(`
    UPDATE public.integration_oauth_access_tokens
    SET revoked_at=COALESCE(revoked_at,now()) WHERE refresh_family_id=$1
  `, [refresh.familyId]);
  await client.query(`
    UPDATE public.integration_oauth_grants
    SET status='REVOKED',revoked_at=COALESCE(revoked_at,now()),
      revoke_reason=COALESCE(revoke_reason,'Refresh token replay detected'),
      updated_at=now()
    WHERE id=$1 AND status='ACTIVE'
  `, [refresh.grantId]);
}

export async function rotateRefreshToken(input: {
  credentials: OAuthClientCredentials;
  refreshToken: string;
  requestedScope?: string;
  requestId: string;
  networkHash?: string;
}): Promise<TokenResult> {
  if (!refreshTokenSchema.safeParse(input.refreshToken).success) {
    return { ok: false, error: "invalid_grant" };
  }
  const narrowedScopes = input.requestedScope === undefined
    ? undefined : parseIntegrationScopes(input.requestedScope);
  if (input.requestedScope !== undefined && !narrowedScopes) {
    return { ok: false, error: "invalid_scope" };
  }
  return withIntegrationTransaction({
    systemIdentity: "integration-oauth",
    reason: "Rotated OAuth refresh token",
    correlationId: input.requestId,
  }, async (client) => {
    const application = await authenticatedApplication(client, input.credentials);
    if (!application) return { ok: false, error: "invalid_client" } as const;
    const result = await client.query<RefreshTokenRow>(`
      SELECT token.id::text,token.family_id::text AS "familyId",
        token.grant_id::text AS "grantId",family.application_id::text AS "applicationId",
        family.connection_id::text AS "connectionId",
        family.company_id::text AS "companyId",family.user_id::text AS "userId",
        grant_record.role_assignment_id::text AS "roleAssignmentId",
        grant_record.auth_version_at_grant::int AS "authVersionAtGrant",
        grant_record.scopes,token.generation::int,
        token.expires_at::text AS "tokenExpiresAt",
        token.consumed_at::text AS "consumedAt",
        token.revoked_at::text AS "tokenRevokedAt",
        family.status AS "familyStatus",family.expires_at::text AS "familyExpiresAt",
        grant_record.status AS "grantStatus",
        grant_record.expires_at::text AS "grantExpiresAt"
      FROM public.integration_oauth_refresh_tokens token
      JOIN public.integration_oauth_refresh_families family
        ON family.id=token.family_id AND family.grant_id=token.grant_id
      JOIN public.integration_oauth_grants grant_record
        ON grant_record.id=family.grant_id
       AND grant_record.application_id=family.application_id
       AND grant_record.connection_id=family.connection_id
       AND grant_record.company_id=family.company_id
       AND grant_record.user_id=family.user_id
      JOIN public.integration_connections connection
        ON connection.id=family.connection_id
       AND connection.application_id=family.application_id
       AND connection.company_id=family.company_id
      WHERE token.token_hash=$1
      FOR UPDATE OF token,family,grant_record
    `, [hashIntegrationSecret("refresh-token", input.refreshToken)]);
    const refresh = result.rows[0];
    if (!refresh || refresh.applicationId !== application.id) {
      return { ok: false, error: "invalid_grant" } as const;
    }
    if (refresh.consumedAt) {
      await revokeRefreshFamilyForReuse(client, refresh);
      await insertOAuthAudit(client, {
        requestId: input.requestId,
        applicationId: refresh.applicationId,
        connectionId: refresh.connectionId,
        companyId: refresh.companyId,
        grantId: refresh.grantId,
        userId: refresh.userId,
        scopes: refresh.scopes,
        route: "/oauth/token",
        action: "TOKEN_REPLAY",
        result: "DENIED",
        httpStatus: 400,
        networkHash: input.networkHash,
      });
      return { ok: false, error: "invalid_grant" } as const;
    }
    if (refresh.tokenRevokedAt || refresh.familyStatus !== "ACTIVE"
      || refresh.grantStatus !== "ACTIVE"
      || new Date(refresh.tokenExpiresAt).getTime() <= Date.now()
      || new Date(refresh.familyExpiresAt).getTime() <= Date.now()
      || new Date(refresh.grantExpiresAt).getTime() <= Date.now()) {
      return { ok: false, error: "invalid_grant" } as const;
    }
    const scopes = narrowedScopes ?? refresh.scopes;
    if (!scopesAreSubset(scopes, refresh.scopes)
      || !scopesAreSubset(scopes,application.allowedScopes)) {
      return { ok: false, error: "invalid_scope" } as const;
    }
    const live = await client.query<{ valid: boolean }>(`
      SELECT EXISTS (
        SELECT 1 FROM public.integration_connections connection
        JOIN public.users account ON account.id=$2
        JOIN public.role_assignments assignment ON assignment.id=$3
        WHERE connection.id=$1 AND connection.application_id=$5
          AND connection.company_id=$6 AND connection.status='ACTIVE'
          AND account.active AND account.account_status='ACTIVE'
          AND account.account_setup_completed_at IS NOT NULL
          AND account.auth_version=$4
          AND assignment.user_id=account.id AND assignment.active
          AND assignment.revoked_at IS NULL
          AND public.axora_live_authorization_snapshot(
            account.id,assignment.id,now()
          ) IS NOT NULL
          AND public.axora_snapshot_has_permission(
            public.axora_live_authorization_snapshot(
              account.id,assignment.id,now()
            ),'integration.connection.manage','COMPANY',
            connection.company_id,NULL,NULL,NULL
          )
      ) AS valid
    `, [
      refresh.connectionId,
      refresh.userId,
      refresh.roleAssignmentId,
      refresh.authVersionAtGrant,
      refresh.applicationId,
      refresh.companyId,
    ]);
    if (!live.rows[0]?.valid) return { ok: false, error: "invalid_grant" } as const;
    const issued = await issueTokenSet({
      client,
      applicationId: refresh.applicationId,
      connectionId: refresh.connectionId,
      companyId: refresh.companyId,
      grantId: refresh.grantId,
      userId: refresh.userId,
      roleAssignmentId: refresh.roleAssignmentId,
      authVersion: refresh.authVersionAtGrant,
      scopes,
      familyId: refresh.familyId,
      familyExpiresAt: new Date(refresh.familyExpiresAt),
      parentRefreshTokenId: refresh.id,
      generation: refresh.generation + 1,
    });
    await client.query(`
      UPDATE public.integration_oauth_refresh_tokens
      SET consumed_at=now(),replaced_by_token_id=$2 WHERE id=$1
    `, [refresh.id, issued.refreshTokenId]);
    await insertOAuthAudit(client, {
      requestId: input.requestId,
      applicationId: refresh.applicationId,
      connectionId: refresh.connectionId,
      companyId: refresh.companyId,
      grantId: refresh.grantId,
      userId: refresh.userId,
      scopes,
      route: "/oauth/token",
      action: "TOKEN_REFRESH",
      result: "SUCCESS",
      httpStatus: 200,
      networkHash: input.networkHash,
    });
    return {
      ok: true,
      accessToken: issued.accessToken,
      refreshToken: issued.refreshToken,
      expiresIn: issued.expiresIn,
      scope: scopes.join(" "),
      audit: {
        applicationId: refresh.applicationId,
        connectionId: refresh.connectionId,
        companyId: refresh.companyId,
        grantId: refresh.grantId,
        userId: refresh.userId,
        scopes,
      },
    } as const;
  });
}

export async function revokeOAuthToken(input: {
  credentials: OAuthClientCredentials;
  token: string;
  requestId: string;
  networkHash?: string;
}) {
  return withIntegrationTransaction({
    systemIdentity: "integration-oauth",
    reason: "Revoked OAuth token",
    correlationId: input.requestId,
  }, async (client) => {
    const application = await authenticatedApplication(
      client,
      input.credentials,
      true,
    );
    if (!application) return { authenticated: false as const };
    if (/^axora_at_[A-Za-z0-9_-]{43}$/.test(input.token)) {
      const access = await client.query<{ familyId?: string }>(`
        UPDATE public.integration_oauth_access_tokens
        SET revoked_at=COALESCE(revoked_at,now())
        WHERE application_id=$1 AND token_hash=$2
        RETURNING refresh_family_id::text AS "familyId"
      `, [application.id, hashIntegrationSecret("access-token", input.token)]);
      const familyId = access.rows[0]?.familyId;
      if (familyId) {
        await client.query(`
          UPDATE public.integration_oauth_refresh_families
          SET status='REVOKED',revoked_at=COALESCE(revoked_at,now()),
            revoke_reason=COALESCE(revoke_reason,'OAuth revocation endpoint')
          WHERE id=$1 AND status='ACTIVE'
        `,[familyId]);
        await client.query(`
          UPDATE public.integration_oauth_refresh_tokens
          SET revoked_at=COALESCE(revoked_at,now()) WHERE family_id=$1
        `,[familyId]);
        await client.query(`
          UPDATE public.integration_oauth_access_tokens
          SET revoked_at=COALESCE(revoked_at,now()) WHERE refresh_family_id=$1
        `,[familyId]);
      }
    } else if (refreshTokenSchema.safeParse(input.token).success) {
      const family = await client.query<{ id: string }>(`
        SELECT family.id::text
        FROM public.integration_oauth_refresh_tokens token
        JOIN public.integration_oauth_refresh_families family ON family.id=token.family_id
        WHERE token.token_hash=$1 AND family.application_id=$2
        FOR UPDATE OF family
      `, [hashIntegrationSecret("refresh-token", input.token), application.id]);
      if (family.rows[0]) {
        await client.query(`
          UPDATE public.integration_oauth_refresh_families
          SET status='REVOKED',revoked_at=COALESCE(revoked_at,now()),
            revoke_reason=COALESCE(revoke_reason,'OAuth revocation endpoint')
          WHERE id=$1 AND status='ACTIVE'
        `, [family.rows[0].id]);
        await client.query(`
          UPDATE public.integration_oauth_refresh_tokens
          SET revoked_at=COALESCE(revoked_at,now()) WHERE family_id=$1
        `, [family.rows[0].id]);
        await client.query(`
          UPDATE public.integration_oauth_access_tokens
          SET revoked_at=COALESCE(revoked_at,now()) WHERE refresh_family_id=$1
        `, [family.rows[0].id]);
      }
    }
    await insertOAuthAudit(client, {
      requestId: input.requestId,
      applicationId: application.id,
      route: "/oauth/revoke",
      action: "TOKEN_REVOKE",
      result: "SUCCESS",
      httpStatus: 200,
      networkHash: input.networkHash,
    });
    return { authenticated: true as const };
  });
}

export const oauthInternals = {
  exactHttpsRedirect,
  pkceMatches,
};
