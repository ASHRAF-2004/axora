import { CompanyWorkspaceNav } from "@/components/CompanyWorkspaceNav";
import { PageHeader } from "@/components/PageHeader";
import { requirePagePermission } from "@/lib/auth";
import { findAuthorizedCompanyLifecycleRecord, loadCompanyLifecycleWorkspace } from "@/lib/company-lifecycle";
import { canAccess } from "@/lib/permissions";
import Link from "next/link";
import { notFound } from "next/navigation";

const text = {
  en: { title: "Wallet and budgets", body: "Review company funds and budget controls.", openWallet: "Open Company Wallet", openBudgets: "Open budgets", unavailable: "No wallet or budget action is available for your role." },
  ar: { title: "المحفظة والميزانيات", body: "راجع أموال الشركة وضوابط الميزانية.", openWallet: "فتح محفظة الشركة", openBudgets: "فتح الميزانيات", unavailable: "لا يتوفر إجراء للمحفظة أو الميزانية لدورك." },
  ms: { title: "Dompet dan bajet", body: "Semak dana syarikat dan kawalan bajet.", openWallet: "Buka Dompet Syarikat", openBudgets: "Buka bajet", unavailable: "Tiada tindakan dompet atau bajet tersedia untuk peranan anda." },
} as const;

export default async function CompanyWalletPage({ params }: { params: Promise<{ companyId: string }> }) {
  const actor = await requirePagePermission("manage_companies");
  const locale = actor.preferredLocale ?? "en";
  const { companyId } = await params;
  const company = findAuthorizedCompanyLifecycleRecord(await loadCompanyLifecycleWorkspace(actor), companyId);
  if (!company) notFound();
  const copy = text[locale];
  const query = `companyId=${encodeURIComponent(company.id)}`;
  const canViewWallet = canAccess(actor, "view_wallet");
  const canViewBudgets = canAccess(actor, "view_budgets");
  return <><PageHeader eyebrow={company.name} title={copy.title} description={copy.body} /><CompanyWorkspaceNav companyId={company.id} locale={locale} active="wallet" /><section className="panel">{canViewWallet || canViewBudgets ? <div className="page-actions">{canViewWallet ? <Link className="button button-primary" href={`/wallet?${query}`}>{copy.openWallet}</Link> : null}{canViewBudgets ? <Link className="button button-secondary" href={`/budgets?${query}`}>{copy.openBudgets}</Link> : null}</div> : <p>{copy.unavailable}</p>}</section></>;
}
