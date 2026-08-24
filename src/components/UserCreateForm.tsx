"use client";

import { createUserAction } from "@/app/(portal)/users/actions";
import type { Branch, Company, UserRole } from "@/lib/types";
import { useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import { LOCALE_NAMES, SUPPORTED_LOCALES, type SupportedLocale } from "@/lib/i18n";
import { userFormMessages } from "@/lib/user-form-i18n";
import type { OrganizationDepartment } from "@/lib/organization-structure";
import type { PermissionCode } from "@/lib/authorization-policy";
import {
  accessGroupsForPermissions,
  userProvisioningRoleConfig,
} from "@/lib/user-provisioning";
import {
  PermissionChecklist,
  type PermissionChecklistOption,
} from "@/components/PermissionChecklist";

export interface UserRoleOption {
  label: string;
  value: UserRole;
  description: string;
  category: "Axora" | "Company" | "Delivery";
  defaultPermissions?: readonly PermissionCode[];
  customizablePermissions?: readonly PermissionChecklistOption[];
}

function CreateAccountButton({ disabled, locale }: { disabled: boolean; locale: SupportedLocale }) {
  const { pending } = useFormStatus();
  const copy = userFormMessages(locale);
  return (
    <button className="button button-primary" type="submit" disabled={disabled || pending} aria-busy={pending} data-feedback-label={copy.creating}>
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
  defaultLocale,
  creationContext,
  fixedCompanyId,
  canCustomizePermissions = false,
  createAction = createUserAction,
}: {
  actorBranchId?: string;
  actorCompanyId?: string;
  actorDepartmentId?: string;
  actorIsOwner: boolean;
  branches: Branch[];
  companies: Company[];
  departments: OrganizationDepartment[];
  roleOptions: UserRoleOption[];
  defaultLocale: SupportedLocale;
  creationContext?: "PLATFORM" | "COMPANY" | "DELIVERY";
  fixedCompanyId?: string;
  canCustomizePermissions?: boolean;
  createAction?: (formData: FormData) => void | Promise<void>;
}) {
  const [role, setRole] = useState<UserRole | "">("");
  const [companyId, setCompanyId] = useState(fixedCompanyId ?? actorCompanyId ?? "");
  const [branchId, setBranchId] = useState(actorBranchId ?? "");
  const [departmentId, setDepartmentId] = useState(actorDepartmentId ?? "");
  const requesterScopeFixedToDepartment = Boolean(actorDepartmentId) && !actorIsOwner;
  const [requesterScope, setRequesterScope] = useState<"BRANCH" | "DEPARTMENT">(
    requesterScopeFixedToDepartment ? "DEPARTMENT" : "BRANCH",
  );
  const [roleChanged, setRoleChanged] = useState(false);
  const [customizePermissions, setCustomizePermissions] = useState(false);
  const [selectedPermissions, setSelectedPermissions] = useState<Set<PermissionCode>>(
    new Set(),
  );
  const copy = userFormMessages(defaultLocale);
  const selectedRole = roleOptions.find((option) => option.value === role);
  const config = role ? userProvisioningRoleConfig(role) : undefined;

  const availableBranches = useMemo(() => branches.filter((branch) => (
    branch.status === "Active" && branch.companyId === companyId
  )), [branches, companyId]);
  const availableDepartments = useMemo(() => departments.filter((department) => (
    department.active
    && department.companyId === companyId
    && (!branchId || department.branchId === branchId)
  )), [departments, companyId, branchId]);

  const effectiveScope = role === "REQUESTER" ? requesterScope : config?.creationScopes[0];
  const showCompany = Boolean(config?.showCompany);
  const showBranch = Boolean(config?.showBranch && effectiveScope !== "COMPANY");
  const showDepartment = Boolean(config?.showDepartment && effectiveScope === "DEPARTMENT");
  const companyFixed = showCompany && Boolean(fixedCompanyId || (actorCompanyId && !actorIsOwner));
  const branchFixed = showBranch && Boolean(actorBranchId) && !actorIsOwner;
  const departmentFixed = showDepartment && Boolean(actorDepartmentId) && !actorIsOwner;

  const accessGroups = selectedRole
    ? accessGroupsForPermissions(selectedRole.defaultPermissions ?? [])
    : [];
  const localizedRole = role ? copy.roles[role] : undefined;
  const categoryGroups = (["Axora", "Company", "Delivery"] as const)
    .map((category) => ({ category, options: roleOptions.filter((option) => option.category === category) }))
    .filter((group) => group.options.length > 0);

  function resetOrganizationForRole(nextRole: UserRole) {
    const nextConfig = userProvisioningRoleConfig(nextRole);
    setCompanyId(nextConfig?.showCompany ? fixedCompanyId ?? actorCompanyId ?? "" : "");
    setBranchId(nextConfig?.showBranch ? actorBranchId ?? "" : "");
    setDepartmentId(nextConfig?.showDepartment ? actorDepartmentId ?? "" : "");
    const firstScope = nextConfig?.creationScopes[0];
    setRequesterScope(requesterScopeFixedToDepartment || firstScope === "DEPARTMENT"
      ? "DEPARTMENT"
      : "BRANCH");
  }

  function changeRole(nextRole: UserRole | "") {
    if (!nextRole) {
      setRole("");
      setCompanyId("");
      setBranchId("");
      setDepartmentId("");
      setCustomizePermissions(false);
      setSelectedPermissions(new Set());
      return;
    }
    if (role && role !== nextRole) setRoleChanged(true);
    setRole(nextRole);
    resetOrganizationForRole(nextRole);
    setCustomizePermissions(false);
    const defaults = roleOptions.find((option) => option.value === nextRole)
      ?.defaultPermissions ?? [];
    setSelectedPermissions(new Set(defaults));
  }

  function changeCompany(nextCompanyId: string) {
    setCompanyId(nextCompanyId);
    setBranchId("");
    setDepartmentId("");
  }

  function changeBranch(nextBranchId: string) {
    setBranchId(nextBranchId);
    setDepartmentId("");
  }

  function changeRequesterScope(nextScope: "BRANCH" | "DEPARTMENT") {
    setRequesterScope(nextScope);
    setDepartmentId("");
  }

  const scopeReady = !config ? false
    : showCompany && !companyId ? false
      : showBranch && !branchId ? false
        : showDepartment && !departmentId ? false
          : true;

  return (
    <form action={createAction} data-draft-id="create-user">
      <input type="hidden" name="creationContext" value={creationContext ?? (fixedCompanyId || actorCompanyId ? "COMPANY" : "PLATFORM")} />
      {customizePermissions
        ? <input type="hidden" name="permissionsCustomized" value="true" />
        : null}
      <div className="form-grid">
        <label>{copy.fullName}<input name="displayName" required autoComplete="name" /></label>
        <label>{copy.workEmail}<input name="email" type="email" required autoComplete="username" /></label>
        <label>{copy.jobTitle} <span className="subtle">({copy.optional})</span>
          <input name="jobTitle" maxLength={160} autoComplete="organization-title" />
        </label>
        <label>{copy.invitationLanguage}
          <select name="preferredLocale" defaultValue={defaultLocale}>
            {SUPPORTED_LOCALES.map((locale) => <option key={locale} value={locale}>{LOCALE_NAMES[locale].native}</option>)}
          </select>
          <small>{copy.languageHelp}</small>
        </label>
        <label className="field-full">{copy.role}
          <select name="role" required value={role} onChange={(event) => changeRole(event.target.value as UserRole | "")}>
            <option value="">{copy.selectRole}</option>
            {categoryGroups.map((group) => (
              <optgroup key={group.category} label={copy.categories[group.category] ?? group.category}>
                {group.options.map((option) => (
                  <option key={option.value} value={option.value}>{copy.roles[option.value]?.label ?? option.label}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>

        {roleChanged ? <div className="callout field-full" role="status" aria-live="polite">{copy.roleChanged}</div> : null}

        {selectedRole && config ? (
          <section className="panel field-full" aria-labelledby="create-role-overview-title">
            <div className="panel-header">
              <div>
                <h3 id="create-role-overview-title">{copy.roleOverview}: {localizedRole?.label ?? selectedRole.label}</h3>
                <p>{localizedRole?.description ?? selectedRole.description}</p>
              </div>
            </div>
            <div className="panel-body">
              <strong>{copy.organizationScope}</strong>
              <p className="subtle">{effectiveScope === "PLATFORM" ? copy.categories.Axora : effectiveScope === "DELIVERY" ? copy.categories.Delivery : effectiveScope === "COMPANY" ? copy.companyWide : effectiveScope === "DEPARTMENT" ? copy.departmentScope : copy.branchScope}</p>
              <strong>{copy.accessIncluded}</strong>
              <ul>
                {accessGroups.map((group) => <li key={group}>{copy.accessGroups[group] ?? group}</li>)}
              </ul>
              {canCustomizePermissions && selectedRole.customizablePermissions?.length ? (
                <div style={{ marginBlockStart: 16 }}>
                  <button
                    className="button button-secondary"
                    type="button"
                    aria-expanded={customizePermissions}
                    onClick={() => setCustomizePermissions((current) => !current)}
                  >
                    {customizePermissions ? copy.useRoleDefaults : copy.customizePermissions}
                  </button>
                  <p className="subtle">{copy.customizePermissionsHelp}</p>
                </div>
              ) : null}
            </div>
          </section>
        ) : null}

        {customizePermissions && selectedRole?.customizablePermissions?.length ? (
          <section className="panel field-full" aria-labelledby="create-user-permissions-title">
            <div className="panel-header"><div>
              <h3 id="create-user-permissions-title">{copy.customizePermissions}</h3>
              <p>{copy.customizePermissionsHelp}</p>
            </div></div>
            <div className="panel-body">
              <PermissionChecklist
                locale={defaultLocale}
                options={selectedRole.customizablePermissions}
                selected={selectedPermissions}
                onChange={setSelectedPermissions}
              />
            </div>
          </section>
        ) : null}

        {role === "REQUESTER" && config?.creationScopes.includes("DEPARTMENT")
          && !requesterScopeFixedToDepartment ? (
          <label className="field-full">{copy.assignmentLevel}
            <select value={requesterScope} onChange={(event) => changeRequesterScope(event.target.value as "BRANCH" | "DEPARTMENT")}>
              <option value="BRANCH">{copy.branchScope}</option>
              <option value="DEPARTMENT">{copy.departmentScope}</option>
            </select>
          </label>
        ) : null}

        {showCompany && !companyFixed ? (
          <label>{copy.customerCompany}
            <select name="companyId" required value={companyId} onChange={(event) => changeCompany(event.target.value)}>
              <option value="">{copy.selectCompany}</option>
              {companies.filter((company) => company.status === "Active").map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}
            </select>
          </label>
        ) : null}
        {companyFixed ? <input type="hidden" name="companyId" value={fixedCompanyId ?? actorCompanyId} /> : null}

        {showBranch && !branchFixed ? (
          <label>{copy.assignedBranch}
            <select name="branchId" required value={branchId} onChange={(event) => changeBranch(event.target.value)} disabled={!companyId}>
              <option value="">{copy.selectBranch}</option>
              {availableBranches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
            </select>
            <small>{copy.branchLimited}</small>
          </label>
        ) : null}
        {branchFixed ? <input type="hidden" name="branchId" value={actorBranchId} /> : null}

        {showDepartment && !departmentFixed ? (
          <label>{copy.department}
            <select name="departmentId" required value={departmentId} onChange={(event) => setDepartmentId(event.target.value)} disabled={!branchId}>
              <option value="">{copy.selectDepartment}</option>
              {availableDepartments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}
            </select>
          </label>
        ) : null}
        {departmentFixed ? <input type="hidden" name="departmentId" value={actorDepartmentId} /> : null}

        <div className="callout field-full" role="note">
          <strong>{copy.secureSetup}</strong>
          <p>{copy.secureSetupBody}</p>
        </div>
      </div>
      <div className="form-actions">
        <CreateAccountButton disabled={!selectedRole || !scopeReady} locale={defaultLocale} />
      </div>
    </form>
  );
}
