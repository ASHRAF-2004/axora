import { z } from "zod";

export const INTEGRATION_SCOPES = [
  "companies:read",
  "requests:read",
  "requests:draft",
  "deliveries:read",
  "invoices:read",
  "webhooks:manage",
] as const;

export const integrationScopeSchema = z.enum(INTEGRATION_SCOPES);
export type IntegrationScope = z.infer<typeof integrationScopeSchema>;

export const INTEGRATION_SCOPE_DESCRIPTIONS: Readonly<
  Record<IntegrationScope, string>
> = {
  "companies:read": "Read the connected company's safe profile.",
  "requests:read": "Read purchase requests in the delegating user's current scope.",
  "requests:draft": "Create review-required request drafts without submitting or spending.",
  "deliveries:read": "Read safe delivery status in the current scope.",
  "invoices:read": "Read customer invoices in the current scope.",
  "webhooks:manage": "Manage webhook subscriptions for the connected company.",
};

export function parseIntegrationScopes(value: string) {
  const candidates = value.trim().split(/\s+/).filter(Boolean);
  if (!candidates.length || candidates.length > INTEGRATION_SCOPES.length) return null;
  const unique = [...new Set(candidates)];
  if (unique.length !== candidates.length) return null;
  const parsed = z.array(integrationScopeSchema).safeParse(unique);
  return parsed.success
    ? parsed.data.sort((left, right) => left.localeCompare(right))
    : null;
}

export function scopesAreSubset(
  requested: readonly IntegrationScope[],
  allowed: readonly IntegrationScope[],
) {
  const accepted = new Set(allowed);
  return requested.every((scope) => accepted.has(scope));
}
