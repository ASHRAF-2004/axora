import type { Instrumentation } from "next";
import { safeErrorReference } from "@/lib/error-reference";

const SAFE_REVISION = /^[0-9a-f]{7,64}$/iu;

function deploymentRevision() {
  for (const candidate of [
    process.env.AXORA_REVISION,
    process.env.NEXT_DEPLOYMENT_ID,
  ]) {
    const value = candidate?.trim();
    if (value && SAFE_REVISION.test(value)) return value;
  }
  return "unknown";
}

function errorReference(error: unknown) {
  if (!error || typeof error !== "object" || !("digest" in error)) {
    return undefined;
  }
  return safeErrorReference((error as { digest?: unknown }).digest);
}

/**
 * Privacy-minimized production error telemetry. This deliberately excludes
 * request headers, cookies, query strings, raw error messages, stack traces,
 * database identifiers, and form payloads.
 */
export const onRequestError: Instrumentation.onRequestError = (
  error,
  request,
  context,
) => {
  const reference = errorReference(error);
  const event = {
    event: "next_request_error",
    timestamp: new Date().toISOString(),
    deploymentRevision: deploymentRevision(),
    method: request.method,
    route: context.routePath,
    routeType: context.routeType,
    routerKind: context.routerKind,
    category: context.routeType === "action"
      ? "server_action"
      : "unexpected_request_failure",
    ...(reference ? { reference } : {}),
  };

  console.error(JSON.stringify(event));
};
