"use client";

import { useId, useMemo, useState } from "react";
import { DayPicker, type DateRange } from "react-day-picker";
import dayPickerStyles from "react-day-picker/style.module.css";
import { ar, enUS, ms } from "react-day-picker/locale";
import styles from "@/app/(portal)/budget-approval.module.css";
import type { SupportedLocale } from "@/lib/i18n";
import type { BudgetCycleVarianceMessages } from "@/lib/budget-cycle-variance-i18n";
import {
  addIsoCalendarDays,
  deriveCustomBudgetPeriodRange,
  type BudgetPeriodFrequency,
} from "@/lib/budget-period-range";

const frequencies = [
  "WEEKLY",
  "MONTHLY",
  "QUARTERLY",
  "YEARLY",
  "CUSTOM",
  "MANUAL",
] as const satisfies readonly BudgetPeriodFrequency[];

function formatDate(value: string, locale: SupportedLocale) {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00Z`));
}

function isoDateToLocalCalendarDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return undefined;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12);
  if (
    date.getFullYear() !== Number(match[1])
    || date.getMonth() !== Number(match[2]) - 1
    || date.getDate() !== Number(match[3])
  ) return undefined;
  return date;
}

function localCalendarDateToIso(date: Date) {
  const year = String(date.getFullYear()).padStart(4, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function interpolate(
  message: string,
  values: Readonly<Record<string, string | number>>,
) {
  return Object.entries(values).reduce(
    (result, [key, value]) => result.replaceAll(`{${key}}`, String(value)),
    message,
  );
}

export function BudgetPeriodScheduleFields({
  defaultFrequency,
  defaultIntervalCount,
  defaultAnchorLocal,
  defaultEffectiveLocal,
  minimumStartDate,
  defaultStartDate,
  defaultEndDate,
  locale,
  messages,
}: {
  defaultFrequency: BudgetPeriodFrequency;
  defaultIntervalCount: number;
  defaultAnchorLocal: string;
  defaultEffectiveLocal: string;
  minimumStartDate: string;
  defaultStartDate: string;
  defaultEndDate: string;
  locale: SupportedLocale;
  messages: BudgetCycleVarianceMessages;
}) {
  const descriptionId = useId();
  const summaryId = useId();
  const [frequency, setFrequency] = useState<BudgetPeriodFrequency>(defaultFrequency);
  const [startDate, setStartDate] = useState(defaultStartDate);
  const [endDate, setEndDate] = useState(defaultEndDate);

  const range = useMemo(() => {
    if (!startDate || !endDate) return null;
    try {
      return deriveCustomBudgetPeriodRange(startDate, endDate);
    } catch {
      return null;
    }
  }, [endDate, startDate]);

  const selectedRange = useMemo<DateRange | undefined>(() => {
    const from = isoDateToLocalCalendarDate(startDate);
    if (!from) return undefined;
    return { from, to: isoDateToLocalCalendarDate(endDate) };
  }, [endDate, startDate]);
  const minimumDate = isoDateToLocalCalendarDate(minimumStartDate);
  const maximumDate = minimumDate
    ? isoDateToLocalCalendarDate(addIsoCalendarDays(minimumStartDate, 3_659))
    : undefined;
  const rangeIsInvalid = Boolean(startDate && endDate && !range);

  function updateRange(value: DateRange | undefined) {
    setStartDate(value?.from ? localCalendarDateToIso(value.from) : "");
    setEndDate(value?.to ? localCalendarDateToIso(value.to) : "");
  }

  const frequencyLabels: Record<BudgetPeriodFrequency, string> = {
    WEEKLY: messages.weekly,
    MONTHLY: messages.monthly,
    QUARTERLY: messages.quarterly,
    YEARLY: messages.yearly,
    CUSTOM: messages.custom,
    MANUAL: messages.manual,
  };

  return (
    <div className={styles.schedulePeriodFields}>
      <div className={styles.fieldGrid}>
        <label>
          <span>{messages.frequency}</span>
          <select
            name="frequency"
            value={frequency}
            onChange={(event) => setFrequency(event.currentTarget.value as BudgetPeriodFrequency)}
          >
            {frequencies.map((value) => (
              <option value={value} key={value}>{frequencyLabels[value]}</option>
            ))}
          </select>
        </label>

        {frequency === "CUSTOM" ? (
          <input name="intervalCount" type="hidden" value="1" />
        ) : (
          <label>
            <span>{messages.interval}</span>
            <input
              name="intervalCount"
              type="number"
              min="1"
              max="52"
              defaultValue={defaultIntervalCount}
              aria-describedby={descriptionId}
              required
            />
            <small className={styles.formHelp} id={descriptionId}>{messages.intervalHelp}</small>
          </label>
        )}

        {frequency === "CUSTOM" ? (
          <fieldset className={styles.dateRangeFieldset} aria-describedby={summaryId}>
            <legend>{messages.customPeriod}</legend>
            <p className={styles.formHelp}>{messages.customRangeHelp}</p>
            <div className={styles.dateRangeSelection} aria-live="polite">
              <div>
                <span>{messages.periodStart}</span>
                <strong>{startDate ? formatDate(startDate, locale) : "—"}</strong>
              </div>
              <div>
                <span>{messages.periodEnd}</span>
                <strong>{endDate ? formatDate(endDate, locale) : "—"}</strong>
              </div>
            </div>
            {minimumDate && maximumDate ? (
              <div className={styles.dateRangeCalendar}>
                <DayPicker
                  aria-label={messages.customPeriod}
                  mode="range"
                  selected={selectedRange}
                  onSelect={updateRange}
                  min={0}
                  max={3_659}
                  resetOnSelect
                  excludeDisabled
                  disabled={{ before: minimumDate }}
                  defaultMonth={selectedRange?.from ?? minimumDate}
                  startMonth={minimumDate}
                  endMonth={maximumDate}
                  captionLayout="dropdown"
                  navLayout="after"
                  showOutsideDays
                  dir={locale === "ar" ? "rtl" : "ltr"}
                  locale={locale === "ar" ? ar : locale === "ms" ? ms : enUS}
                  classNames={dayPickerStyles}
                />
              </div>
            ) : null}
            <input
              name="periodStartDate"
              type="hidden"
              value={startDate}
              aria-invalid={rangeIsInvalid || undefined}
            />
            <input
              name="periodEndDate"
              type="hidden"
              value={endDate}
              aria-invalid={rangeIsInvalid || undefined}
            />
            <input name="customIntervalDays" type="hidden" value={range?.customIntervalDays ?? ""} />
            <input name="anchorLocal" type="hidden" value={range?.anchorLocal ?? ""} />
            <input name="effectiveLocal" type="hidden" value={range?.effectiveLocal ?? ""} />
            {range ? (
              <div className={styles.dateRangeSummary} id={summaryId} role="status" aria-live="polite">
                <div className={styles.dateRangeTrack} aria-hidden="true">
                  <span>{formatDate(range.startDate, locale)}</span>
                  <i />
                  <span>{formatDate(range.endDate, locale)}</span>
                </div>
                <strong>
                  {interpolate(messages.customRangeSummary, {
                    start: formatDate(range.startDate, locale),
                    end: formatDate(range.endDate, locale),
                    days: range.customIntervalDays,
                    next: formatDate(range.nextBoundaryDate, locale),
                  })}
                </strong>
              </div>
            ) : (
              <p
                className={rangeIsInvalid ? styles.dateRangeError : styles.formHelp}
                id={summaryId}
                role={rangeIsInvalid ? "alert" : undefined}
              >
                {rangeIsInvalid ? messages.customRangeInvalid : messages.customRangeIncomplete}
              </p>
            )}
          </fieldset>
        ) : (
          <>
            <input name="customIntervalDays" type="hidden" value="" />
            <label>
              <span>{messages.anchor}</span>
              <input name="anchorLocal" type="datetime-local" defaultValue={defaultAnchorLocal} required />
            </label>
            <label>
              <span>{messages.effective}</span>
              <input name="effectiveLocal" type="datetime-local" defaultValue={defaultEffectiveLocal} />
            </label>
          </>
        )}
      </div>
    </div>
  );
}

export const budgetPeriodScheduleFieldInternals = {
  formatDate,
  interpolate,
  isoDateToLocalCalendarDate,
  localCalendarDateToIso,
};
