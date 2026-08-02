import { PageHeader } from "@/components/PageHeader";
import { DriverOfflineWorkspace } from "@/components/role-portals/DriverOfflineWorkspace";
import { requirePagePermission } from "@/lib/auth";
import { getDriverWorkspace } from "@/lib/role-portals-repository";
import { rolePortalMessages } from "@/lib/role-portals-i18n";

export default async function DriverPage() {
  const actor = await requirePagePermission("view_delivery_portal");
  const jobs = await getDriverWorkspace(actor);
  const locale = actor.preferredLocale ?? "en";
  const copy = rolePortalMessages(locale).driver;
  return (
    <>
      <PageHeader
        eyebrow={copy.eyebrow}
        title={copy.title}
        description={copy.description}
      />
      <DriverOfflineWorkspace actorId={actor.id} jobs={jobs} locale={locale} timeZone={actor.timezone} />
    </>
  );
}
