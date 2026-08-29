import { recordIntegrationAudit } from "@/lib/integrations/audit";
import { externalApiEnabled } from "@/lib/integrations/config";
import { externalRequestId, oauthJsonError } from "@/lib/integrations/http";
import { integrationNetworkHash } from "@/lib/integrations/network";
import {
  exchangeAuthorizationCode,
  parseOAuthClientCredentials,
  rotateRefreshToken,
} from "@/lib/integrations/oauth";
import { consumeIntegrationRateLimit, integrationRateHeaders } from "@/lib/integrations/rate-limit";
import { parseFormUrlEncoded } from "@/lib/integrations/request";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const fields = [
  "grant_type","code","redirect_uri","code_verifier",
  "refresh_token","scope","client_id","client_secret",
] as const;

function tokenErrorStatus(error: string) {
  return error === "invalid_client" ? 401 : error === "temporarily_unavailable" ? 503 : 400;
}

export async function POST(request: Request) {
  const requestId = externalRequestId(request);
  if (!externalApiEnabled()) return new NextResponse(null, { status: 404 });
  let form: Awaited<ReturnType<typeof parseFormUrlEncoded>>;
  try {
    form = await parseFormUrlEncoded(request, fields);
  } catch {
    return oauthJsonError("invalid_request", 400, requestId);
  }
  if (!form) return oauthJsonError("invalid_request", 400, requestId);
  const credentials = parseOAuthClientCredentials(request, form);
  if (!credentials) return oauthJsonError("invalid_client", 401, requestId, {
    "WWW-Authenticate": 'Basic realm="Axora OAuth"',
  });
  let networkHash: string;
  try {
    networkHash = integrationNetworkHash(request);
  } catch {
    return oauthJsonError("temporarily_unavailable", 503, requestId);
  }
  try {
    const rate = await consumeIntegrationRateLimit({
      routeClass: "OAUTH_TOKEN",
      correlationId: requestId,
      scopes: [
        { kind: "CLIENT", identifier: credentials.clientId, limit: 60 },
        { kind: "NETWORK", identifier: networkHash, limit: 180 },
      ],
    });
    if (!rate.allowed) {
      await recordIntegrationAudit({
        requestId,route: "/oauth/token",action: "TOKEN_ISSUE",
        result: "RATE_LIMITED",httpStatus: 429,networkHash,
      });
      return oauthJsonError("temporarily_unavailable", 429, requestId, integrationRateHeaders(rate));
    }
    const grantType = form.get("grant_type");
    const result = grantType === "authorization_code"
      ? await exchangeAuthorizationCode({
          credentials,
          code: form.get("code") ?? "",
          redirectUri: form.get("redirect_uri") ?? "",
          codeVerifier: form.get("code_verifier") ?? "",
          requestId,
          networkHash,
        })
      : grantType === "refresh_token"
        ? await rotateRefreshToken({
            credentials,
            refreshToken: form.get("refresh_token") ?? "",
            ...(form.has("scope") ? { requestedScope: form.get("scope") ?? "" } : {}),
            requestId,
            networkHash,
          })
        : { ok: false as const, error: "unsupported_grant_type" as const };
    if (!result.ok) {
      const status = tokenErrorStatus(result.error);
      await recordIntegrationAudit({
        requestId,route: "/oauth/token",action: "TOKEN_ISSUE",
        result: result.error === "invalid_client" ? "DENIED" : "INVALID",
        httpStatus: status,networkHash,
      });
      return oauthJsonError(result.error, status, requestId,
        result.error === "invalid_client"
          ? { "WWW-Authenticate": 'Basic realm="Axora OAuth"' }
          : integrationRateHeaders(rate));
    }
    return NextResponse.json({
      access_token: result.accessToken,
      token_type: "Bearer",
      expires_in: result.expiresIn,
      refresh_token: result.refreshToken,
      scope: result.scope,
    }, {
      headers: {
        "Axora-Request-Id": requestId,
        "Cache-Control": "no-store",
        Pragma: "no-cache",
        "X-Content-Type-Options": "nosniff",
        ...integrationRateHeaders(rate),
      },
    });
  } catch {
    return oauthJsonError("temporarily_unavailable", 503, requestId);
  }
}
