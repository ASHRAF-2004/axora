import { PageHeader } from "@/components/PageHeader";
import { DeliverySupervisorPanel } from "@/components/role-portals/DeliverySupervisorPanel";
import { requirePagePermission } from "@/lib/auth";
import { deliveryWorkflowMessages } from "@/lib/delivery-workflow-i18n";

export default async function DeliveriesPage() {
  const actor = await requirePagePermission("manage_deliveries");
  const copy = deliveryWorkflowMessages(actor.preferredLocale);
  return <>
    <PageHeader
      eyebrow="P1-08 · P1-09 · P1-10"
      title={copy.supervisorTitle}
      description={copy.supervisorIntro}
    />
    <DeliverySupervisorPanel />
  </>;
}
