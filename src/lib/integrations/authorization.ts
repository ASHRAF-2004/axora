import type { AuthenticatedSessionUser } from "../auth";
import { isDemoMode } from "../db";
import { canAccess } from "../permissions";
import {
  authorize,
  type AuthorizationScope,
  type PermissionCode,
} from "../authorization-policy";
import { loadEffectiveAccess } from "../effective-access";

export class IntegrationAuthorizationError extends Error {
  constructor() {
    super("Integration authorization is unavailable.");
    this.name = "IntegrationAuthorizationError";
  }
}

function companyResource(companyId: string): { scope: AuthorizationScope } {
  return { scope: { type: "COMPANY", companyId } };
}

export async function canManageCompanyIntegrations(
  actor: AuthenticatedSessionUser,
  companyId: string,
) {
  if (actor.role !== "COMPANY_ADMIN"
    || actor.accountKind !== "COMPANY"
    || actor.scopeType !== "COMPANY"
    || actor.companyId !== companyId) return false;
  if (isDemoMode()) return canAccess(actor,"manage_company_integrations");
  if (!actor.roleAssignmentId) return false;
  try {
    const access = await loadEffectiveAccess(actor);
    return authorize({
      subject: access.subject,
      permission: "integration.connection.manage",
      resource: companyResource(companyId),
    }).allowed;
  } catch {
    return false;
  }
}

export async function canManageIntegrationApplications(
  actor: AuthenticatedSessionUser,
) {
  if (!actor.isOwner || actor.role !== "PLATFORM_OWNER"
    || actor.accountKind !== "PLATFORM" || actor.scopeType !== "PLATFORM") return false;
  if (isDemoMode()) return canAccess(actor,"manage_integration_applications");
  if (!actor.roleAssignmentId) return false;
  try {
    const access = await loadEffectiveAccess(actor);
    return authorize({
      subject: access.subject,
      permission: "integration.application.manage",
      resource: { scope: { type: "PLATFORM" } },
    }).allowed;
  } catch {
    return false;
  }
}

export async function canViewIntegrationOperations(
  actor: AuthenticatedSessionUser,
) {
  if (!actor.isOwner || actor.role !== "PLATFORM_OWNER"
    || actor.accountKind !== "PLATFORM" || actor.scopeType !== "PLATFORM") return false;
  if (isDemoMode()) return canAccess(actor,"view_integration_operations");
  if (!actor.roleAssignmentId) return false;
  try {
    const access = await loadEffectiveAccess(actor);
    return authorize({
      subject: access.subject,
      permission: "integration.operations.view",
      resource: { scope: { type: "PLATFORM" } },
    }).allowed;
  } catch {
    return false;
  }
}

export async function currentPermissionAllows(
  actor: AuthenticatedSessionUser,
  permission: PermissionCode,
  scope: AuthorizationScope,
  ownerUserId?: string,
) {
  try {
    const access = await loadEffectiveAccess(actor);
    return authorize({
      subject: access.subject,
      permission,
      resource: { scope, ...(ownerUserId ? { ownerUserId } : {}) },
    }).allowed;
  } catch {
    return false;
  }
}
