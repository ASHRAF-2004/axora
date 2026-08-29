import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { SlackProviderConfiguration } from "./config";

export const SLACK_BOT_SCOPES = ["channels:read","chat:write"] as const;
export const SLACK_NOTIFICATION_EVENTS = [
  "request.submitted",
  "request.approved",
  "invoice.finalized",
  "delivery.out_for_delivery",
  "delivery.completed",
] as const;
export type SlackNotificationEvent = (typeof SLACK_NOTIFICATION_EVENTS)[number];

const tokenSchema = z.string().min(20).max(512)
  .regex(/^(?:xoxb-|xoxe\.xoxb-)[A-Za-z0-9._-]+$/);
const refreshTokenSchema = z.string().min(20).max(512)
  .regex(/^xoxe-[A-Za-z0-9._-]+$/);
const slackId = (prefix: string) => z.string()
  .regex(new RegExp(`^${prefix}[A-Z0-9]{8,32}$`));

const oauthSuccessSchema = z.object({
  ok: z.literal(true),
  app_id: slackId("A"),
  access_token: tokenSchema,
  token_type: z.literal("bot"),
  scope: z.string().min(1).max(256),
  bot_user_id: z.string().regex(/^[UB][A-Z0-9]{8,32}$/),
  team: z.object({ id: slackId("T"),name:z.string().trim().min(1).max(120) }).strict(),
  enterprise: z.object({ id: slackId("E"),name:z.string().max(120).optional() })
    .strict().nullable().optional(),
  expires_in: z.number().int().min(300).max(43_200),
  refresh_token: refreshTokenSchema,
}).passthrough();

const rotatedTokenSchema = z.object({
  ok: z.literal(true),
  access_token: tokenSchema,
  token_type: z.literal("bot"),
  scope: z.string().min(1).max(256),
  expires_in: z.number().int().min(300).max(43_200),
  refresh_token: refreshTokenSchema,
}).passthrough();

const channelSchema = z.object({
  id: z.string().regex(/^C[A-Z0-9]{8,32}$/),
  name: z.string().trim().min(1).max(120),
  is_member: z.boolean(),
  is_archived: z.boolean(),
  is_private: z.boolean(),
  is_shared: z.boolean(),
  is_ext_shared: z.boolean(),
  is_org_shared: z.boolean(),
}).passthrough();

export type SlackProviderErrorCategory =
  | "ACCESS_DENIED"
  | "INVALID_CALLBACK"
  | "PROVIDER_ERROR"
  | "SCOPE_MISMATCH"
  | "NETWORK_ERROR"
  | "PROVIDER_UNAVAILABLE"
  | "RATE_LIMITED"
  | "INVALID_RESPONSE"
  | "TOKEN_REVOKED"
  | "MISSING_SCOPE";

export class SlackProviderError extends Error {
  constructor(
    public readonly category: SlackProviderErrorCategory,
    public readonly retryAfterSeconds?: number,
  ) {
    super("Slack provider operation is unavailable.");
    this.name = "SlackProviderError";
  }
}

type FetchLike = typeof fetch;

function parseScopes(value: string) {
  return [...new Set(value.split(/[ ,]+/).map((scope) => scope.trim()).filter(Boolean))]
    .sort((left,right) => left.localeCompare(right));
}

export function slackScopesAreExact(value: string | readonly string[]) {
  const scopes = Array.isArray(value) ? [...value].sort() : parseScopes(value as string);
  return scopes.length === SLACK_BOT_SCOPES.length
    && scopes.every((scope,index) => scope === SLACK_BOT_SCOPES[index]);
}

async function boundedResponseText(response: Response, maximum = 65_536) {
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > maximum) {
    throw new SlackProviderError("INVALID_RESPONSE");
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  while (true) {
    const { value,done } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maximum) {
      await reader.cancel();
      throw new SlackProviderError("INVALID_RESPONSE");
    }
    chunks.push(value);
  }
  const joined = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk,offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(joined);
}

function retryAfter(response: Response) {
  const value = response.headers.get("retry-after")?.trim() ?? "";
  if (!/^\d{1,5}$/.test(value)) return undefined;
  const seconds = Number(value);
  return seconds >= 1 && seconds <= 86_400 ? seconds : undefined;
}

