import type { AccessSubject } from "@/lib/permissions";
import { canAccess } from "@/lib/permissions";
import { canonicalRoleForAuthorization } from "@/lib/authorization-policy";

/** Department/operational editing does not include destructive branch lifecycle. */
export function canManageBranchLifecycle(actor: AccessSubject) {
  return canonicalRoleForAuthorization(actor.role,actor.scopeType,actor.isOwner) !== "BRANCH_ADMIN"
    && canAccess(actor,"manage_branches");
}
