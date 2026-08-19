import { randomUUID } from "node:crypto";
import { InvitationResendForm } from "@/components/InvitationResendForm";
import { StatusBadge } from "@/components/StatusBadge";
import { UserRoleScopeEditor } from "@/components/UserRoleScopeEditor";
import type { AccessAdministrationSnapshot } from "@/lib/access-administration";
import type { AuthenticatedSessionUser } from "@/lib/auth";
import {
  existingUserManagementMessages,
  existingUserManagementNotice,
} from "@/lib/existing-user-management-i18n";
import { LOCALE_NAMES, SUPPORTED_LOCALES } from "@/lib/i18n";
import { loadOrganizationDirectory } from "@/lib/organization-access";
import { loadOrganizationStructureWorkspace } from "@/lib/organization-structure";
import { accountRoleDefinition, creatableAccountRoles } from "@/lib/role-catalog";
import { isUserRole, type UserRole } from "@/lib/types";
import {
  removeManagedApprovalLimitAction,
  replaceRoleScopeAction,
  setManagedApprovalLimitAction,
  setManagedUserActiveAction,
  updateManagedUserProfileAction,
} from "@/app/(portal)/users/[id]/access/actions";

const APPROVAL_PERMISSIONS = [
  "request.approve.other",
  "request.approve.self",
  "request.approve.over_budget",
  "request.approve.additional_actual",
] as const;

type ApprovalPermission = (typeof APPROVAL_PERMISSIONS)[number];

function isApprovalPermission(value: string): value is ApprovalPermission {
  return (APPROVAL_PERMISSIONS as readonly string[]).includes(value);
}

