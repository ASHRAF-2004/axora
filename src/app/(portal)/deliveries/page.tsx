import { PageHeader } from "@/components/PageHeader";
import { ManageDriversPanel } from "@/components/role-portals/ManageDriversPanel";
import { DeliveryTrackingBoard } from "@/components/role-portals/DeliveryTrackingPanels";
import { requirePagePermission } from "@/lib/auth";
import { getDriverManagementWorkspace } from "@/lib/driver-operations";
import { deliveryTrackingMessages } from "@/lib/delivery-tracking-i18n";
import { canAccess } from "@/lib/permissions";
import { driverManagementMessages } from "@/lib/driver-management-i18n";
import { peopleWorkspaceMessages } from "@/lib/people-workspaces-i18n";
import { corePortalMessages } from "@/lib/core-portal-i18n";
import Link from "next/link";

export default async function DeliveriesPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string }>;
}) {
  const actor = await requirePagePermission("view_deliveries");
  const locale = actor.preferredLocale ?? "en";
  const canManage = canAccess(actor, "manage_deliveries");
  const copy = deliveryTrackingMessages(locale);
  if (canManage) {
    const [workspace, parameters] = await Promise.all([
      getDriverManagementWorkspace(actor),
      searchParams,
    ]);
    const management = driverManagementMessages(locale);
    const people = peopleWorkspaceMessages(locale);
    const standardNotice = parameters.notice
      ? corePortalMessages(locale).notices[parameters.notice]
      : undefined;
    const localNotice = parameters.notice === "user-creation-invalid"
      ? { message: people.invalidDeliveryUser, tone: "error" as const }
      : parameters.notice === "user-permission-selection-unavailable"
        ? { message: people.unavailablePermissions, tone: "error" as const }
        : undefined;
    const notice = standardNotice ?? localNotice;
    return <>
      <PageHeader eyebrow={management.eyebrow} title={management.title} description={management.intro} />
      {actor.isOwner && canAccess(actor, "create_delivery_users")
        ? <div className="page-actions">
            <Link className="button button-primary" href="/deliveries/users/new">
              {people.createDelivery}
            </Link>
          </div>
        : null}
      {notice ? <div className={notice.tone === "error" ? "form-alert" : "callout"} role={notice.tone === "error" ? "alert" : "status"}>
        <strong>{notice.message}</strong>
      </div> : null}
      <ManageDriversPanel initialWorkspace={workspace} locale={locale} />
    </>;
  }
  return <>
    <PageHeader eyebrow={copy.companyTitle} title={copy.companyTitle} description={copy.companyExplanation} />
    <DeliveryTrackingBoard locale={locale} />
  </>;
}
