import { MetricCard } from "@/components/MetricCard";
import { PageHeader } from "@/components/PageHeader";
import { formatCurrency } from "@/lib/domain";
import { getDashboardData } from "@/lib/repository";
import { Banknote, Download, Percent, ReceiptText, ShieldCheck, Truck } from "lucide-react";

export default async function ReportsPage() {
  const data = await getDashboardData();
  return <><PageHeader eyebrow="Management reporting" title="Reports and reconciliation" description="Export clean request records and reconcile dashboard totals with source lines before management decisions." />
    <section className="metric-grid"><MetricCard label="Sales" value={formatCurrency(data.sales)} note="Non-cancelled request lines" icon={ReceiptText} tone="blue" /><MetricCard label="Buying cost" value={formatCurrency(data.buyingCost)} note="Quantity-adjusted" icon={Banknote} tone="navy" /><MetricCard label="Margin" value={`${data.grossMarginPercent.toFixed(1)}%`} note={formatCurrency(data.grossProfit)} icon={Percent} tone="teal" /><MetricCard label="Delivery fees" value={formatCurrency(data.deliveryCharges)} note="Reported separately" icon={Truck} tone="orange" /></section>
    <section className="dashboard-grid"><article className="panel"><div className="panel-header"><div><h2>Available exports</h2><p>UTF-8 CSV files open in Excel or LibreOffice</p></div></div><div className="panel-body readiness-list">
      <div className="readiness-item"><Download /><div><strong>Request register</strong><p>Order groups, companies, statuses, quantities, sales, costs and margin.</p><a className="table-link" href="/api/export/requests">Download requests.csv</a></div></div>
      <div className="readiness-item"><ShieldCheck /><div><strong>Company-scoped export</strong><p>The downloaded register contains only records available to your signed-in account.</p></div></div>
    </div></article><article className="panel"><div className="panel-header"><div><h3>Reconciliation rule</h3><p>Check figures before sharing them</p></div></div><div className="panel-body"><div className="callout"><strong>Reconcile totals with request lines.</strong><p>Sales and buying costs include quantity and exclude cancelled requests. Delivery fees are reported separately.</p></div></div></article></section>
  </>;
}
