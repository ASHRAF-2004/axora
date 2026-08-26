"use client";

import { createUserAction } from "@/app/(portal)/users/actions";
import type { Branch, Company, UserRole } from "@/lib/types";
import { useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import { LOCALE_NAMES, SUPPORTED_LOCALES, type SupportedLocale } from "@/lib/i18n";
import { userFormMessages } from "@/lib/user-form-i18n";
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
  actorIsOwner,
  branches,
  companies,
  roleOptions,
  defaultLocale,
  creationContext,
  fixedCompanyId,
  canCustomizePermissions = false,
  createAction = createUserAction,
}: {
  actorBranchId?: string;
  actorCompanyId?: string;
  actorIsOwner: boolean;
  branches: Branch[];
  companies: Company[];
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
  const effectiveScope = config?.creationScopes[0];
  const showCompany = Boolean(config?.showCompany);
  const showBranch = Boolean(config?.showBranch && effectiveScope !== "COMPANY");
  const companyFixed = showCompany && Boolean(fixedCompanyId || (actorCompanyId && !actorIsOwner));
  const branchFixed = showBranch && Boolean(actorBranchId) && !actorIsOwner;

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
  }

  function changeRole(nextRole: UserRole | "") {
    if (!nextRole) {
      setRole("");
      setCompanyId("");
      setBranchId("");
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
  }

  function changeBranch(nextBranchId: string) {
    setBranchId(nextBranchId);
  }

  const scopeReady = !config ? false
    : showCompany && !companyId ? false
      : showBranch && !branchId ? false
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
