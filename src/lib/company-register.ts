import type { CompanyLifecycleRecord } from "./company-lifecycle";
import { resolveCompanyLifecycleStatusFilter } from "./company-lifecycle-i18n";
import type { SupportedLocale } from "./i18n";

export type CompanyRegisterRow = Pick<CompanyLifecycleRecord,
  "id" | "name" | "industry" | "status" | "mainContactName">;

/** Project only visible register columns from an already authorized workspace. */
export function companyRegisterRows(companies: readonly CompanyLifecycleRecord[], locale: SupportedLocale, search = "", status?: string): CompanyRegisterRow[] {
  const filter = resolveCompanyLifecycleStatusFilter(status);
  const query = search.trim().normalize("NFKC").slice(0, 100).toLocaleLowerCase(locale);
  return companies.filter(company => (
    (filter ? filter.statuses.some(value => value === company.status) : company.status !== "ARCHIVED")
    && (!query || [company.name, company.code, company.industry, company.mainContactName]
      .some(value => value.toLocaleLowerCase(locale).includes(query)))
  )).map(({ id, name, industry, status, mainContactName }) => ({ id, name, industry, status, mainContactName }));
}
