import { PageHeader } from "@/components/PageHeader";
import { BookOpenCheck, CircleHelp, ClipboardPlus, LayoutDashboard, PackageSearch, Server } from "lucide-react";

export default function HelpPage() {
  return <><PageHeader eyebrow="Quick guide" title="How to use Axora" description="A simple path for daily operations. The detailed Ubuntu and server instructions are supplied as a separate illustrated PDF." />
    <section className="dashboard-grid"><article className="panel"><div className="panel-header"><div><h2>Daily user workflow</h2><p>Follow these steps in order</p></div></div><div className="panel-body readiness-list">
      <div className="readiness-item"><PackageSearch /><div><strong>1. Check master data</strong><p>Search Products and Suppliers before creating anything new.</p></div></div>
      <div className="readiness-item"><ClipboardPlus /><div><strong>2. Create the request</strong><p>Select the company and branch, then add one or more product lines.</p></div></div>
      <div className="readiness-item"><BookOpenCheck /><div><strong>3. Update the workflow</strong><p>Open the request and move it through quotation, approval, supplier, delivery and invoice stages.</p></div></div>
      <div className="readiness-item"><LayoutDashboard /><div><strong>4. Check reporting</strong><p>Confirm attention items and reconcile totals before sharing figures.</p></div></div>
    </div></article><article className="panel"><div className="panel-header"><div><h2>Important rules</h2><p>Keep the pilot safe and understandable</p></div></div><div className="panel-body readiness-list">
      <div className="readiness-item"><CircleHelp /><div><strong>Never invent master data</strong><p>If a contact, price or supplier is unknown, leave it pending and verify it.</p></div></div>
      <div className="readiness-item"><CircleHelp /><div><strong>Do not delete history</strong><p>Deactivate master records and cancel requests with a reason.</p></div></div>
      <div className="readiness-item"><Server /><div><strong>No public internet exposure</strong><p>The first deployment is for the approved office LAN only.</p></div></div>
    </div></article></section>
  </>;
}
