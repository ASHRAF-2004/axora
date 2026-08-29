import { getSession } from "@/lib/auth";
import { recordIntegrationAudit } from "@/lib/integrations/audit";
import { externalApiEnabled, integrationOrigin } from "@/lib/integrations/config";
import { externalRequestId, oauthJsonError } from "@/lib/integrations/http";
import { integrationNetworkHash } from "@/lib/integrations/network";
import { decideAuthorization } from "@/lib/integrations/oauth";
import { consumeIntegrationRateLimit, integrationRateHeaders } from "@/lib/integrations/rate-limit";
import { parseFormUrlEncoded, requestOriginIsSame } from "@/lib/integrations/request";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const requestId = externalRequestId(request);
  if (!externalApiEnabled()) return new NextResponse(null, { status: 404 });
  let networkHash: string;
  try {
    networkHash = integrationNetworkHash(request);
  } catch {
    return oauthJsonError("temporarily_unavailable", 503, requestId);
  }
  if (!requestOriginIsSame(request, integrationOrigin())) {
    try {
      await recordIntegrationAudit({
        requestId,route: "/oauth/authorize",action: "GRANT_DECISION",
        result: "DENIED",httpStatus: 403,networkHash,
        details: { category: "origin_check" },
      });
    } catch {}
    return oauthJsonError("invalid_request", 403, requestId);
  }
  let actor: Awaited<ReturnType<typeof getSession>>;
  let form: Awaited<ReturnType<typeof parseFormUrlEncoded>>;
  try {
    [actor, form] = await Promise.all([
      getSession(),
      parseFormUrlEncoded(request, ["handle", "decision"]),
    ]);
  } catch {
    return oauthJsonError("invalid_request", 400, requestId);
  }
  if (!actor) return oauthJsonError("invalid_request", 401, requestId);
  const handle = form?.get("handle") ?? "";
  const decision = form?.get("decision");
  if (!form || (decision !== "approve" && decision !== "deny")) {
    return oauthJsonError("invalid_request", 400, requestId);
  }
  try {
    const rate = await consumeIntegrationRateLimit({
      routeClass: "OAUTH_AUTHORIZE",correlationId: requestId,
      scopes: [
        { kind: "CONNECTION", identifier: actor.companyId ?? actor.id, limit: 30 },
        { kind: "NETWORK", identifier: networkHash, limit: 120 },
      ],
    });
    if (!rate.allowed) return oauthJsonError(
      "temporarily_unavailable",429,requestId,integrationRateHeaders(rate),
    );
    const result = await decideAuthorization({
      actor,handle,decision,requestId,networkHash,
    });
    if (!result.ok) return oauthJsonError(result.error, 400, requestId);
    return NextResponse.redirect(result.redirect, {
      status: 303,
      headers: {
        "Axora-Request-Id": requestId,
        "Cache-Control": "no-store",
        Pragma: "no-cache",
        "Referrer-Policy": "no-referrer",
        ...integrationRateHeaders(rate),
      },
    });
  } catch {
    return oauthJsonError("temporarily_unavailable", 503, requestId);
  }
}
