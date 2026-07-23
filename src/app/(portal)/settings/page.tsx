import { PageHeader } from "@/components/PageHeader";
import { isDemoMode } from "@/lib/db";
import { CheckCircle2, CircleDotDashed, Database, HardDrive, KeyRound, Network, ShieldCheck } from "lucide-react";

export default function SettingsPage() {
  return <><PageHeader eyebrow="System control" title="Readiness and settings" description="The software package is prepared here. Hardware, LAN and recovery checks remain deliberately separated for the Ubuntu server stage." />
    <section className="dashboard-grid"><article className="panel"><div className="panel-header"><div><h2>Prepared in this package</h2><p>Safe to complete before the server PC exists</p></div></div><div className="panel-body readiness-list">
      <div className="readiness-item"><CheckCircle2 /><div><strong>Application and navigation</strong><p>Dashboard, masters, multi-item requests, detail workflow, reports and help.</p></div></div>
      <div className="readiness-item"><Database /><div><strong>PostgreSQL schema</strong><p>Normalized master data, orders, lines, quotations, deliveries, invoices, payments and audit history.</p></div></div>
      <div className="readiness-item"><ShieldCheck /><div><strong>Container security design</strong><p>Only Caddy publishes a LAN port; the app and database remain on private Docker networks.</p></div></div>
      <div className="readiness-item"><HardDrive /><div><strong>Backup and restore scripts</strong><p>Logical dumps, checksums, retention and a separate restore-test workflow.</p></div></div>
    </div></article><article className="panel"><div className="panel-header"><div><h2>Do later on the server PC</h2><p>Requires the new SSD or the real office network</p></div></div><div className="panel-body readiness-list">
      <div className="readiness-item"><CircleDotDashed /><div><strong>Install Ubuntu and Docker</strong><p>Run only after the new SSD is installed.</p></div></div>
      <div className="readiness-item"><Network /><div><strong>Reserve the LAN address</strong><p>Confirm the real subnet, Ethernet interface and internal hostname.</p></div></div>
      <div className="readiness-item"><KeyRound /><div><strong>Create production secrets</strong><p>Generate them directly on Ubuntu; never copy the local demonstration password.</p></div></div>
      <div className="readiness-item"><HardDrive /><div><strong>Run physical recovery tests</strong><p>Reboot the PC and restore a backup to a clean test database.</p></div></div>
    </div></article></section>
    <section className="panel" style={{ marginTop: 17 }}><div className="panel-header"><div><h3>Current execution mode</h3><p>Shown in the top navigation bar</p></div></div><div className="panel-body"><div className="callout"><strong>{isDemoMode() ? "Safe demonstration mode" : "PostgreSQL production mode"}</strong><p>{isDemoMode() ? "All visible names and records are sanitized samples stored in memory. Restarting the local development server resets them." : "Records are read from the Axora PostgreSQL database. Changes are persistent and must be backed up."}</p></div></div></section>
  </>;
}
