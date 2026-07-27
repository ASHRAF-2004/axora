import { PageHeader } from "@/components/PageHeader";
import { requirePagePermission } from "@/lib/auth";
import { isDemoMode } from "@/lib/db";
import { listCompanies } from "@/lib/repository";
import { COD_PAYMENT_METHOD } from "@/lib/types";
import { Building2, Clock3, Coins, Database, FileCheck2, KeyRound, ShieldCheck, UserRoundCog } from "lucide-react";

export default async function SettingsPage() {
  const actor = await requirePagePermission("manage_settings");
  const companies = await listCompanies(actor);
  const workspace = actor.isOwner ? "All approved companies" : companies[0]?.name ?? "Assigned company";

  return <><PageHeader eyebrow="System control" title="Settings and security" description="Review the configuration that controls your Axora workspace." />
    <section className="dashboard-grid"><article className="panel"><div className="panel-header"><div><h2>Workspace configuration</h2><p>Current operating defaults</p></div></div><div className="panel-body readiness-list">
      <div className="readiness-item"><Building2 /><div><strong>Workspace</strong><p>{workspace}</p></div></div>
      <div className="readiness-item"><Clock3 /><div><strong>Time zone</strong><p>Malaysia time · Asia/Kuala_Lumpur (UTC+8)</p></div></div>
      <div className="readiness-item"><Coins /><div><strong>Currency</strong><p>Malaysian ringgit (MYR)</p></div></div>
      <div className="readiness-item"><Database /><div><strong>Payment method</strong><p>{COD_PAYMENT_METHOD}</p></div></div>
    </div></article><article className="panel"><div className="panel-header"><div><h2>Access and data protection</h2><p>Security rules currently enforced</p></div></div><div className="panel-body readiness-list">
      <div className="readiness-item"><ShieldCheck /><div><strong>Company isolation</strong><p>Users can access records only for their assigned company. The platform owner can administer all companies.</p></div></div>
      <div className="readiness-item"><UserRoundCog /><div><strong>Role and branch permissions</strong><p>Requesters submit, authorised approvers decide, branch administrators manage one location, and company administrators manage the whole customer workspace.</p></div></div>
      <div className="readiness-item"><KeyRound /><div><strong>Protected accounts</strong><p>The owner, current signed-in user, and each company&apos;s last administrator cannot be deactivated accidentally.</p></div></div>
      <div className="readiness-item"><FileCheck2 /><div><strong>Document limits</strong><p>Uploads are restricted by company, file type, and a maximum size of 2 MB.</p></div></div>
    </div></article></section>
    <section className="panel" style={{ marginTop: 17 }}><div className="panel-header"><div><h3>Current execution mode</h3><p>Environment used by this installation</p></div></div><div className="panel-body"><div className="callout"><strong>{isDemoMode() ? "Local sample mode" : "Axora production mode"}</strong><p>{isDemoMode() ? "Sample records are stored in memory and reset when the local server restarts." : "Records are stored in PostgreSQL. Changes are persistent and company access controls are active."}</p></div></div></section>
  </>;
}
