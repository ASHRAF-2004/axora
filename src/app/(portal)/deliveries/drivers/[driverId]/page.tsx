import Link from "next/link";
import { randomUUID } from "node:crypto";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/PageHeader";
import { DriverLiveMap } from "@/components/role-portals/DriverLiveMap";
import { requirePagePermission } from "@/lib/auth";
import { driverManagementMessages } from "@/lib/driver-management-i18n";
import { getDriverDetailWorkspace } from "@/lib/driver-operations";
import { removeUserAction, setUserActiveAction } from "@/app/(portal)/users/actions";
import { releaseStuckDeliveryJobAction, requestDriverPasswordResetAction } from "../../driver-actions";
import { canAccess } from "@/lib/permissions";
import { peopleWorkspaceMessages } from "@/lib/people-workspaces-i18n";

export default async function DriverDetailPage({ params }: { params: Promise<{ driverId: string }> }) {
  const actor = await requirePagePermission("manage_deliveries");
  const locale = actor.preferredLocale ?? "en";
  const copy = driverManagementMessages(locale);
  const people = peopleWorkspaceMessages(locale);
  const { driverId } = await params;
  const driver = await getDriverDetailWorkspace(actor, driverId).catch(() => null);
  if (!driver) notFound();
  const activeJob = driver.jobs.find((job) => !["COMPLETED", "CANCELLED", "FAILED", "RETURNED"].includes(job.status));
  const completed = driver.jobs.filter((job) => job.status === "COMPLETED");
  const latest = driver.locations.at(-1);
  const recovery = driver.recoveryEligibility;
  const date = (value: string) => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
  return <>
    <PageHeader eyebrow={copy.title} title={driver.name} description={copy.intro} />
    <div className="page-actions"><Link className="button button-secondary" href="/deliveries">{copy.back}</Link></div>
    <section className="detail-grid">
      <article className="panel"><h2>{copy.profile}</h2><dl className="summary-list"><div><dt>{copy.contact}</dt><dd>{driver.email}<br />{driver.phone || "—"}</dd></div><div><dt>{copy.state}</dt><dd>{driver.active ? copy.active : copy.deactivated} · {driver.availability}</dd></div><div><dt>{copy.vehicle}</dt><dd>{driver.vehicle || copy.notRecorded}</dd></div><div><dt>{copy.current}</dt><dd>{activeJob ? `${activeJob.code} · ${activeJob.status}` : copy.none}</dd></div><div><dt>{copy.location}</dt><dd>{latest ? `${date(latest.capturedAt)} · ±${Math.round(latest.accuracy)} m` : copy.noLocation}</dd></div></dl></article>
      <article className="panel"><h2>{copy.actions}</h2>{activeJob ? <><p className={recovery?.eligible ? "callout callout-warning" : "callout"}>{recovery?.reason ?? copy.blocked}</p><details><summary>{copy.recover}</summary><form action={releaseStuckDeliveryJobAction.bind(null, activeJob.id)} className="table-action-stack"><input type="hidden" name="driverId" value={driver.id} /><input type="hidden" name="commandId" value={randomUUID()} /><label>{copy.reason}<textarea name="reason" required minLength={3} maxLength={1000} /></label><button className="button button-secondary" disabled={!recovery?.eligible} type="submit">{copy.release}</button></form></details></> : null}<div className="table-action-stack">{canAccess(actor, "manage_users") ? <Link className="button button-secondary" href={`/users/${driver.id}/access`}>{people.openAccess}</Link> : null}<form action={requestDriverPasswordResetAction.bind(null, driver.id)}><button className="button button-secondary" type="submit">{copy.reset}</button></form><form action={setUserActiveAction.bind(null, driver.id, !driver.active)}><button className="button button-secondary" disabled={Boolean(activeJob)} type="submit">{driver.active ? copy.deactivate : copy.activate}</button></form><details><summary>{copy.delete}</summary><form action={removeUserAction.bind(null, driver.id)} className="table-action-stack"><label>{copy.reason}<input name="reason" required minLength={3} maxLength={500} /></label><label><input name="confirmRemoval" type="checkbox" value="confirmed" required /> {copy.confirm}</label><button className="button button-secondary" disabled={Boolean(activeJob)} type="submit">{copy.delete}</button></form></details></div></article>
    </section>
    <DriverLiveMap driverId={driver.id} points={driver.locations} locale={locale} />
    <section className="panel"><h2>{copy.history}</h2>{completed.length ? <div className="data-table-wrap"><table className="data-table"><thead><tr><th>{copy.current}</th><th>{copy.company}</th><th>{copy.branch}</th><th>{copy.completed}</th></tr></thead><tbody>{completed.map((job) => <tr key={job.id}><td>{job.code}</td><td>{job.companyName}</td><td>{job.branchName}</td><td>{job.endedAt ? date(job.endedAt) : "—"}</td></tr>)}</tbody></table></div> : <p>{copy.noHistory}</p>}</section>
  </>;
}
