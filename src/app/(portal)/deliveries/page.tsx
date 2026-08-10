import { PageHeader } from "@/components/PageHeader";
import { DeliverySupervisorPanel } from "@/components/role-portals/DeliverySupervisorPanel";
import { DeliveryTrackingBoard } from "@/components/role-portals/DeliveryTrackingPanels";
import { requirePagePermission } from "@/lib/auth";
import { deliveryTrackingMessages } from "@/lib/delivery-tracking-i18n";
import { deliveryWorkflowMessages } from "@/lib/delivery-workflow-i18n";
import { canAccess } from "@/lib/permissions";

export default async function DeliveriesPage() {
  const actor = await requirePagePermission("view_deliveries");
  const canManage = canAccess(actor, "manage_deliveries");
  const workflowCopy = deliveryWorkflowMessages(actor.preferredLocale);
  const trackingCopy = deliveryTrackingMessages(actor.preferredLocale);
  return <>
    <PageHeader
      eyebrow="P1-08 · P1-09 · P1-10"
      title={canManage ? workflowCopy.supervisorTitle : trackingCopy.companyTitle}
      description={canManage ? workflowCopy.supervisorIntro : trackingCopy.companyExplanation}
    />
    {canManage
      ? <DeliverySupervisorPanel locale={actor.preferredLocale} />
      : <DeliveryTrackingBoard audience="company" locale={actor.preferredLocale} />}
  </>;
}
