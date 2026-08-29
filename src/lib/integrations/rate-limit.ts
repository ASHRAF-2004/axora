import { hashIntegrationSecret } from "./crypto";
import { withIntegrationTransaction } from "./database";

export type IntegrationRouteClass =
  | "OAUTH_AUTHORIZE"
  | "OAUTH_TOKEN"
  | "API_READ"
  | "API_WRITE";

interface RateScope {
  kind: "CLIENT" | "CONNECTION" | "TOKEN" | "NETWORK";
  identifier: string;
  limit: number;
}

class IntegrationRateLimitExceeded extends Error {
  constructor() {
    super("Integration rate limit exceeded.");
    this.name = "IntegrationRateLimitExceeded";
  }
}

export interface IntegrationRateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: Date;
}

export async function consumeIntegrationRateLimit(input: {
  routeClass: IntegrationRouteClass;
  scopes: readonly RateScope[];
  correlationId: string;
  now?: Date;
}): Promise<IntegrationRateLimitResult> {
  const now = input.now ?? new Date();
  const windowMs = 60_000;
  const bucket = new Date(Math.floor(now.getTime() / windowMs) * windowMs);
  const resetAt = new Date(bucket.getTime() + windowMs);
  const scopes = input.scopes.filter((scope) => scope.identifier.trim());
  if (!scopes.length) throw new Error("Integration throttle scope is unavailable.");
  try {
    const counts = await withIntegrationTransaction({
      systemIdentity: input.routeClass.startsWith("OAUTH")
        ? "integration-oauth" : "integration-api",
      reason: "Integration rate-limit check",
      correlationId: input.correlationId,
    }, async (client) => {
      const accepted: Array<{ count: number; limit: number }> = [];
      for (const scope of scopes) {
        const scopeHash = hashIntegrationSecret(
          "rate-limit",
          `${scope.kind}\0${scope.identifier}`,
        );
        const result = await client.query<{ requestCount: number }>(`
          INSERT INTO public.integration_api_rate_buckets(
            route_class,scope_kind,scope_hash,bucket_started_at,
            request_count,expires_at
          ) VALUES ($1,$2,$3,$4,1,$5)
          ON CONFLICT(route_class,scope_kind,scope_hash,bucket_started_at)
          DO UPDATE SET request_count=integration_api_rate_buckets.request_count+1
          WHERE integration_api_rate_buckets.request_count<$6
          RETURNING request_count::int AS "requestCount"
        `, [
          input.routeClass,
          scope.kind,
          scopeHash,
          bucket,
          new Date(resetAt.getTime() + 5 * 60_000),
          scope.limit,
        ]);
        const count = result.rows[0]?.requestCount;
        if (!count) throw new IntegrationRateLimitExceeded();
        accepted.push({ count, limit: scope.limit });
      }
      return accepted;
    });
    const tightest = counts.reduce((selected, current) => (
      current.limit - current.count < selected.limit - selected.count
        ? current : selected
    ));
    return {
      allowed: true,
      limit: tightest.limit,
      remaining: Math.max(0, tightest.limit - tightest.count),
      resetAt,
    };
  } catch (error) {
    if (!(error instanceof IntegrationRateLimitExceeded)) throw error;
    return {
      allowed: false,
      limit: Math.min(...scopes.map((scope) => scope.limit)),
      remaining: 0,
      resetAt,
    };
  }
}

export function integrationRateHeaders(result: IntegrationRateLimitResult) {
  const resetSeconds = Math.max(1, Math.ceil((result.resetAt.getTime() - Date.now()) / 1000));
  return {
    "RateLimit-Limit": String(result.limit),
    "RateLimit-Remaining": String(result.remaining),
    "RateLimit-Reset": String(resetSeconds),
    ...(result.allowed ? {} : { "Retry-After": String(resetSeconds) }),
  };
}
