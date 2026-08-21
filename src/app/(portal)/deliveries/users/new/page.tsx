import Link from "next/link";
import { notFound } from "next/navigation";

import { createDeliveryUserAction } from "@/app/(portal)/users/actions";
import { PageHeader } from "@/components/PageHeader";
import { UserCreateForm } from "@/components/UserCreateForm";
import {
  creationPermissionOptions,
  defaultPermissionsForRole,
} from "@/lib/authorization-policy";
import { requirePagePermission } from "@/lib/auth";
import { peopleWorkspaceMessages } from "@/lib/people-workspaces-i18n";
import { accountRoleDefinition, creatableAccountRoles } from "@/lib/role-catalog";

export default async function NewDeliveryUserPage() {
  const actor = await requirePagePermission("create_delivery_users");
  if (!actor.isOwner || actor.accountKind !== "PLATFORM") notFound();
  const locale = actor.preferredLocale ?? "en";
  const copy = peopleWorkspaceMessages(locale);
  const roleOptions = creatableAccountRoles(actor)
    .filter((role) => accountRoleDefinition(role.key)?.accountKind === "DELIVERY")
    .map((role) => {
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
        defaultPermissions: defaults,
        customizablePermissions: creationPermissionOptions(
          role.accountKind,
          defaults,
          actor.isOwner,
        ),
      };
    });

  return <>
    <PageHeader
      eyebrow={copy.deliveryEyebrow}
      title={copy.createDelivery}
      description={copy.deliveryDescription}
    />
    <section className="detail-grid">
      <article className="panel form-panel">
        <UserCreateForm
          createAction={createDeliveryUserAction}
          creationContext="DELIVERY"
          actorIsOwner={actor.isOwner}
          defaultLocale={locale}
          branches={[]}
          companies={[]}
          departments={[]}
          roleOptions={roleOptions}
          canCustomizePermissions
        />
      </article>
      <aside className="panel">
        <p>{copy.deliveryDescription}</p>
        <Link className="button button-secondary" href="/deliveries">
          {copy.backDelivery}
        </Link>
      </aside>
    </section>
  </>;
}
