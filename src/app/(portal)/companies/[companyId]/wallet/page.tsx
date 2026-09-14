import { CompanyWorkspaceNav } from "@/components/CompanyWorkspaceNav";
import { WalletDetail } from "@/app/(portal)/wallet/WalletDetail";
import { requirePagePermission } from "@/lib/auth";
import { getCompanyWalletWorkspace } from "@/lib/company-wallet";
import { findAuthorizedCompanyLifecycleRecord, loadCompanyLifecycleWorkspace } from "@/lib/company-lifecycle";
import { companyLifecycleStatusLabel } from "@/lib/company-lifecycle-i18n";
import { walletMessages } from "@/lib/wallet-i18n";
import { notFound, redirect } from "next/navigation";

const setupCopy = {
  en: { title: "Wallet and budgets", waiting: "Wallet setup is pending", body: "This company is still in setup. Its Wallet will become available when the company lifecycle provisions the financial workspace.", company: "Company", code: "Company code", status: "Setup status" },
  ar: { title: "المحفظة والميزانيات", waiting: "إعداد المحفظة قيد الانتظار", body: "لا تزال هذه الشركة في مرحلة الإعداد. ستتوفر محفظتها عند تجهيز مساحة العمل المالية ضمن دورة حياة الشركة.", company: "الشركة", code: "رمز الشركة", status: "حالة الإعداد" },
  ms: { title: "Dompet dan bajet", waiting: "Penyediaan Wallet masih menunggu", body: "Syarikat ini masih dalam persediaan. Walletnya akan tersedia apabila kitaran hayat syarikat menyediakan ruang kerja kewangan.", company: "Syarikat", code: "Kod syarikat", status: "Status persediaan" },
} as const;

export default async function CompanyWalletPage({
  params,
  searchParams,
}: {
  params: Promise<{ companyId: string }>;
  searchParams: Promise<{ outcome?: string; error?: string }>;
}) {
  const actor = await requirePagePermission("view_wallet");
  if (!actor.isOwner) redirect("/access-denied");
  const locale = actor.preferredLocale ?? "en";
  const timeZone = actor.timezone ?? "Asia/Kuala_Lumpur";
  const messages = walletMessages(locale);
  const copy = setupCopy[locale];
  const { companyId } = await params;
  const company = findAuthorizedCompanyLifecycleRecord(await loadCompanyLifecycleWorkspace(actor), companyId);
  if (!company) notFound();
  const workspace = await getCompanyWalletWorkspace(actor, company.id);
  const wallet = workspace.wallets.find((item) => item.companyId === company.id);
  if (!wallet) {
    return <>
      <CompanyWorkspaceNav companyId={company.id} locale={locale} active="wallet" />
      <section className="panel information-panel" aria-labelledby="company-wallet-setup-title">
        <div className="panel-header"><div><h1 id="company-wallet-setup-title">{copy.title}</h1><p>{company.name}</p></div></div>
        <div className="information-groups"><section className="information-group"><h2>{copy.waiting}</h2><p className="subtle">{copy.body}</p><dl className="information-list">
          <div><dt>{copy.company}</dt><dd>{company.name}</dd></div><div><dt>{copy.code}</dt><dd><bdi>{company.code}</bdi></dd></div><div><dt>{copy.status}</dt><dd>{companyLifecycleStatusLabel(locale, company.status)}</dd></div>
        </dl></section></div>
      </section>
    </>;
  }
  const result = await searchParams;
  const outcome = result.outcome === "recorded" ? messages.topUpRecorded
    : result.outcome === "already-recorded" ? messages.topUpAlreadyRecorded
      : undefined;
  const error = result.error === "invalid" ? messages.invalidSubmission
    : result.error ? messages.unavailable : undefined;
  return <>
    <CompanyWorkspaceNav companyId={company.id} locale={locale} active="wallet" />
    <WalletDetail wallet={wallet} locale={locale} timeZone={timeZone} messages={messages} outcome={outcome} error={error} />
  </>;
}
