import { localizedStatus } from "@/lib/core-portal-i18n";
import { REQUEST_STATUSES } from "@/lib/domain";
import type { SupportedLocale } from "@/lib/i18n";
import { requestFilterMessages } from "@/lib/request-filter-i18n";
import type { RequestFilters } from "@/lib/request-filters";
import Link from "next/link";

export function RequestFiltersPanel({ filters, locale }: {
  filters: RequestFilters;
  currentQuery: string;
  platformView: boolean;
  locale: SupportedLocale;
}) {
  const copy = requestFilterMessages(locale);
  return <section className="panel request-filter-panel" aria-labelledby="request-filter-title">
    <header><div><h2 id="request-filter-title">{copy.title}</h2><p>{copy.description}</p></div></header>
    <form method="get" className="request-filter-form">
      <div className="request-filter-primary">
        <label>{copy.search}<input name="q" type="search" defaultValue={filters.query} placeholder={copy.searchPlaceholder} /></label>
        <label>{copy.status}<select name="status" defaultValue={filters.statuses[0] ?? ""}>
          <option value="">{copy.allStatuses}</option>
          <option value="open">{copy.openOnly}</option>
          {REQUEST_STATUSES.map((status) => <option key={status} value={status}>{localizedStatus(status, locale)}</option>)}
        </select></label>
      </div>
      <div className="request-filter-actions">
        <button className="button button-primary" type="submit">{copy.apply}</button>
        <Link className="button button-secondary" href="/requests">{copy.clearAll}</Link>
      </div>
    </form>
  </section>;
}
