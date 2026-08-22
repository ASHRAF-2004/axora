import type { SupportedLocale } from "@/lib/i18n";
import Link from "next/link";

const labels = {
  en: ["Overview", "Company setup", "Users", "Branches and delivery locations", "Wallet and budgets", "Documents"],
  ar: ["نظرة عامة", "إعداد الشركة", "المستخدمون", "الفروع ومواقع التسليم", "المحفظة والميزانيات", "المستندات"],
  ms: ["Gambaran keseluruhan", "Persediaan syarikat", "Pengguna", "Cawangan dan lokasi penghantaran", "Dompet dan bajet", "Dokumen"],
} as const;

export function CompanyWorkspaceNav({ companyId, locale, active }: {
  companyId: string;
  locale: SupportedLocale;
  active: "overview" | "setup" | "users" | "branches" | "wallet" | "documents";
}) {
  const encoded = encodeURIComponent(companyId);
  const links = [
    [`/companies/${encoded}`, "overview"],
    [`/companies/${encoded}/onboarding`, "setup"],
    [`/companies/${encoded}/users`, "users"],
    [`/companies/${encoded}/branches`, "branches"],
    [`/companies/${encoded}/wallet`, "wallet"],
    [`/companies/${encoded}/documents`, "documents"],
  ] as const;
  return <nav className="page-actions company-workspace-nav" aria-label={labels[locale][0]}>
    {links.map(([href, key], index) => <Link
      aria-current={active === key ? "page" : undefined}
      className={active === key ? "button button-primary" : "button button-secondary"}
      href={href}
      key={key}
    >{labels[locale][index]}</Link>)}
  </nav>;
}
