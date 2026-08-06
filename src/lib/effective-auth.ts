import "server-only";
import { redirect } from "next/navigation";
import {
  authorize,
  type AuthorizationDecision,
  type AuthorizationResource,
  type PermissionCode,
} from "./authorization-policy";
import { requireSession, type AuthenticatedSessionUser } from "./auth";
import {
  loadEffectiveAccess,
  type EffectiveAccessSnapshot,
} from "./effective-access";

export interface StableAuthorizationResult {
  user: AuthenticatedSessionUser;
  access: EffectiveAccessSnapshot;
  decision: AuthorizationDecision;
}

export class StablePermissionDeniedError extends Error {
  readonly decision: AuthorizationDecision;

  constructor(decision: AuthorizationDecision) {
    super("The requested action is not authorized.");
    this.name = "StablePermissionDeniedError";
    this.decision = decision;
  }
}

export async function evaluateStablePermission(
  user: AuthenticatedSessionUser,
  permission: PermissionCode,
  resource: AuthorizationResource,
  now = new Date(),
): Promise<StableAuthorizationResult> {
  const access = await loadEffectiveAccess(user, now);
  const decision = authorize({
    subject: access.subject,
    permission,
    resource,
    now,
  });
  return { user, access, decision };
}

export async function getCurrentStableAuthorization(
  permission: PermissionCode,
  resource: AuthorizationResource,
): Promise<StableAuthorizationResult> {
  const user = await requireSession();
  return evaluateStablePermission(user, permission, resource);
}

export async function requireStablePermission(
  permission: PermissionCode,
  resource: AuthorizationResource,
): Promise<StableAuthorizationResult & {
  decision: Extract<AuthorizationDecision, { allowed: true }>;
}> {
  const result = await getCurrentStableAuthorization(permission, resource);
  if (!result.decision.allowed) {
    throw new StablePermissionDeniedError(result.decision);
  }
  return {
    ...result,
    decision: result.decision,
  };
}

export async function requireStablePagePermission(
  permission: PermissionCode,
  resource: AuthorizationResource,
) {
  const result = await getCurrentStableAuthorization(permission, resource);
  if (!result.decision.allowed) redirect("/access-denied");
  return {
    ...result,
    decision: result.decision,
  };
}

export function isStablePermissionDeniedError(
  error: unknown,
): error is StablePermissionDeniedError {
  return error instanceof StablePermissionDeniedError;
}