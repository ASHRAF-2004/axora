"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { useLiveRead } from "@/components/LiveUpdatesProvider";
import { StatusBadge } from "@/components/StatusBadge";
import type { CompanyRegisterRow } from "@/lib/company-register";
import { companyLifecycleCountText, companyLifecycleMessages, companyLifecycleStatusLabel } from "@/lib/company-lifecycle-i18n";
import type { SupportedLocale } from "@/lib/i18n";
import { liveUpdatesMessages } from "@/lib/live-updates-i18n";

export function CompanyRegister({ initialCompanies, readUrl, locale, companyLabel, openLabel, children }: {
  initialCompanies: CompanyRegisterRow[]; readUrl: string; locale: SupportedLocale;
  companyLabel: string; openLabel: string; children: ReactNode;
}) {
  const [companies, setCompanies] = useState(initialCompanies);
  const [unavailable, setUnavailable] = useState(false);
  const copy = companyLifecycleMessages(locale);
  // Only replace the table and count. Filter inputs, focus and drafts stay intact.
  useLiveRead<{ companies: CompanyRegisterRow[] }>("companies", readUrl, next => {
    setCompanies(next.companies); setUnavailable(false);
  }, {}, () => { setCompanies([]); setUnavailable(true); });
  return <section className="panel">
    <div className="panel-header"><div><h2>{copy.register}</h2><p>{companyLifecycleCountText(locale, companies.length)}</p></div></div>
    {children}
    {unavailable ? <p role="status">{liveUpdatesMessages(locale).liveReconnecting}</p> : companies.length ?
      <div className="data-table-wrap"><table className="data-table"><thead><tr><th>{companyLabel}</th><th>{copy.status}</th><th>{copy.mainContact}</th><th /></tr></thead><tbody>
        {companies.map(company => <tr key={company.id}><td><strong>{company.name}</strong>{company.industry ? <><br /><span className="subtle">{company.industry}</span></> : null}</td><td><StatusBadge status={company.status}>{companyLifecycleStatusLabel(locale, company.status)}</StatusBadge></td><td>{company.mainContactName}</td><td><Link className="button button-secondary" href={`/companies/${company.id}`}>{company.status === "ACTIVE" ? openLabel : copy.continueSetup}</Link></td></tr>)}
      </tbody></table></div> : <p>{copy.noCompanies}</p>}
  </section>;
}
