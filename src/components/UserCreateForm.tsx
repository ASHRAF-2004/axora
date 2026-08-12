"use client";

import { createUserAction } from "@/app/(portal)/users/actions";
import type {
  AccountKind,
  Branch,
  Company,
  RoleScopeType,
  UserRole,
} from "@/lib/types";
import { useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import { LOCALE_NAMES, SUPPORTED_LOCALES, type SupportedLocale } from "@/lib/i18n";
import { userFormMessages } from "@/lib/user-form-i18n";
import type { OrganizationDepartment } from "@/lib/organization-structure";
import { organizationStructureMessages } from "@/lib/organization-structure-i18n";
import {
  PermissionChecklist,
  type PermissionChecklistOption,
} from "@/components/PermissionChecklist";
import type { PermissionCode } from "@/lib/authorization-policy";

export interface UserRoleOption {
  label: string;
  value: UserRole;
  description: string;
  category: "Axora" | "Company" | "Delivery";
  accountKind: AccountKind;
  allowedScopes: readonly RoleScopeType[];
  defaultPermissions?: readonly PermissionCode[];
}

function CreateAccountButton({ disabled, locale }: { disabled: boolean; locale: SupportedLocale }) {
  const { pending } = useFormStatus();
  const copy = userFormMessages(locale);

  return (
    <button
      className="button button-primary"
      type="submit"
      disabled={disabled || pending}
      aria-busy={pending}
      data-feedback-label={copy.creating}
    >
      {pending ? copy.sending : copy.create}
    </button>
  );
}

export function UserCreateForm({
  actorBranchId,
  actorCompanyId,
  actorDepartmentId,
  actorIsOwner,
  branches,
  companies,
  departments,
  roleOptions,
  permissionOptions = [],
  defaultLocale,
}: {
  actorBranchId?: string;
  actorCompanyId?: string;
  actorDepartmentId?: string;
  actorIsOwner: boolean;
  branches: Branch[];
  companies: Company[];
  departments: OrganizationDepartment[];
  roleOptions: UserRoleOption[];
  permissionOptions?: PermissionChecklistOption[];
  defaultLocale: SupportedLocale;
}) {
  const preferredRole = roleOptions.find((option) => option.value === "COMPANY_ADMIN")
    ?? roleOptions.find((option) => option.value === "REQUESTER")
    ?? roleOptions[0];
  const [role, setRole] = useState<UserRole>(preferredRole?.value ?? "REQUESTER");
  const selectedRole = roleOptions.find((option) => option.value === role) ?? preferredRole;
  const initialCompanyId = actorCompanyId
    ?? companies.find((company) => company.status === "Active")?.id
    ?? "";
  const [companyId, setCompanyId] = useState(initialCompanyId);
  const availableBranches = useMemo(
    () => branches.filter((branch) => branch.status === "Active" && branch.companyId === companyId),
    [branches, companyId],
  );
  const [branchId, setBranchId] = useState(actorBranchId ?? "");
  const [departmentId, setDepartmentId] = useState(actorDepartmentId ?? "");
  const allowedPermissionCodes = useMemo(
    () => new Set(permissionOptions.map((permission) => permission.code)),
    [permissionOptions],
  );
  const roleDefaults = (selectedRole?.defaultPermissions ?? [])
    .filter((permission) => allowedPermissionCodes.has(permission));
  const [permissions, setPermissions] = useState<Set<PermissionCode>>(
    () => new Set(roleDefaults),
  );
  const [permissionsCustomized, setPermissionsCustomized] = useState(false);
  const copy = userFormMessages(defaultLocale);
  const organizationCopy = organizationStructureMessages(defaultLocale);
  const localizedSelectedRole = selectedRole ? copy.roles[selectedRole.value] : undefined;

  const isCompanyAccount = selectedRole?.accountKind === "COMPANY";
  const allowsBranch = Boolean(selectedRole?.allowedScopes.includes("BRANCH"));
  const allowsDepartment = Boolean(selectedRole?.allowedScopes.includes("DEPARTMENT"));
  const allowsCompany = Boolean(selectedRole?.allowedScopes.includes("COMPANY"));
  const requiresBranch = allowsBranch && !allowsDepartment && !allowsCompany;
  const requiresDepartment = allowsDepartment
    && !allowsBranch && !allowsCompany;
  const requiresNarrowScope = !allowsCompany && (allowsBranch || allowsDepartment);
  const firstBranchId = actorBranchId
    ?? availableBranches[0]?.id
    ?? "";
  const selectedBranchId = allowsBranch
    && availableBranches.some((branch) => branch.id === branchId)
    ? branchId
    : requiresBranch ? firstBranchId : "";
  const availableDepartments = departments.filter((department) => (
    department.active
    && department.companyId === companyId
    && (!actorDepartmentId || department.id === actorDepartmentId)
    && (!selectedBranchId || department.branchId === selectedBranchId)
  ));
  const selectedDepartmentId = allowsDepartment
    && availableDepartments.some((department) => department.id === departmentId)
    ? departmentId
    : requiresDepartment ? availableDepartments[0]?.id ?? "" : "";
  const selectedDepartment = availableDepartments.find(
    (department) => department.id === selectedDepartmentId,
  );
  const effectiveBranchId = selectedDepartment?.branchId ?? selectedBranchId;

  function changeCompany(nextCompanyId: string) {
    const nextBranches = branches.filter(
      (branch) => branch.status === "Active" && branch.companyId === nextCompanyId,
    );
    setCompanyId(nextCompanyId);
    setBranchId(requiresBranch ? nextBranches[0]?.id ?? "" : "");
    setDepartmentId("");
  }

  function changeRole(nextRole: UserRole) {
    const nextDefinition = roleOptions.find((option) => option.value === nextRole);
    setRole(nextRole);
    if (!permissionsCustomized) {
      setPermissions(new Set(
        (nextDefinition?.defaultPermissions ?? [])
          .filter((permission) => allowedPermissionCodes.has(permission)),
      ));
    }
    if (!nextDefinition?.allowedScopes.includes("BRANCH")) {
      setBranchId("");
    } else if (!nextDefinition.allowedScopes.includes("COMPANY")) {
      setBranchId((current) => availableBranches.some((branch) => branch.id === current)
        ? current
        : firstBranchId);
    }
    if (!nextDefinition?.allowedScopes.includes("DEPARTMENT")) {
      setDepartmentId("");
    }
  }

  function changePermissions(next: Set<PermissionCode>) {
    setPermissions(next);
    setPermissionsCustomized(true);
  }

  function resetPermissions() {
    setPermissions(new Set(roleDefaults));
    setPermissionsCustomized(false);
  }

  function changeDepartment(nextDepartmentId: string) {
    const department = departments.find((item) => item.id === nextDepartmentId);
    setDepartmentId(nextDepartmentId);
    if (department?.branchId) setBranchId(department.branchId);
  }

  const missingRequiredScope = (isCompanyAccount && !companyId)
    || (requiresDepartment && !selectedDepartmentId)
    || (requiresNarrowScope && !effectiveBranchId && !selectedDepartmentId);

  return (
    <form action={createUserAction} data-draft-id="create-user">
      <div className="form-grid">
        <label>{copy.fullName}<input name="displayName" required autoComplete="name" /></label>
        <label>{copy.workEmail}<input name="email" type="email" required autoComplete="username" /></label>
        <label>{copy.jobTitle} <span className="subtle">({copy.optional})</span>
          <input name="jobTitle" maxLength={160} autoComplete="organization-title" />
        </label>
        <label>{copy.invitationLanguage}
          <select name="preferredLocale" defaultValue={defaultLocale}>
            {SUPPORTED_LOCALES.map((locale) => (
              <option key={locale} value={locale}>{LOCALE_NAMES[locale].native}</option>
            ))}
          </select>
          <small>{copy.languageHelp}</small>
        </label>
        <label>{copy.role}
          <select
            name="role"
            value={role}
            onChange={(event) => changeRole(event.target.value as UserRole)}
          >
            {roleOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {copy.categories[option.category] ?? option.category} · {copy.roles[option.value]?.label ?? option.label}
              </option>
            ))}
          </select>
          <small>{localizedSelectedRole?.description ?? selectedRole?.description}</small>
        </label>

        {isCompanyAccount && (actorIsOwner || !actorCompanyId) ? (
          <label>{copy.customerCompany}
            <select
              name="companyId"
              required
              value={companyId}
              onChange={(event) => changeCompany(event.target.value)}
            >
              <option value="" disabled>{copy.selectCompany}</option>
              {companies.filter((company) => company.status === "Active").map((company) => (
                <option key={company.id} value={company.id}>{company.name}</option>
              ))}
            </select>
          </label>
        ) : null}
        {isCompanyAccount && !actorIsOwner && actorCompanyId ? (
          <input type="hidden" name="companyId" value={actorCompanyId} />
        ) : null}

        {isCompanyAccount && allowsBranch ? (
          <label>{copy.assignedBranch}
            <select
              name="branchId"
              required={requiresBranch}
              value={selectedBranchId}
              onChange={(event) => { setBranchId(event.target.value); setDepartmentId(""); }}
            >
              {requiresNarrowScope && !allowsDepartment
                ? <option value="" disabled>{copy.selectBranch}</option>
                : <option value="">{copy.companyWide}</option>}
              {availableBranches.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {actorIsOwner ? `${branch.companyName} · ` : ""}{branch.name}
                </option>
              ))}
            </select>
            <small>{requiresBranch
              ? copy.branchLimited
              : copy.branchOptional}</small>
          </label>
        ) : null}

        {isCompanyAccount && allowsDepartment ? (
          <label>{organizationCopy.department}
            <select
              name="departmentId"
              required={requiresDepartment}
              value={selectedDepartmentId}
              onChange={(event) => changeDepartment(event.target.value)}
            >
              <option value="">{requiresDepartment
                ? organizationCopy.selectDepartment
                : organizationCopy.noDepartment}</option>
              {availableDepartments.map((department) => (
                <option key={department.id} value={department.id}>{department.name}</option>
              ))}
            </select>
            <small>{requiresDepartment
              ? organizationCopy.departmentRequired
              : organizationCopy.departmentOptional}</small>
          </label>
        ) : null}
        {isCompanyAccount && !allowsBranch && effectiveBranchId ? (
          <input type="hidden" name="branchId" value={effectiveBranchId} />
        ) : null}

        <section className="field-full permission-editor" aria-labelledby="create-permissions-title">
          <div className="panel-header">
            <div>
              <h3 id="create-permissions-title">
                {defaultLocale === "ar" ? "الصلاحيات الفعلية" : defaultLocale === "ms" ? "Akses berkesan" : "Effective access"}
              </h3>
              <p>{defaultLocale === "ar"
                ? "الدور قالب بداية. عدّل الصلاحيات ضمن نطاق تفويضك."
                : defaultLocale === "ms"
                  ? "Peranan ialah templat permulaan. Laraskan kebenaran dalam kuasa delegasi anda."
                  : "The role is a starting template. Adjust permissions within your delegation authority."}</p>
            </div>
            <button className="button button-secondary" type="button" onClick={resetPermissions}>
              {defaultLocale === "ar" ? "إعادة ضبط قالب الدور" : defaultLocale === "ms" ? "Tetapkan semula templat peranan" : "Reset to role defaults"}
            </button>
          </div>
          {permissionsCustomized ? <div className="callout" role="status">
            {defaultLocale === "ar" ? "تم الاحتفاظ بتخصيصاتك عند تغيير الدور." : defaultLocale === "ms" ? "Pilihan tersuai anda dikekalkan apabila peranan berubah." : "Your custom choices are preserved when the role changes."}
          </div> : null}
          <PermissionChecklist
            locale={defaultLocale}
            options={permissionOptions}
            selected={permissions}
            onChange={changePermissions}
          />
        </section>

        <div className="callout field-full" role="note">
          <strong>{copy.secureSetup}</strong>
          <p>{copy.secureSetupBody}</p>
        </div>
      </div>
      <div className="form-actions">
        <CreateAccountButton disabled={!selectedRole || missingRequiredScope} locale={defaultLocale} />
      </div>
    </form>
  );
}
