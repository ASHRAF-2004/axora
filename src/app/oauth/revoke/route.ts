import { recordIntegrationAudit } from "@/lib/integrations/audit";
import { externalApiEnabled } from "@/lib/integrations/config";
import { externalRequestId, oauthJsonError } from "@/lib/integrations/http";
import { integrationNetworkHash } from "@/lib/integrations/network";
import { parseOAuthClientCredentials, revokeOAuthToken } from "@/lib/integrations/oauth";
import { consumeIntegrationRateLimit, integrationRateHeaders } from "@/lib/integrations/rate-limit";
import { parseFormUrlEncoded } from "@/lib/integrations/request";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const requestId = externalRequestId(request);
  if (!externalApiEnabled()) return new NextResponse(null, { status: 404 });
  let form: Awaited<ReturnType<typeof parseFormUrlEncoded>>;
  try {
    form = await parseFormUrlEncoded(request, [
      "token","token_type_hint","client_id","client_secret",
    ]);
  } catch {
    return oauthJsonError("invalid_request", 400, requestId);
  }
  if (!form || !form.get("token") || (form.get("token")?.length ?? 0) > 512) {
    return oauthJsonError("invalid_request", 400, requestId);
  }
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
      routeClass: "OAUTH_TOKEN",correlationId: requestId,
      scopes: [
        { kind: "CLIENT", identifier: credentials.clientId, limit: 60 },
        { kind: "NETWORK", identifier: networkHash, limit: 180 },
      ],
    });
    if (!rate.allowed) return oauthJsonError(
      "temporarily_unavailable",429,requestId,integrationRateHeaders(rate),
    );
    const result = await revokeOAuthToken({
      credentials,token: form.get("token")!,requestId,networkHash,
    });
    if (!result.authenticated) {
      await recordIntegrationAudit({
        requestId,route: "/oauth/revoke",action: "TOKEN_REVOKE",
        result: "DENIED",httpStatus: 401,networkHash,
      });
      return oauthJsonError("invalid_client", 401, requestId, {
        "WWW-Authenticate": 'Basic realm="Axora OAuth"',
      });
    }
    return new NextResponse(null, {
      status: 200,
      headers: {
        "Axora-Request-Id": requestId,
        "Cache-Control": "no-store",
        Pragma: "no-cache",
        ...integrationRateHeaders(rate),
      },
    });
  } catch {
    return oauthJsonError("temporarily_unavailable", 503, requestId);
  }
}
