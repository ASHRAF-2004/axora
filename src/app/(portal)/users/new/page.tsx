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
import { notFound } from "next/navigation";
import { createAxoraUserAction } from "../actions";
import { isMvpVisiblePermission } from "@/lib/mvp-permissions";

export default async function NewUserPage() {
  const actor = await requirePagePermission("manage_users");
  if (!actor.isOwner || actor.accountKind !== "PLATFORM") notFound();
  const locale = actor.preferredLocale ?? "en";
  const copy = peopleWorkspaceMessages(locale);
  const roles = creatableAccountRoles(actor).filter((role) => (
    accountRoleDefinition(role.key)?.accountKind === "PLATFORM"
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
  return <>
    <PageHeader eyebrow={copy.axoraEyebrow} title={copy.createAxora} description={copy.axoraDescription} />
    <section className="detail-grid">
      <article className="panel form-panel">
        <UserCreateForm createAction={createAxoraUserAction} creationContext="PLATFORM" actorBranchId={actor.branchId} actorCompanyId={actor.companyId} actorDepartmentId={actor.departmentId} actorIsOwner={actor.isOwner} defaultLocale={locale} branches={[]} companies={[]} departments={[]} roleOptions={roleOptions} canCustomizePermissions />
      </article>
      <aside className="panel"><p>{copy.axoraDescription}</p><Link className="button button-secondary" href="/users">{copy.axoraTitle}</Link></aside>
    </section>
  </>;
}
