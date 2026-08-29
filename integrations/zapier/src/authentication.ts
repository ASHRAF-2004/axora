import type {
  Authentication,
  Bundle,
  ZObject,
} from "zapier-platform-core";

import {
  AXORA_API_BASE,
  AXORA_ORIGIN,
  AXORA_SCOPE,
  AXORA_SCOPES,
} from "./constants.js";
import type { AxoraEnvelope } from "./http.js";

interface OAuthTokenResponse {
  access_token: string;
  refresh_token: string;
  token_type: "Bearer";
  expires_in: number;
  scope: string;
}

interface PrincipalResponse {
  user: { name: string };
  connection: { company_id: string };
}

function requiredEnvironment(name: "AXORA_OAUTH_CLIENT_ID" | "AXORA_OAUTH_CLIENT_SECRET") {
  const value = process.env[name]?.trim();
  if (!value) throw new Error("Axora OAuth application credentials are unavailable.");
  const valid = name === "AXORA_OAUTH_CLIENT_ID"
    ? /^axora_client_[A-Za-z0-9_-]{24,96}$/.test(value)
    : /^axora_cs_[A-Za-z0-9_-]{43}$/.test(value);
  if (!valid) throw new Error("Axora OAuth application credentials are unavailable.");
  return value;
}

function clientAuthorization() {
  const clientId = requiredEnvironment("AXORA_OAUTH_CLIENT_ID");
  const clientSecret = requiredEnvironment("AXORA_OAUTH_CLIENT_SECRET");
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`, "utf8").toString("base64")}`;
}

function validatedTokenResponse(value: unknown): OAuthTokenResponse {
  const token = value as Partial<OAuthTokenResponse> | undefined;
  const scopes = typeof token?.scope === "string"
    ? token.scope.trim().split(/\s+/).filter(Boolean)
    : [];
  const allowedScopes = new Set<string>(AXORA_SCOPES);
  if (
    !token
    || !/^axora_at_[A-Za-z0-9_-]{43}$/.test(token.access_token ?? "")
    || !/^axora_rt_[A-Za-z0-9_-]{43}$/.test(token.refresh_token ?? "")
    || token.token_type !== "Bearer"
    || !Number.isInteger(token.expires_in)
    || token.expires_in! < 1
    || token.expires_in! > 3_600
    || scopes.length !== AXORA_SCOPES.length
    || new Set(scopes).size !== scopes.length
    || scopes.some((scope) => !allowedScopes.has(scope))
  ) {
    throw new Error("Axora returned an invalid OAuth token response.");
  }
  return token as OAuthTokenResponse;
}

const getAccessToken = async (z: ZObject, bundle: Bundle) => {
  const response = await z.request<OAuthTokenResponse>({
    url: `${AXORA_ORIGIN}/oauth/token`,
    method: "POST",
    headers: {
      Authorization: clientAuthorization(),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: {
      grant_type: "authorization_code",
      code: bundle.inputData.code,
      redirect_uri: bundle.inputData.redirect_uri,
      code_verifier: bundle.inputData.code_verifier,
    },
  });
  return validatedTokenResponse(response.data);
};

const refreshAccessToken = async (z: ZObject, bundle: Bundle) => {
  const response = await z.request<OAuthTokenResponse>({
    url: `${AXORA_ORIGIN}/oauth/token`,
    method: "POST",
    headers: {
      Authorization: clientAuthorization(),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: {
      grant_type: "refresh_token",
      refresh_token: bundle.authData.refresh_token,
    },
  });
  return validatedTokenResponse(response.data);
};

const test = async (z: ZObject, bundle: Bundle) => {
  void bundle;
  const response = await z.request<AxoraEnvelope<PrincipalResponse>>({
    url: `${AXORA_API_BASE}/me`,
    method: "GET",
  });
  return response.data.data;
};

const connectionLabel = async (z: ZObject, currentBundle: Bundle) => {
  const principal = await test(z, currentBundle);
  return `${principal.user.name} — ${principal.connection.company_id}`;
};

export default {
  type: "oauth2",
  oauth2Config: {
    authorizeUrl: {
      method: "GET",
      url: `${AXORA_ORIGIN}/oauth/authorize`,
      params: {
        client_id: "{{process.env.AXORA_OAUTH_CLIENT_ID}}",
        state: "{{bundle.inputData.state}}",
        redirect_uri: "{{bundle.inputData.redirect_uri}}",
        response_type: "code",
        scope: AXORA_SCOPE,
      },
    },
    getAccessToken,
    refreshAccessToken,
    autoRefresh: true,
    enablePkce: true,
    scope: AXORA_SCOPE,
  },
  fields: [],
  test,
  connectionLabel,
} satisfies Authentication;
