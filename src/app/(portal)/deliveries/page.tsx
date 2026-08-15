import { PageHeader } from "@/components/PageHeader";
import { ManageDriversPanel } from "@/components/role-portals/ManageDriversPanel";
import { DeliveryTrackingBoard } from "@/components/role-portals/DeliveryTrackingPanels";
import { requirePagePermission } from "@/lib/auth";
import { getDriverManagementWorkspace } from "@/lib/driver-operations";
import { deliveryTrackingMessages } from "@/lib/delivery-tracking-i18n";
import { canAccess } from "@/lib/permissions";
import { driverManagementMessages } from "@/lib/driver-management-i18n";

export default async function DeliveriesPage() {
  const actor = await requirePagePermission("view_deliveries");
  const canManage = canAccess(actor, "manage_deliveries");
  const copy = deliveryTrackingMessages(actor.preferredLocale);
  if (canManage) {
    const workspace = await getDriverManagementWorkspace(actor);
    const management = driverManagementMessages(actor.preferredLocale);
    return <>
      <PageHeader eyebrow={management.eyebrow} title={management.title} description={management.intro} />
      <ManageDriversPanel initialWorkspace={workspace} locale={actor.preferredLocale} />
    </>;
  }
  return <>
    <PageHeader eyebrow={copy.companyTitle} title={copy.companyTitle} description={copy.companyExplanation} />
    <DeliveryTrackingBoard locale={actor.preferredLocale} />
  </>;
}
