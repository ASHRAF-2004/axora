import { CompanyWorkspaceNav } from "@/components/CompanyWorkspaceNav";
import { PageHeader } from "@/components/PageHeader";
import { requirePagePermission } from "@/lib/auth";
import { CompanyOnboardingUnavailableError, loadCompanyOnboardingWorkspace } from "@/lib/company-onboarding";
import { notFound } from "next/navigation";
import { saveCompanyOnboardingAction } from "./actions";

const TIMEZONES = ["Asia/Kuala_Lumpur", "Asia/Singapore", "Asia/Riyadh", "Asia/Dubai", "Asia/Jakarta", "Asia/Manila", "UTC"] as const;

const text = {
  en: { title: "Company setup", body: "Keep the company’s essential workspace details current.", saved: "Company setup saved.", legal: "Legal name", contact: "Main contact name", industry: "Industry", language: "Default language", timezone: "Timezone", save: "Save company setup", unavailable: "Company setup is read-only for your role." },
  ar: { title: "إعداد الشركة", body: "حافظ على تحديث البيانات الأساسية لمساحة عمل الشركة.", saved: "تم حفظ إعداد الشركة.", legal: "الاسم القانوني", contact: "اسم جهة الاتصال الرئيسية", industry: "القطاع", language: "اللغة الافتراضية", timezone: "المنطقة الزمنية", save: "حفظ إعداد الشركة", unavailable: "إعداد الشركة للقراءة فقط لدورك." },
  ms: { title: "Persediaan syarikat", body: "Pastikan butiran penting ruang kerja syarikat sentiasa terkini.", saved: "Persediaan syarikat disimpan.", legal: "Nama sah", contact: "Nama hubungan utama", industry: "Industri", language: "Bahasa lalai", timezone: "Zon waktu", save: "Simpan persediaan syarikat", unavailable: "Persediaan syarikat adalah baca sahaja untuk peranan anda." },
} as const;

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function CompanySetupPage({ params, searchParams }: {
  params: Promise<{ companyId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requirePagePermission("manage_companies");
  const locale = actor.preferredLocale ?? "en";
  const [{ companyId }, query] = await Promise.all([params, searchParams]);
  let workspace: Awaited<ReturnType<typeof loadCompanyOnboardingWorkspace>>;
  try {
    workspace = await loadCompanyOnboardingWorkspace(actor, companyId);
  } catch (error) {
    if (error instanceof CompanyOnboardingUnavailableError) notFound();
    throw error;
  }
  const company = workspace.company;
  const copy = text[locale];
  return <>
    <PageHeader eyebrow={company.name} title={copy.title} description={copy.body} />
    <CompanyWorkspaceNav companyId={company.id} locale={locale} active="setup" />
    {first(query.notice) === "saved" ? <div className="form-success" role="status"><strong>{copy.saved}</strong></div> : null}
    <section className="panel form-panel">
      {workspace.canEdit ? <form action={saveCompanyOnboardingAction} className="form-grid">
        <input type="hidden" name="companyId" value={company.id} />
        <input type="hidden" name="expectedVersion" value={company.version} />
        <label>{copy.legal}<input name="legalName" defaultValue={company.legalName} required maxLength={300} /></label>
        <label>{copy.contact}<input name="mainContactName" defaultValue={company.mainContactName} required maxLength={300} /></label>
        <label>{copy.industry}<select name="industryCode" defaultValue={company.industryCode}>{workspace.industries.map((industry) => <option key={industry.code} value={industry.code}>{locale === "ar" ? industry.nameAr : locale === "ms" ? industry.nameMs : industry.nameEn}</option>)}</select></label>
        <label>{copy.language}<select name="defaultLocale" defaultValue={company.defaultLocale}><option value="en">English</option><option value="ar">العربية</option><option value="ms">Bahasa Melayu</option></select></label>
        <label>{copy.timezone}<select name="timezone" defaultValue={company.timezone}>{!TIMEZONES.includes(company.timezone as typeof TIMEZONES[number]) ? <option value={company.timezone}>{company.timezone}</option> : null}{TIMEZONES.map((timezone) => <option key={timezone} value={timezone}>{timezone.replaceAll("_", " ")}</option>)}</select></label>
        <div className="form-actions field-full"><button className="button button-primary" type="submit">{copy.save}</button></div>
      </form> : <p>{copy.unavailable}</p>}
    </section>
  </>;
}
