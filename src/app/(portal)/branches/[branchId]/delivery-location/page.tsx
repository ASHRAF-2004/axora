import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";

import { BranchDeliveryLocationForm } from "@/components/BranchDeliveryLocationForm";
import { PageHeader } from "@/components/PageHeader";
import { requirePagePermission } from "@/lib/auth";
import { branchDeliveryLocationMessages } from "@/lib/branch-delivery-location-i18n";
import { loadBranchDeliveryLocationWorkspace } from "@/lib/branch-delivery-location";

export default async function BranchDeliveryLocationPage({
  params,
}: {
  params: Promise<{ branchId: string }>;
}) {
  const actor = await requirePagePermission("view_branches");
  const locale = actor.preferredLocale ?? "en";
  const copy = branchDeliveryLocationMessages(locale);
  const { branchId } = await params;
  const workspace = await loadBranchDeliveryLocationWorkspace(actor, branchId);
  if (!workspace) notFound();
  const location = workspace.location;
  const commandId = randomUUID();

  return <>
    <PageHeader
      eyebrow={copy.eyebrow}
      title={`${workspace.branchName} · ${copy.pageTitle}`}
      description={copy.pageDescription}
    />
    <div className="page-actions">
      <Link className="button button-secondary" href={`/branches/${workspace.branchId}`}>{copy.backToBranch}</Link>
    </div>
    {workspace.canManage ? <BranchDeliveryLocationForm
      addressLabel={location?.addressLabel ?? ""}
      branchId={workspace.branchId}
      commandId={commandId}
      coordinates={location?.coordinates ?? null}
      instructions={location?.instructions}
      key={commandId}
      locale={locale}
    /> : <section className="panel form-panel">
      <p className="callout">{copy.readOnly}</p>
      <dl className="summary-list">
        <div><dt>{copy.addressLabel}</dt><dd>{location?.addressLabel ?? "—"}</dd></div>
        <div><dt>{copy.latitude}</dt><dd>{location?.coordinates?.latitude ?? copy.noCoordinates}</dd></div>
        <div><dt>{copy.longitude}</dt><dd>{location?.coordinates?.longitude ?? copy.noCoordinates}</dd></div>
        <div><dt>{copy.instructions}</dt><dd>{location?.instructions ?? "—"}</dd></div>
        <div><dt>{copy.lastUpdated}</dt><dd>{location ? new Intl.DateTimeFormat(locale, {
          dateStyle: "medium",
          timeStyle: "short",
          timeZone: actor.timezone ?? "Asia/Kuala_Lumpur",
        }).format(location.updatedAt) : "—"}</dd></div>
      </dl>
    </section>}
  </>;
}
