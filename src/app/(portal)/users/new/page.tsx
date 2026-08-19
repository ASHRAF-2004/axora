import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { UserCreateForm } from "@/components/UserCreateForm";
import { requirePagePermission } from "@/lib/auth";
import { defaultPermissionsForRole } from "@/lib/authorization-policy";
import { corePortalMessages } from "@/lib/core-portal-i18n";
import { loadOrganizationDirectory } from "@/lib/organization-access";
import { loadOrganizationStructureWorkspace } from "@/lib/organization-structure";
import { creatableAccountRoles } from "@/lib/role-catalog";
import { STANDARD_BILLING_TERMS, type Branch, type Company } from "@/lib/types";

export default async function NewUserPage() {
  const actor = await requirePagePermission("manage_users");
  const locale = actor.preferredLocale ?? "en";
  const copy = corePortalMessages(locale).users;
  const [organization, structure] = await Promise.all([
    loadOrganizationDirectory(actor),
    loadOrganizationStructureWorkspace(actor),
  ]);
  const companies: Company[] = organization.companies.map((company) => ({ ...company, paymentTerms: STANDARD_BILLING_TERMS }));
  const branches: Branch[] = organization.branches.map((branch) => ({ ...branch, committedAmount: branch.committedAmount ?? 0 }));
  const roles = creatableAccountRoles(actor);
  return <>
    <PageHeader eyebrow={copy.eyebrow} title={copy.create} description={copy.description} />
    <section className="detail-grid">
      <article className="panel form-panel">
        <UserCreateForm actorBranchId={actor.branchId} actorCompanyId={actor.companyId} actorDepartmentId={actor.departmentId} actorIsOwner={actor.isOwner} defaultLocale={locale} branches={branches} companies={companies} departments={structure.departments} roleOptions={roles.map((role) => ({ value: role.key, label: role.label, description: role.description, category: role.category, defaultPermissions: defaultPermissionsForRole(role.key, role.allowedScopes[0], role.key === "PLATFORM_OWNER") }))} />
      </article>
      <aside className="panel"><h2>{copy.smallestRole}</h2><p>{copy.smallestRoleBody}</p><Link className="button button-secondary" href="/users">Back</Link></aside>
    </section>
  </>;
}
