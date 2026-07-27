import { PageHeader } from "@/components/PageHeader";
import { requireSession } from "@/lib/auth";
import {
  BookOpenCheck,
  Building2,
  ClipboardCheck,
  ClipboardPlus,
  Download,
  ImageUp,
  PackageSearch,
  ShieldCheck,
  Truck,
  UserRoundCog,
  WalletCards,
} from "lucide-react";

export default async function HelpPage() {
  const actor = await requireSession();

  if (actor.isOwner) {
    return <><PageHeader eyebrow="Platform owner guide" title="How Axora operates"
      description="Axora owns the marketplace catalog and supplier relationship, then fulfils requests that customer companies approve." />
      <section className="panel" style={{ marginBottom: 17 }}>
        <div className="panel-header"><div><h2>Illustrated owner manuals</h2><p>Open the step-by-step guide in English or Arabic.</p></div>
          <div className="toolbar-group">
            <a className="button button-secondary" href="/manuals/axora-owner-admin-manual-en.pdf" target="_blank" rel="noreferrer"><Download size={16} /> English PDF</a>
            <a className="button button-secondary" href="/manuals/axora-owner-admin-manual-ar.pdf" target="_blank" rel="noreferrer"><Download size={16} /> العربية PDF</a>
          </div>
        </div>
      </section>
      <section className="dashboard-grid">
        <article className="panel"><div className="panel-header"><div><h2>Owner workflow</h2><p>Set up once, then fulfil approved demand</p></div></div><div className="panel-body readiness-list">
          <div className="readiness-item"><Building2 /><div><strong>1. Onboard the company</strong><p>Create the approved company, its first branch, and a named company administrator account.</p></div></div>
          <div className="readiness-item"><PackageSearch /><div><strong>2. Maintain Axora suppliers</strong><p>Add supplier contacts and terms in the private global supplier register. Customers never see this data.</p></div></div>
          <div className="readiness-item"><ImageUp /><div><strong>3. Publish catalog products</strong><p>Create each product with its customer price, description, searchable name, and a clear image. Internal buying cost stays private.</p></div></div>
          <div className="readiness-item"><ClipboardCheck /><div><strong>4. Wait for customer approval</strong><p>Do not source a new request until an authorised company approver accepts it against the branch budget.</p></div></div>
          <div className="readiness-item"><Truck /><div><strong>5. Source and fulfil</strong><p>Compare supplier quotations, select the offer with a reason, record deliveries, issue invoices, and close only after settlement.</p></div></div>
        </div></article>
        <article className="panel"><div className="panel-header"><div><h2>Owner rules</h2><p>Protect customer trust and operational evidence</p></div></div><div className="panel-body readiness-list">
          <div className="readiness-item"><ShieldCheck /><div><strong>Separation of duties</strong><p>Customers decide whether to spend; Axora decides how to source and fulfil. Platform owners do not approve customer budgets.</p></div></div>
          <div className="readiness-item"><BookOpenCheck /><div><strong>One global catalog</strong><p>Create products and suppliers once for all approved companies. Deactivate old records instead of deleting history.</p></div></div>
          <div className="readiness-item"><ImageUp /><div><strong>Useful product images</strong><p>Use a clean JPEG, PNG, or WebP image that matches the product and add concise alternative text.</p></div></div>
        </div></article>
      </section>
    </>;
  }

  return <><PageHeader eyebrow="Company user guide" title="How your company buys through Axora"
    description="Your company controls people, branches, budgets, requests, and approvals. Axora controls products, suppliers, and fulfilment." />
    <section className="panel" style={{ marginBottom: 17 }}>
      <div className="panel-header"><div><h2>Illustrated company manuals</h2><p>Open the step-by-step guide in English or Arabic.</p></div>
        <div className="toolbar-group">
          <a className="button button-secondary" href="/manuals/axora-company-user-manual-en.pdf" target="_blank" rel="noreferrer"><Download size={16} /> English PDF</a>
          <a className="button button-secondary" href="/manuals/axora-company-user-manual-ar.pdf" target="_blank" rel="noreferrer"><Download size={16} /> العربية PDF</a>
        </div>
      </div>
    </section>
    <section className="dashboard-grid">
      <article className="panel"><div className="panel-header"><div><h2>Company workflow</h2><p>Assign responsibility before the first request</p></div></div><div className="panel-body readiness-list">
        <div className="readiness-item"><Building2 /><div><strong>1. Set up branches</strong><p>The company administrator confirms delivery locations and sets a monthly purchasing budget for each branch.</p></div></div>
        <div className="readiness-item"><UserRoundCog /><div><strong>2. Create named users</strong><p>Assign Requester to employees, Approver to the authorised HR lead, manager, or CEO, and Branch administrator to the person managing one location.</p></div></div>
        <div className="readiness-item"><PackageSearch /><div><strong>3. Search the Axora catalog</strong><p>Employees find products by image, name, code, category, or brand. Products and suppliers are maintained by Axora.</p></div></div>
        <div className="readiness-item"><ClipboardPlus /><div><strong>4. Submit a purchase request</strong><p>Select the branch, items, quantities, needed-by date, and business reason. The requester is taken from the signed-in account.</p></div></div>
        <div className="readiness-item"><ClipboardCheck /><div><strong>5. Approve against budget</strong><p>A different authorised approver checks the items and remaining branch budget, then approves or rejects with a recorded decision.</p></div></div>
        <div className="readiness-item"><Truck /><div><strong>6. Track Axora fulfilment</strong><p>After approval, follow verification, sourcing, delivery, customer invoice, payment evidence, and completion.</p></div></div>
      </div></article>
      <article className="panel"><div className="panel-header"><div><h2>Company rules</h2><p>Keep purchasing controlled and easy to audit</p></div></div><div className="panel-body readiness-list">
        <div className="readiness-item"><WalletCards /><div><strong>Budget belongs to the branch</strong><p>Only the company administrator changes branch budgets. Approved requests—not drafts—commit the monthly amount.</p></div></div>
        <div className="readiness-item"><ShieldCheck /><div><strong>No self-approval</strong><p>The person who submits a purchase request cannot approve it. Assign at least one other approver to each branch.</p></div></div>
        <div className="readiness-item"><BookOpenCheck /><div><strong>Use named accounts</strong><p>Never share passwords or administrator accounts. Role controls the action; branch assignment controls the location.</p></div></div>
      </div></article>
    </section>
  </>;
}
