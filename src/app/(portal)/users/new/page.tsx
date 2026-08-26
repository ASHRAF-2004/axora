import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { UserCreateForm } from "@/components/UserCreateForm";
import { requirePagePermission } from "@/lib/auth";
import {
  creationPermissionOptions,
  defaultPermissionsForRole,
} from "@/lib/authorization-policy";
import { peopleWorkspaceMessages } from "@/lib/people-workspaces-i18n";
import { creatableAccountRoles } from "@/lib/role-catalog";
import { accountRoleDefinition } from "@/lib/role-catalog";
import { redirect } from "next/navigation";
import { createAxoraUserAction, createOwnCompanyUserAction } from "../actions";
import { isMvpVisiblePermission } from "@/lib/mvp-permissions";
import { loadOrganizationDirectory } from "@/lib/organization-access";
import { STANDARD_BILLING_TERMS, type Branch, type Company } from "@/lib/types";

export default async function NewUserPage() {
  const actor = await requirePagePermission("manage_users");
  if (actor.accountKind !== "COMPANY"
    && (!actor.isOwner || actor.accountKind !== "PLATFORM")) {
    redirect("/access-denied");
  }
  const locale = actor.preferredLocale ?? "en";
  const copy = peopleWorkspaceMessages(locale);
  const roles = creatableAccountRoles(actor).filter((role) => (
    accountRoleDefinition(role.key)?.accountKind === actor.accountKind
    && role.key !== "DEPARTMENT_ADMIN"
  ));
  const roleOptions = roles.map((role) => {
    const defaults = defaultPermissionsForRole(
      role.key,
      role.allowedScopes[0],
      role.key === "PLATFORM_OWNER",
    );
    const visibleDefaults = defaults.filter((code) => isMvpVisiblePermission(role.accountKind, code));
    return {
      value: role.key,
      label: role.label,
      description: role.description,
      category: role.category,
      defaultPermissions: visibleDefaults,
      customizablePermissions: role.key === "PLATFORM_OWNER"
        ? []
        : creationPermissionOptions(role.accountKind, defaults, actor.isOwner)
          .filter((permission) => isMvpVisiblePermission(role.accountKind, permission.code)),
    };
  });
  if (actor.accountKind === "COMPANY") {
    if (!actor.companyId) redirect("/access-denied");
    const organization = await loadOrganizationDirectory(actor);
    const authorizedCompany = organization.companies.find((company) => (
      company.id === actor.companyId && company.status === "Active"
    ));
    if (!authorizedCompany) redirect("/access-denied");
    const companies: Company[] = [{
      ...authorizedCompany,
      paymentTerms: STANDARD_BILLING_TERMS,
    }];
    const branches: Branch[] = organization.branches
      .filter((branch) => branch.companyId === authorizedCompany.id)
      .map((branch) => ({ ...branch, committedAmount: branch.committedAmount ?? 0 }));
    const description = copy.companyDescription.replace("{company}", authorizedCompany.name);
    return <>
      <PageHeader eyebrow={copy.companyEyebrow} title={copy.createCompany} description={description} />
      <section className="detail-grid">
        <article className="panel form-panel">
          <UserCreateForm createAction={createOwnCompanyUserAction} creationContext="COMPANY"
            fixedCompanyId={authorizedCompany.id} actorBranchId={actor.branchId}
            actorCompanyId={actor.companyId}
            actorIsOwner={false} defaultLocale={locale} branches={branches}
            companies={companies} roleOptions={roleOptions}
            canCustomizePermissions />
        </article>
        <aside className="panel"><p>{description}</p><Link className="button button-secondary" href="/users">{copy.companyTitle}</Link></aside>
      </section>
    </>;
  }
  return <>
    <PageHeader eyebrow={copy.axoraEyebrow} title={copy.createAxora} description={copy.axoraDescription} />
    <section className="detail-grid">
      <article className="panel form-panel">
        <UserCreateForm createAction={createAxoraUserAction} creationContext="PLATFORM" actorBranchId={actor.branchId} actorCompanyId={actor.companyId} actorIsOwner={actor.isOwner} defaultLocale={locale} branches={[]} companies={[]} roleOptions={roleOptions} canCustomizePermissions />
      </article>
      <aside className="panel"><p>{copy.axoraDescription}</p><Link className="button button-secondary" href="/users">{copy.axoraTitle}</Link></aside>
    </section>
  </>;
}
