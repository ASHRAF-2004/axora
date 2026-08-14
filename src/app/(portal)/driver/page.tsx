import { PageHeader } from "@/components/PageHeader";
import { DriverOfflineWorkspace } from "@/components/role-portals/DriverOfflineWorkspace";
import { requirePagePermission } from "@/lib/auth";
import { rolePortalMessages } from "@/lib/role-portals-i18n";
import { AvailableDeliveryJobs } from "@/components/role-portals/AvailableDeliveryJobs";

export default async function DriverPage() {
  const actor = await requirePagePermission("view_delivery_portal");
  const locale = actor.preferredLocale ?? "en";
  const copy = rolePortalMessages(locale).driver;
  return (
    <>
      <PageHeader
        eyebrow={copy.eyebrow}
        title={copy.title}
        description={copy.description}
      />
      <AvailableDeliveryJobs locale={locale} />
      <DriverOfflineWorkspace locale={locale} />
    </>
  );
}
