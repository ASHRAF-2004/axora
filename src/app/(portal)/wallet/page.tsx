import Link from "next/link";
import { redirect } from "next/navigation";

import { requirePagePermission } from "@/lib/auth";
import { getCompanyWalletWorkspace } from "@/lib/company-wallet";
import { loadCompanyLifecycleWorkspace } from "@/lib/company-lifecycle";
import { walletMessages } from "@/lib/wallet-i18n";

import { WalletDetail } from "./WalletDetail";
import styles from "./Wallet.module.css";

const indexCopy = {
  en: { title: "Company Wallets", intro: "Choose a company to open its canonical Wallet record.", search: "Search companies", searchAction: "Search", company: "Company name", code: "Company code", status: "Status", active: "Active", inactive: "Inactive", empty: "No companies match this search." },
  ar: { title: "محافظ الشركات", intro: "اختر شركة لفتح سجل محفظتها المعتمد.", search: "البحث في الشركات", searchAction: "بحث", company: "اسم الشركة", code: "رمز الشركة", status: "الحالة", active: "نشطة", inactive: "غير نشطة", empty: "لا توجد شركات مطابقة للبحث." },
  ms: { title: "Dompet Syarikat", intro: "Pilih syarikat untuk membuka rekod Dompet kanoniknya.", search: "Cari syarikat", searchAction: "Cari", company: "Nama syarikat", code: "Kod syarikat", status: "Status", active: "Aktif", inactive: "Tidak aktif", empty: "Tiada syarikat sepadan dengan carian ini." },
} as const;

function resultMessages(locale: "en" | "ar" | "ms", outcome?: string, error?: string) {
  const messages = walletMessages(locale);
  return {
    outcome: outcome === "requested" ? messages.topUpRequested
      : outcome === "recorded" ? messages.topUpRecorded
        : outcome === "already-recorded" ? messages.topUpAlreadyRecorded : undefined,
    error: error === "invalid" ? messages.invalidSubmission
      : error ? messages.unavailable : undefined,
  };
}

export default async function CompanyWalletPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; outcome?: string; error?: string }>;
}) {
  const actor = await requirePagePermission("view_wallet");
  if (!actor.roleAssignmentId && process.env.DEMO_MODE === "false") redirect("/access-denied");
  const parameters = await searchParams;
  const locale = actor.preferredLocale ?? "en";
  const timeZone = actor.timezone ?? "Asia/Kuala_Lumpur";
  const messages = walletMessages(locale);

  if (actor.isOwner) {
    const copy = indexCopy[locale];
    const query = parameters.q?.trim().slice(0, 160) ?? "";
    const normalized = query.toLocaleLowerCase(locale);
    const companies = (await loadCompanyLifecycleWorkspace(actor)).companies.filter((company) => (
      !normalized
      || company.name.toLocaleLowerCase(locale).includes(normalized)
      || company.code.toLocaleLowerCase(locale).includes(normalized)
    ));
    return <div className={styles.page} dir={locale === "ar" ? "rtl" : "ltr"}>
      <header className={styles.hero}><p className={styles.eyebrow}>{messages.companyWallet}</p><h1>{copy.title}</h1><p>{copy.intro}</p></header>
      <form className={styles.companySearch} method="get" role="search">
        <label htmlFor="wallet-company-search">{copy.search}</label>
        <div><input id="wallet-company-search" name="q" type="search" defaultValue={query} maxLength={160} /><button type="submit">{copy.searchAction}</button></div>
      </form>
      <section className={styles.companyIndex} aria-labelledby="company-wallet-index-title">
        <h2 className="sr-only" id="company-wallet-index-title">{copy.title}</h2>
        {companies.length === 0 ? <p className={styles.empty}>{copy.empty}</p> : <div className={styles.companyTableWrap}><table>
          <thead><tr><th>{copy.company}</th><th>{copy.code}</th><th>{copy.status}</th><th><span className="sr-only">{messages.openCompanyWallet}</span></th></tr></thead>
          <tbody>{companies.map((company) => <tr key={company.id}>
            <td data-label={copy.company}><strong>{company.name}</strong></td><td data-label={copy.code}><bdi dir="ltr">{company.code}</bdi></td><td data-label={copy.status}>{company.active ? copy.active : copy.inactive}</td>
            <td data-label=""><Link href={`/companies/${encodeURIComponent(company.id)}/wallet`}>{messages.openCompanyWallet}</Link></td>
          </tr>)}</tbody>
        </table></div>}
      </section>
    </div>;
  }

  const workspace = await getCompanyWalletWorkspace(actor, actor.companyId);
  const wallet = workspace.wallets.find((item) => item.companyId === actor.companyId);
  if (!wallet) return <div className={styles.page}><section className={styles.panel}><p className={styles.empty}>{messages.noWallets}</p></section></div>;
  const result = resultMessages(locale, parameters.outcome, parameters.error);
  return <WalletDetail wallet={wallet} locale={locale} timeZone={timeZone} messages={messages} outcome={result.outcome} error={result.error} />;
}
