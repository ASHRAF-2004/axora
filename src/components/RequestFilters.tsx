"use client";

import { localizedStatus } from "@/lib/core-portal-i18n";
import { REQUEST_STATUSES } from "@/lib/domain";
import type { SupportedLocale } from "@/lib/i18n";
import { requestFilterMessages } from "@/lib/request-filter-i18n";
import {
  REQUEST_BUDGET_EXCEPTION_STATUSES,
  REQUEST_SORTS,
  type RequestFilterDimension,
  type RequestFilters,
} from "@/lib/request-filters";
import { Search, SlidersHorizontal, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useMemo, useState } from "react";

interface FilterOption {
  value: string;
  label: string;
  count: number;
}

function ScopedFilter({
  dimension,
  name,
  label,
  initialValues,
  locale,
}: {
  dimension: RequestFilterDimension;
  name: string;
  label: string;
  initialValues: string[];
  locale: SupportedLocale;
}) {
  const copy = requestFilterMessages(locale);
  const listId = useId();
  const initialKey = initialValues.join("\u001f");
  const normalizedInitial = useMemo(
    () => initialKey ? initialKey.split("\u001f") : [],
    [initialKey],
  );
  const [selected, setSelected] = useState<FilterOption[]>(() => (
    normalizedInitial.map((value) => ({ value, label: copy.selectedValue, count: 0 }))
  ));
  const [selectedInitialKey, setSelectedInitialKey] = useState(initialKey);
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<FilterOption[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  if (selectedInitialKey !== initialKey) {
    setSelectedInitialKey(initialKey);
    setSelected(normalizedInitial.map((value) => ({
      value,
      label: copy.selectedValue,
      count: 0,
    })));
  }

  useEffect(() => {
    if (!normalizedInitial.length) return;
    const controller = new AbortController();
    const params = new URLSearchParams({ dimension });
    for (const value of normalizedInitial) params.append("selected", value);
    void fetch(`/api/requests/filter-options?${params}`, {
      credentials: "same-origin",
      signal: controller.signal,
    }).then((response) => response.ok ? response.json() : { options: [] })
      .then((payload: { options?: FilterOption[] }) => {
        if (!controller.signal.aborted) setSelected(payload.options ?? []);
      }).catch(() => undefined);
    return () => controller.abort();
  }, [dimension, normalizedInitial]);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setLoading(true);
      const params = new URLSearchParams({ dimension });
      if (query.trim()) params.set("q", query.trim());
      void fetch(`/api/requests/filter-options?${params}`, {
        credentials: "same-origin",
        signal: controller.signal,
      }).then((response) => response.ok ? response.json() : { options: [] })
        .then((payload: { options?: FilterOption[] }) => {
          if (!controller.signal.aborted) setOptions(payload.options ?? []);
        }).catch(() => {
          if (!controller.signal.aborted) setOptions([]);
        }).finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [dimension, open, query]);

  const selectedValues = new Set(selected.map((option) => option.value));
  const available = options.filter((option) => !selectedValues.has(option.value));

  return (
    <div className="request-filter-combobox">
      <label htmlFor={listId}>{label}</label>
      <div className="request-filter-selected">
        {selected.map((option) => (
          <span className="request-filter-token" key={option.value}>
            <span>{option.label}</span>
            <button
              type="button"
              aria-label={copy.remove(option.label)}
              onClick={() => setSelected((current) => current.filter((item) => item.value !== option.value))}
            ><X size={13} /></button>
            <input type="hidden" name={name} value={option.value} />
          </span>
        ))}
      </div>
      <div className="request-filter-search">
        <Search size={15} aria-hidden="true" />
        <input
          id={listId}
          type="search"
          value={query}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={`${listId}-options`}
          placeholder={copy.find(label)}
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") setOpen(false);
          }}
        />
      </div>
      {open ? (
        <div className="request-filter-options" id={`${listId}-options`} role="listbox">
          {loading ? <p>{copy.loading}</p> : null}
          {!loading && !available.length ? <p>{copy.noOptions}</p> : null}
          {available.map((option) => (
            <button
              type="button"
              role="option"
              aria-selected="false"
              key={option.value}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                setSelected((current) => [...current, option]);
                setQuery("");
                setOpen(false);
              }}
            >
              <span>{option.label}</span>
              <small>{copy.optionCount(option.count)}</small>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function withoutKey(currentQuery: string, key: string) {
  const params = new URLSearchParams(currentQuery);
  params.delete(key);
  params.delete("page");
  const query = params.toString();
  return query ? `/requests?${query}` : "/requests";
}

export function RequestFiltersPanel({
  filters,
  currentQuery,
  platformView,
  canViewSupplier,
  locale,
}: {
  filters: RequestFilters;
  currentQuery: string;
  platformView: boolean;
  canViewSupplier: boolean;
  locale: SupportedLocale;
}) {
  const copy = requestFilterMessages(locale);
  const advancedActive = Boolean(
    filters.companyIds.length || filters.managerIds.length || filters.branchIds.length
    || filters.departmentIds.length || filters.costCentreIds.length
    || filters.requesterIds.length || filters.approverIds.length
    || filters.deliveryAgentIds.length || filters.supplierIds.length
    || filters.budgetExceptionStatuses.length || filters.neededFrom || filters.neededTo
    || filters.submittedFrom || filters.submittedTo || filters.approvedFrom
    || filters.approvedTo || filters.completedFrom || filters.completedTo
    || filters.minAmount !== undefined || filters.maxAmount !== undefined,
  );
  const simpleChips = [
    filters.query ? { key: "q", label: `${copy.search}: ${filters.query}` } : null,
    filters.statuses[0] ? {
      key: "status",
      label: filters.statuses[0] === "open"
        ? copy.openOnly
        : localizedStatus(filters.statuses[0], locale),
    } : null,
    filters.budgetExceptionStatuses[0] ? {
      key: "budgetException",
      label: copy.budgetStatuses[filters.budgetExceptionStatuses[0]],
    } : null,
    filters.neededFrom ? { key: "neededFrom", label: `${copy.neededFrom}: ${filters.neededFrom}` } : null,
    filters.neededTo ? { key: "neededTo", label: `${copy.neededTo}: ${filters.neededTo}` } : null,
    filters.submittedFrom ? { key: "submittedFrom", label: `${copy.submittedFrom}: ${filters.submittedFrom}` } : null,
    filters.submittedTo ? { key: "submittedTo", label: `${copy.submittedTo}: ${filters.submittedTo}` } : null,
    filters.approvedFrom ? { key: "approvedFrom", label: `${copy.approvedFrom}: ${filters.approvedFrom}` } : null,
    filters.approvedTo ? { key: "approvedTo", label: `${copy.approvedTo}: ${filters.approvedTo}` } : null,
    filters.completedFrom ? { key: "completedFrom", label: `${copy.completedFrom}: ${filters.completedFrom}` } : null,
    filters.completedTo ? { key: "completedTo", label: `${copy.completedTo}: ${filters.completedTo}` } : null,
    filters.minAmount !== undefined ? { key: "minAmount", label: `${copy.minAmount}: ${filters.minAmount}` } : null,
    filters.maxAmount !== undefined ? { key: "maxAmount", label: `${copy.maxAmount}: ${filters.maxAmount}` } : null,
  ].filter((chip): chip is { key: string; label: string } => Boolean(chip));

  return (
    <section className="panel request-filter-panel" aria-labelledby="request-filter-title">
      <header>
        <div><h2 id="request-filter-title">{copy.title}</h2><p>{copy.description}</p></div>
        <SlidersHorizontal size={22} aria-hidden="true" />
      </header>
      <form method="get" className="request-filter-form">
        <div className="request-filter-primary">
          <label>{copy.search}<input name="q" type="search" defaultValue={filters.query} placeholder={copy.searchPlaceholder} /></label>
          <label>{copy.status}<select name="status" defaultValue={filters.statuses[0] ?? ""}>
            <option value="">{copy.allStatuses}</option>
            <option value="open">{copy.openOnly}</option>
            {REQUEST_STATUSES.map((status) => <option key={status} value={status}>{localizedStatus(status, locale)}</option>)}
          </select></label>
          <ScopedFilter dimension="category" name="category" label={copy.category} initialValues={filters.categories} locale={locale} />
          <label>{copy.sort}<select name="sort" defaultValue={filters.sort}>
            {REQUEST_SORTS.map((sort) => <option value={sort} key={sort}>{copy.sorts[sort]}</option>)}
          </select></label>
        </div>
        <details className="request-filter-advanced" open={advancedActive}>
          <summary>{copy.advanced}</summary>
          <div className="request-filter-grid">
            {platformView ? <ScopedFilter dimension="company" name="company" label={copy.company} initialValues={filters.companyIds} locale={locale} /> : null}
            {platformView ? <ScopedFilter dimension="manager" name="manager" label={copy.manager} initialValues={filters.managerIds} locale={locale} /> : null}
            <ScopedFilter dimension="branch" name="branch" label={copy.branch} initialValues={filters.branchIds} locale={locale} />
            <ScopedFilter dimension="department" name="department" label={copy.department} initialValues={filters.departmentIds} locale={locale} />
            <ScopedFilter dimension="costCentre" name="costCentre" label={copy.costCentre} initialValues={filters.costCentreIds} locale={locale} />
            <ScopedFilter dimension="requester" name="requester" label={copy.requester} initialValues={filters.requesterIds} locale={locale} />
            <ScopedFilter dimension="approver" name="approver" label={copy.approver} initialValues={filters.approverIds} locale={locale} />
            {platformView ? <ScopedFilter dimension="deliveryAgent" name="deliveryAgent" label={copy.deliveryAgent} initialValues={filters.deliveryAgentIds} locale={locale} /> : null}
            {canViewSupplier ? <ScopedFilter dimension="supplier" name="supplier" label={copy.supplier} initialValues={filters.supplierIds} locale={locale} /> : null}
            <label>{copy.budgetException}<select name="budgetException" defaultValue={filters.budgetExceptionStatuses[0] ?? ""}>
              <option value="">{copy.noBudgetFilter}</option>
              {REQUEST_BUDGET_EXCEPTION_STATUSES.map((status) => <option key={status} value={status}>{copy.budgetStatuses[status]}</option>)}
            </select></label>
            <label>{copy.neededFrom}<input type="date" name="neededFrom" defaultValue={filters.neededFrom} /></label>
            <label>{copy.neededTo}<input type="date" name="neededTo" defaultValue={filters.neededTo} /></label>
            <label>{copy.submittedFrom}<input type="date" name="submittedFrom" defaultValue={filters.submittedFrom} /></label>
            <label>{copy.submittedTo}<input type="date" name="submittedTo" defaultValue={filters.submittedTo} /></label>
            <label>{copy.approvedFrom}<input type="date" name="approvedFrom" defaultValue={filters.approvedFrom} /></label>
            <label>{copy.approvedTo}<input type="date" name="approvedTo" defaultValue={filters.approvedTo} /></label>
            <label>{copy.completedFrom}<input type="date" name="completedFrom" defaultValue={filters.completedFrom} /></label>
            <label>{copy.completedTo}<input type="date" name="completedTo" defaultValue={filters.completedTo} /></label>
            <label>{copy.minAmount}<input type="number" min="0" step="0.01" name="minAmount" defaultValue={filters.minAmount} /></label>
            <label>{copy.maxAmount}<input type="number" min="0" step="0.01" name="maxAmount" defaultValue={filters.maxAmount} /></label>
            <label>{copy.pageSize}<select name="pageSize" defaultValue={filters.pageSize}>
              {[25, 50, 100].map((size) => <option key={size} value={size}>{size}</option>)}
            </select></label>
          </div>
        </details>
        <div className="request-filter-actions">
          <button className="button button-primary" type="submit">{copy.apply}</button>
          <Link className="button button-secondary" href="/requests">{copy.clearAll}</Link>
        </div>
      </form>
      {simpleChips.length ? <div className="request-active-filters" aria-label={copy.activeFilters}>
        <strong>{copy.activeFilters}</strong>
        {simpleChips.map((chip) => <Link key={chip.key} href={withoutKey(currentQuery, chip.key)} className="request-filter-chip">
          <span>{chip.label}</span><X size={13} aria-hidden="true" />
        </Link>)}
      </div> : null}
    </section>
  );
}
