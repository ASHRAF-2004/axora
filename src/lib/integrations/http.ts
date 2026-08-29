import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

export interface ExternalApiMeta {
  request_id: string;
  [key: string]: unknown;
}

const requestIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function externalRequestId(request: Request) {
  const supplied = request.headers.get("axora-request-id")?.trim();
  return supplied && requestIdPattern.test(supplied) ? supplied : randomUUID();
}

function responseHeaders(requestId: string, extra?: HeadersInit) {
  const headers = new Headers(extra);
  headers.set("Axora-Request-Id", requestId);
  headers.set("Cache-Control", "no-store");
  headers.set("Pragma", "no-cache");
  headers.set("X-Content-Type-Options", "nosniff");
  return headers;
}

export function externalDataResponse(
  data: unknown,
  requestId: string,
  options: { status?: number; meta?: Record<string, unknown>; headers?: HeadersInit } = {},
) {
  return NextResponse.json({
    data,
    meta: { request_id: requestId, ...(options.meta ?? {}) },
  }, {
    status: options.status ?? 200,
    headers: responseHeaders(requestId, options.headers),
  });
}

export type ExternalErrorCode =
  | "feature_disabled"
  | "unauthorized"
  | "invalid_token"
  | "insufficient_scope"
  | "forbidden"
  | "not_found"
  | "invalid_request"
  | "conflict"
  | "rate_limited"
  | "temporarily_unavailable"
  | "internal_error";

const safeErrorMessages: Readonly<Record<ExternalErrorCode, string>> = {
  feature_disabled: "This API capability is not enabled.",
  unauthorized: "Authentication is required.",
  invalid_token: "The access token is invalid or no longer authorized.",
  insufficient_scope: "The access token does not include the required scope.",
  forbidden: "The requested operation is not permitted.",
  not_found: "The requested resource was not found.",
  invalid_request: "The request is invalid.",
  conflict: "The request conflicts with existing state.",
  rate_limited: "The integration rate limit was exceeded.",
  temporarily_unavailable: "The integration service is temporarily unavailable.",
  internal_error: "The request could not be completed.",
};

export function externalErrorResponse(
  code: ExternalErrorCode,
  status: number,
  requestId: string,
  options: {
    field?: string;
    headers?: HeadersInit;
    oauthError?: string;
  } = {},
) {
  return NextResponse.json({
    error: {
      code,
      message: safeErrorMessages[code],
      request_id: requestId,
      ...(options.field ? { field: options.field } : {}),
      ...(options.oauthError ? { oauth_error: options.oauthError } : {}),
    },
  }, {
    status,
    headers: responseHeaders(requestId, options.headers),
  });
}

export function oauthJsonError(
  oauthError: "invalid_request" | "invalid_client" | "invalid_grant" | "unauthorized_client" | "unsupported_grant_type" | "invalid_scope" | "temporarily_unavailable",
  status: number,
  requestId: string,
  headers?: HeadersInit,
) {
  return NextResponse.json({
    error: oauthError,
    error_description: oauthError === "temporarily_unavailable"
      ? "The authorization service is temporarily unavailable."
      : "The OAuth request could not be accepted.",
  }, {
    status,
    headers: responseHeaders(requestId, headers),
  });
}
