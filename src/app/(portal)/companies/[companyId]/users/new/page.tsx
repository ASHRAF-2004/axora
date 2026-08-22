import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/PageHeader";
import { UserCreateForm } from "@/components/UserCreateForm";
import {
  creationPermissionOptions,
  defaultPermissionsForRole,
} from "@/lib/authorization-policy";
import { requirePagePermission } from "@/lib/auth";
import { loadOrganizationDirectory } from "@/lib/organization-access";
import { loadOrganizationStructureWorkspace } from "@/lib/organization-structure";
import {
  peopleWorkspaceMessages,
  peopleWorkspaceText,
} from "@/lib/people-workspaces-i18n";
import { accountRoleDefinition, creatableAccountRoles } from "@/lib/role-catalog";
import { STANDARD_BILLING_TERMS, type Branch, type Company } from "@/lib/types";
import { createCompanyUserAction } from "@/app/(portal)/users/actions";
import { isMvpVisiblePermission } from "@/lib/mvp-permissions";

export default async function NewCompanyUserPage({
  params,
}: {
  params: Promise<{ companyId: string }>;
}) {
  const actor = await requirePagePermission("manage_users");
  const locale = actor.preferredLocale ?? "en";
  const copy = peopleWorkspaceMessages(locale);
  const { companyId } = await params;
  const [organization, structure] = await Promise.all([
    loadOrganizationDirectory(actor),
    loadOrganizationStructureWorkspace(actor),
  ]);
  const authorizedCompany = organization.companies.find((company) => company.id === companyId);
  if (!authorizedCompany) notFound();
  const companies: Company[] = [{ ...authorizedCompany, paymentTerms: STANDARD_BILLING_TERMS }];
  const branches: Branch[] = organization.branches
    .filter((branch) => branch.companyId === companyId)
    .map((branch) => ({ ...branch, committedAmount: branch.committedAmount ?? 0 }));
  const departments = structure.departments.filter((department) => department.companyId === companyId);
  const roles = creatableAccountRoles(actor).filter((role) => (
    accountRoleDefinition(role.key)?.accountKind === "COMPANY"
  ));
  if (!roles.length) notFound();
  const roleOptions = roles.map((role) => {
    const defaults = defaultPermissionsForRole(
      role.key,
      role.allowedScopes[0],
      false,
    );
    return {
      value: role.key,
      label: role.label,
      description: role.description,
      category: role.category,
      defaultPermissions: defaults.filter((code) => isMvpVisiblePermission(role.accountKind, code)),
      customizablePermissions: creationPermissionOptions(
        role.accountKind,
        defaults,
        actor.isOwner,
      ).filter((permission) => isMvpVisiblePermission(role.accountKind, permission.code)),
    };
  });
  const description = peopleWorkspaceText(locale, "companyDescription", { company: authorizedCompany.name });
  return <>
    <PageHeader eyebrow={copy.companyEyebrow} title={`${copy.createCompany}: ${authorizedCompany.name}`} description={description} />
    <section className="detail-grid">
      <article className="panel form-panel">
        <UserCreateForm
          createAction={createCompanyUserAction.bind(null, authorizedCompany.id)}
          creationContext="COMPANY"
          fixedCompanyId={authorizedCompany.id}
          actorBranchId={actor.branchId}
          actorCompanyId={actor.companyId}
          actorDepartmentId={actor.departmentId}
          actorIsOwner={actor.isOwner}
          canCustomizePermissions
          defaultLocale={locale}
          branches={branches}
          companies={companies}
          departments={departments}
          roleOptions={roleOptions}
        />
      </article>
      <aside className="panel"><p>{description}</p><Link className="button button-secondary" href={`/companies/${authorizedCompany.id}/users`}>{copy.backUsers}</Link></aside>
    </section>
  </>;
}