export async function UserManagementControls({
  actor,
  snapshot,
  noticeCode,
}: {
  actor: AuthenticatedSessionUser;
  snapshot: AccessAdministrationSnapshot;
  noticeCode?: string;
}) {
  const locale = actor.preferredLocale ?? "en";
  const copy = existingUserManagementMessages(locale);
  const notice = existingUserManagementNotice(locale, noticeCode);
  const selectedAssignment = snapshot.assignments.find((assignment) => (
    assignment.id === snapshot.selectedAssignmentId
  ));
  if (!selectedAssignment) return null;

  let companies: Awaited<ReturnType<typeof loadOrganizationDirectory>>["companies"] = [];
  let branches: Awaited<ReturnType<typeof loadOrganizationDirectory>>["branches"] = [];
  let departments: Awaited<ReturnType<typeof loadOrganizationStructureWorkspace>>["departments"] = [];
  try {
    const [directory, structure] = await Promise.all([
      loadOrganizationDirectory(actor),
      loadOrganizationStructureWorkspace(actor),
    ]);
    companies = directory.companies;
    branches = directory.branches;
    departments = structure.departments;
  } catch {
    // Mutation functions independently re-resolve every submitted identifier.
    // A restricted organization directory must never widen selectable scope.
  }

  // Historical roles remain visible in the read-only assignment list but are
  // never silently canonicalized into a routine edit choice. A role is editable
  // only when the exact stored key is a current catalogue entry available for
  // the normal account lifecycle.
  const storedRole = isUserRole(selectedAssignment.roleKey)
    ? selectedAssignment.roleKey
    : undefined;
  const storedDefinition = storedRole
    ? accountRoleDefinition(storedRole)
    : undefined;
  const currentRole = storedRole && storedDefinition
    && storedDefinition.key === storedRole
    && storedDefinition.availableForCreation !== false
    ? storedRole
    : undefined;

  const roleOptions = creatableAccountRoles(actor)
    .filter((definition) => definition.accountKind === snapshot.identity.accountKind)
    .map((definition) => ({
      value: definition.key,
      label: definition.label,
      accountKind: definition.accountKind,
    }));
  if (currentRole && storedDefinition
    && !roleOptions.some((option) => option.value === currentRole)) {
    roleOptions.unshift({
      value: currentRole,
      label: storedDefinition.label,
      accountKind: storedDefinition.accountKind,
    });
  }

  const canMutateOtherUser = actor.id !== snapshot.identity.id;
  const canEditRole = canMutateOtherUser
    && snapshot.identity.active
    && ["ACTIVE", "INVITED"].includes(snapshot.identity.accountStatus)
    && selectedAssignment.manageable
    && Boolean(currentRole)
    && roleOptions.length > 0;
  const profileAction = updateManagedUserProfileAction.bind(
    null,
    snapshot.identity.id,
    snapshot.selectedAssignmentId,
  );
  const approvalOptions = snapshot.permissionOptions
    .filter((permission) => permission.effective && isApprovalPermission(permission.code));
  const selectedScope = snapshot.selectedScope;
  const approvalScopeReady = selectedScope.type === "COMPANY"
    || selectedScope.type === "BRANCH"
    || selectedScope.type === "DEPARTMENT";
  const canManageApprovalLimits = snapshot.identity.accountStatus === "ACTIVE"
    && snapshot.identity.setupCompleted
    && snapshot.canManagePermissions
    && approvalScopeReady
    && Boolean(selectedScope.companyId)
    && approvalOptions.length > 0;

  return <>
    {notice ? <div className="callout" role="status"><strong>{notice}</strong></div> : null}

    <section className="detail-grid" style={{ marginBlockStart: 17 }}>
      <article className="panel">
        <div className="panel-header"><div><h2>{copy.profile}</h2><p>{copy.emailReadOnly}</p></div></div>
        <div className="panel-body">
          <form action={profileAction}>
            <div className="form-grid">
              <label>{copy.fullName}
                <input name="displayName" defaultValue={snapshot.identity.displayName}
                  required minLength={2} maxLength={200} disabled={!canMutateOtherUser} />
              </label>
              <label>{copy.workEmail}
                <input type="email" value={snapshot.identity.email} readOnly />
              </label>
              <label>{copy.jobTitle}
                <input name="jobTitle" defaultValue={snapshot.identity.jobTitle ?? ""}
                  maxLength={160} disabled={!canMutateOtherUser} />
              </label>
              <label>{copy.language}
                <select name="preferredLocale"
                  defaultValue={snapshot.identity.preferredLocale ?? locale}
                  disabled={!canMutateOtherUser}>
                  {SUPPORTED_LOCALES.map((language) => <option key={language} value={language}>
                    {LOCALE_NAMES[language].native}
                  </option>)}
                </select>
              </label>
            </div>
            {canMutateOtherUser ? <div className="form-actions">
              <button className="button button-primary" type="submit">{copy.saveProfile}</button>
            </div> : null}
          </form>
        </div>
      </article>

      <article className="panel">
        <div className="panel-header"><div><h2>{copy.accountState}</h2><p>{snapshot.identity.accountKind}</p></div></div>
        <div className="panel-body">
          <StatusBadge status={snapshot.identity.active ? "Active" : "Inactive"}>
            {snapshot.identity.accountStatus}
          </StatusBadge>
          {canMutateOtherUser ? <div className="action-row">
            {snapshot.identity.active ? <form action={setManagedUserActiveAction.bind(
              null,snapshot.identity.id,snapshot.selectedAssignmentId,false,
            )}>
              <button className="button button-secondary" type="submit">{copy.deactivate}</button>
            </form> : <form action={setManagedUserActiveAction.bind(
              null,snapshot.identity.id,snapshot.selectedAssignmentId,true,
            )}>
              <button className="button button-primary" type="submit">{copy.reactivate}</button>
            </form>}
          </div> : null}
        </div>
      </article>
    </section>

    {!snapshot.identity.setupCompleted ? <section className="panel" style={{ marginBlockStart: 17 }}>
      <div className="panel-header"><div><h2>{copy.pendingTitle}</h2><p>{copy.pendingBody}</p></div></div>
      <div className="panel-body">
        <p>{copy.sendNewInvitation}</p>
        {snapshot.identity.active && canMutateOtherUser ? <InvitationResendForm
          userId={snapshot.identity.id}
          userName={snapshot.identity.displayName}
          locale={locale}
        /> : null}
      </div>
    </section> : null}

    {currentRole ? <div style={{ marginBlockStart: 17 }}>
      <UserRoleScopeEditor
        action={replaceRoleScopeAction.bind(
          null,
          snapshot.identity.id,
          snapshot.selectedAssignmentId,
          randomUUID(),
        )}
        accountKind={snapshot.identity.accountKind}
        currentRole={currentRole as UserRole}
        currentScope={{
          type: selectedScope.type,
          ...(selectedScope.companyId ? { companyId: selectedScope.companyId } : {}),
          ...(selectedScope.branchId ? { branchId: selectedScope.branchId } : {}),
          ...(selectedScope.departmentId ? { departmentId: selectedScope.departmentId } : {}),
        }}
        companies={companies}
        branches={branches}
        departments={departments}
        roleOptions={roleOptions}
        locale={locale}
        enabled={canEditRole}
      />
    </div> : null}

    {canManageApprovalLimits ? <section className="panel" style={{ marginBlockStart: 17 }}>
      <div className="panel-header"><div><h2>{copy.approvalEditor}</h2><p>{copy.approvalEditorBody}</p></div></div>
      <div className="panel-body">
        <form action={setManagedApprovalLimitAction.bind(
          null,
          snapshot.identity.id,
          snapshot.selectedAssignmentId,
          selectedScope.type as "COMPANY" | "BRANCH" | "DEPARTMENT",
          selectedScope.companyId!,
          selectedScope.branchId,
          selectedScope.departmentId,
          snapshot.capturedAt.toISOString(),
        )}>
          <div className="form-grid">
            <label>{copy.approvalPermission}
              <select name="permission" required>
                {approvalOptions.map((permission) => <option key={permission.code} value={permission.code}>
                  {permission.label}
                </option>)}
              </select>
            </label>
            <label>{copy.currency}<input name="currency" defaultValue="MYR" maxLength={3} required /></label>
            <label>{copy.maximumAmount}<input name="maximumAmount" inputMode="decimal"
              pattern="^(?:0|[1-9]\\d{0,15})(?:\\.\\d{1,2})?$" required /></label>
            <label>{copy.expiry}<input name="endsAt" type="datetime-local" /></label>
            <label className="field-full"><input name="allowSelfApproval" type="checkbox" /> {copy.selfApproval}</label>
            <label className="field-full">{copy.reason}
              <textarea name="reason" required minLength={3} maxLength={500} />
            </label>
          </div>
          <div className="form-actions"><button className="button button-primary" type="submit">{copy.setLimit}</button></div>
        </form>
      </div>
    </section> : null}

    {snapshot.canManagePermissions
      && snapshot.approvalLimits.some((limit) => limit.subjectType === "USER") ? (
      <section className="panel" style={{ marginBlockStart: 17 }}>
        <div className="panel-header"><div><h2>{copy.removeLimit}</h2></div></div>
        <div className="panel-body table-action-stack">
          {snapshot.approvalLimits.filter((limit) => limit.subjectType === "USER").map((limit) => (
            <form key={limit.id} action={removeManagedApprovalLimitAction.bind(
              null,snapshot.identity.id,snapshot.selectedAssignmentId,limit.id,
            )} className="callout">
              <strong>{limit.permissionLabel} · {limit.currency} {limit.maximumAmount}</strong>
              <label>{copy.removalReason}
                <input name="reason" required minLength={3} maxLength={500} />
              </label>
              <button className="button button-secondary" type="submit">{copy.removeLimit}</button>
            </form>
          ))}
        </div>
      </section>
    ) : null}
  </>;
}