async function slackRequest(
  method: "oauth.v2.access" | "auth.revoke" | "conversations.list",
  input: {
    form?: URLSearchParams;
    token?: string;
    fetchImpl?: FetchLike;
  },
) {
  const fetchImpl = input.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(`https://slack.com/api/${method}`, {
      method: input.form ? "POST" : "GET",
      headers: {
        Accept: "application/json",
        ...(input.form ? {
          "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        } : {}),
        ...(input.token ? { Authorization: `Bearer ${input.token}` } : {}),
      },
      ...(input.form ? { body: input.form.toString() } : {}),
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
  } catch {
    throw new SlackProviderError("NETWORK_ERROR");
  }
  const text = await boundedResponseText(response);
  if (response.status === 429) {
    throw new SlackProviderError("RATE_LIMITED",retryAfter(response));
  }
  if (response.status >= 500) throw new SlackProviderError("PROVIDER_UNAVAILABLE");
  if (response.status !== 200) throw new SlackProviderError("PROVIDER_ERROR");
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new SlackProviderError("INVALID_RESPONSE");
  }
}

function providerFailure(value: unknown): never {
  const parsed = z.object({
    ok:z.literal(false),error:z.string().min(1).max(120),
  }).passthrough().safeParse(value);
  const error = parsed.success ? parsed.data.error : "";
  if (error === "invalid_auth" || error === "token_revoked"
    || error === "token_expired" || error === "account_inactive") {
    throw new SlackProviderError("TOKEN_REVOKED");
  }
  if (error === "missing_scope") throw new SlackProviderError("MISSING_SCOPE");
  throw new SlackProviderError(parsed.success ? "PROVIDER_ERROR" : "INVALID_RESPONSE");
}

export function slackAuthorizationUrl(
  configuration: SlackProviderConfiguration,
  state: string,
) {
  if (!/^[A-Za-z0-9_-]{43,128}$/.test(state)) {
    throw new SlackProviderError("INVALID_CALLBACK");
  }
  const url = new URL("https://slack.com/oauth/v2/authorize");
  url.searchParams.set("client_id",configuration.clientId);
  url.searchParams.set("scope",SLACK_BOT_SCOPES.join(","));
  url.searchParams.set("redirect_uri",configuration.redirectUri);
  url.searchParams.set("state",state);
  return url.toString();
}

export async function exchangeSlackAuthorizationCode(input: {
  configuration: SlackProviderConfiguration;
  code: string;
  fetchImpl?: FetchLike;
}) {
  if (!/^[A-Za-z0-9_-]{10,512}$/.test(input.code)) {
    throw new SlackProviderError("INVALID_CALLBACK");
  }
  const form = new URLSearchParams({
    client_id: input.configuration.clientId,
    client_secret: input.configuration.clientSecret,
    code: input.code,
    redirect_uri: input.configuration.redirectUri,
  });
  const value = await slackRequest("oauth.v2.access",{ form,fetchImpl:input.fetchImpl });
  const parsed = oauthSuccessSchema.safeParse(value);
  if (!parsed.success) providerFailure(value);
  if (parsed.data.app_id !== input.configuration.appId
    || !slackScopesAreExact(parsed.data.scope)) {
    throw new SlackProviderError("SCOPE_MISMATCH");
  }
  return {
    appId:parsed.data.app_id,
    accessToken:parsed.data.access_token,
    refreshToken:parsed.data.refresh_token,
    expiresIn:parsed.data.expires_in,
    scopes:parseScopes(parsed.data.scope),
    botUserId:parsed.data.bot_user_id,
    workspaceId:parsed.data.team.id,
    workspaceName:parsed.data.team.name,
    enterpriseId:parsed.data.enterprise?.id,
  };
}

export async function refreshSlackBotToken(input: {
  configuration: Pick<SlackProviderConfiguration,"clientId"|"clientSecret">;
  refreshToken: string;
  fetchImpl?: FetchLike;
}) {
  const refreshToken = refreshTokenSchema.safeParse(input.refreshToken);
  if (!refreshToken.success) throw new SlackProviderError("INVALID_CALLBACK");
  const form = new URLSearchParams({
    client_id:input.configuration.clientId,
    client_secret:input.configuration.clientSecret,
    grant_type:"refresh_token",
    refresh_token:refreshToken.data,
  });
  const value = await slackRequest("oauth.v2.access",{ form,fetchImpl:input.fetchImpl });
  const parsed = rotatedTokenSchema.safeParse(value);
  if (!parsed.success) providerFailure(value);
  if (!slackScopesAreExact(parsed.data.scope)) {
    throw new SlackProviderError("SCOPE_MISMATCH");
  }
  return {
    accessToken:parsed.data.access_token,
    refreshToken:parsed.data.refresh_token,
    expiresIn:parsed.data.expires_in,
    scopes:parseScopes(parsed.data.scope),
  };
}

export async function revokeSlackToken(input: {
  token: string;
  fetchImpl?: FetchLike;
}) {
  if (!/^(?:xoxb-|xoxe\.?)[A-Za-z0-9._-]{12,512}$/.test(input.token)) {
    throw new SlackProviderError("INVALID_CALLBACK");
  }
  const value = await slackRequest("auth.revoke",{
    form:new URLSearchParams(),token:input.token,fetchImpl:input.fetchImpl,
  });
  const parsed = z.object({ ok:z.literal(true),revoked:z.boolean().optional() })
    .passthrough().safeParse(value);
  if (!parsed.success) {
    const failure = z.object({ ok:z.literal(false),error:z.string() })
      .passthrough().safeParse(value);
    if (failure.success && ["invalid_auth","token_revoked","token_expired"]
      .includes(failure.data.error)) return;
    providerFailure(value);
  }
}

export interface SlackPublicChannel {
  id: string;
  name: string;
  isMember: boolean;
  isArchived: boolean;
}

export async function listSlackPublicChannels(input: {
  token: string;
  fetchImpl?: FetchLike;
}) {
  const token = tokenSchema.safeParse(input.token);
  if (!token.success) throw new SlackProviderError("TOKEN_REVOKED");
  const channels: SlackPublicChannel[] = [];
  let cursor = "";
  for (let page=0;page<5;page+=1) {
    const url = new URL("https://slack.com/api/conversations.list");
    url.searchParams.set("types","public_channel");
    url.searchParams.set("exclude_archived","true");
    url.searchParams.set("limit","200");
    if (cursor) url.searchParams.set("cursor",cursor);
    let response: Response;
    try {
      response = await (input.fetchImpl ?? fetch)(url,{
        headers:{ Accept:"application/json",Authorization:`Bearer ${token.data}` },
        redirect:"error",signal:AbortSignal.timeout(10_000),cache:"no-store",
      });
    } catch {
      throw new SlackProviderError("NETWORK_ERROR");
    }
    const text = await boundedResponseText(response);
    if (response.status===429) {
      throw new SlackProviderError("RATE_LIMITED",retryAfter(response));
    }
    if (response.status>=500) throw new SlackProviderError("PROVIDER_UNAVAILABLE");
    if (response.status!==200) throw new SlackProviderError("PROVIDER_ERROR");
    let value: unknown;
    try { value=JSON.parse(text); } catch { throw new SlackProviderError("INVALID_RESPONSE"); }
    const parsed=z.object({
      ok:z.literal(true),channels:z.array(channelSchema).max(200),
      response_metadata:z.object({ next_cursor:z.string().max(512).optional() })
        .passthrough().optional(),
    }).passthrough().safeParse(value);
    if (!parsed.success) providerFailure(value);
    for (const channel of parsed.data.channels) {
      if (channel.is_private || channel.is_shared
        || channel.is_ext_shared || channel.is_org_shared) continue;
      channels.push({
        id:channel.id,name:channel.name,
        isMember:channel.is_member,isArchived:channel.is_archived,
      });
    }
    cursor=parsed.data.response_metadata?.next_cursor?.trim() ?? "";
    if (!cursor) break;
  }
  return channels.sort((left,right) => left.name.localeCompare(right.name));
}

export function verifySlackRequestSignature(input: {
  signingSecret: string;
  timestamp: string | null;
  signature: string | null;
  rawBody: string;
  nowSeconds?: number;
}) {
  if (!/^\d{10}$/.test(input.timestamp ?? "")
    || !/^v0=[0-9a-f]{64}$/.test(input.signature ?? "")
    || Buffer.byteLength(input.rawBody,"utf8")>262_144) return false;
  const timestamp=Number(input.timestamp);
  const now=input.nowSeconds ?? Math.floor(Date.now()/1000);
  if (!Number.isSafeInteger(timestamp) || Math.abs(now-timestamp)>300) return false;
  const actual=`v0=${createHmac("sha256",input.signingSecret)
    .update(`v0:${input.timestamp}:${input.rawBody}`,"utf8").digest("hex")}`;
  const left=Buffer.from(actual,"utf8");
  const right=Buffer.from(input.signature!,"utf8");
  return left.byteLength===right.byteLength && timingSafeEqual(left,right);
}
