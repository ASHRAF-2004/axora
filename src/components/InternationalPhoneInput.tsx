"use client";

import { Check, ChevronDown, Search } from "lucide-react";
import {
  getCountries,
  getCountryCallingCode,
  parsePhoneNumberWithError,
  type CountryCode,
} from "libphonenumber-js/max";
import {
  type FormEvent,
  type KeyboardEvent,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";

import type { SupportedLocale } from "@/lib/i18n";
import {
  DEFAULT_PHONE_COUNTRY,
  normalizePhoneDigits,
  normalizePhoneNumber,
  PhoneNumberError,
  type PhoneNumberErrorCode,
} from "@/lib/phone-number";
import { phoneNumberMessages } from "@/lib/phone-number-i18n";

import styles from "./InternationalPhoneInput.module.css";

type CountryOption = {
  code: CountryCode;
  dialCode: string;
  name: string;
};

function countryFlag(country: CountryCode) {
  return [...country].map((letter) => String.fromCodePoint(127397 + letter.charCodeAt(0))).join("");
}

function initialPhoneState(value: string, defaultCountry: CountryCode) {
  try {
    const canonical = normalizePhoneNumber(value, defaultCountry);
    const parsed = parsePhoneNumberWithError(canonical, { extract: false });
    return {
      country: parsed.country ?? defaultCountry,
      national: parsed.country ? parsed.formatNational() : canonical,
    };
  } catch {
    return { country: defaultCountry, national: value };
  }
}

function validationCode(value: string, country: CountryCode, required: boolean) {
  if (!value.trim()) return required ? "EMPTY" satisfies PhoneNumberErrorCode : undefined;
  try {
    normalizePhoneNumber(value, country);
    return undefined;
  } catch (error) {
    return error instanceof PhoneNumberError ? error.code : "INVALID_NUMBER";
  }
}

export function InternationalPhoneInput({
  defaultCountry = DEFAULT_PHONE_COUNTRY,
  defaultValue = "",
  disabled = false,
  label,
  locale,
  name,
  required = false,
}: {
  defaultCountry?: CountryCode;
  defaultValue?: string;
  disabled?: boolean;
  label: string;
  locale: SupportedLocale;
  name: string;
  required?: boolean;
}) {
  const copy = phoneNumberMessages(locale);
  const initial = useMemo(
    () => initialPhoneState(defaultValue, defaultCountry),
    [defaultCountry, defaultValue],
  );
  const [country, setCountry] = useState<CountryCode>(initial.country);
  const [national, setNational] = useState(initial.national);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [errorCode, setErrorCode] = useState<PhoneNumberErrorCode>();
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const optionRefs = useRef(new Map<CountryCode, HTMLButtonElement>());
  const generatedId = useId().replaceAll(":", "");
  const inputId = `${generatedId}-number`;
  const helpId = `${generatedId}-help`;
  const errorId = `${generatedId}-error`;
  const listId = `${generatedId}-countries`;

  const options = useMemo(() => {
    const names = new Intl.DisplayNames([locale], { type: "region", fallback: "code" });
    const collator = new Intl.Collator(locale, { sensitivity: "base" });
    return getCountries().map((code): CountryOption => ({
      code,
      dialCode: `+${getCountryCallingCode(code)}`,
      name: names.of(code) ?? code,
    })).sort((left, right) => collator.compare(left.name, right.name));
  }, [locale]);
  const optionByCountry = useMemo(
    () => new Map(options.map((option) => [option.code, option])),
    [options],
  );
  const selected = optionByCountry.get(country) ?? options[0]!;
  const filteredOptions = useMemo(() => {
    const search = normalizePhoneDigits(query).trim().toLocaleLowerCase(locale);
    if (!search) return options;
    return options.filter((option) => (
      option.name.toLocaleLowerCase(locale).includes(search)
      || option.code.toLocaleLowerCase(locale).includes(search)
      || option.dialCode.includes(search.replaceAll(" ", ""))
    ));
  }, [locale, options, query]);

  let canonical = "";
  if (national.trim()) {
    try {
      canonical = normalizePhoneNumber(national, country);
    } catch {
      canonical = national.trim();
    }
  }

  const errorText = errorCode === "EMPTY" ? copy.required
    : errorCode === "INVALID_CHARACTERS" ? copy.characters
      : errorCode === "DUPLICATE_COUNTRY_CODE" ? copy.duplicate
        : errorCode ? copy.invalid : undefined;

  function validate(showError = true) {
    const code = errorCode === "INVALID_CHARACTERS"
      ? errorCode
      : validationCode(national, country, required);
    if (showError) setErrorCode(code);
    return !code;
  }

  function closeAndReturnFocus() {
    setOpen(false);
    setQuery("");
    buttonRef.current?.focus();
  }

  function selectCountry(option: CountryOption) {
    setCountry(option.code);
    setErrorCode(undefined);
    setOpen(false);
    setQuery("");
    inputRef.current?.focus();
  }

  function focusOption(index: number) {
    const bounded = (index + filteredOptions.length) % filteredOptions.length;
    optionRefs.current.get(filteredOptions[bounded]!.code)?.focus();
  }

  function optionKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      focusOption(index + (event.key === "ArrowDown" ? 1 : -1));
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      focusOption(event.key === "Home" ? 0 : filteredOptions.length - 1);
    } else if (event.key === "Escape") {
      event.preventDefault();
      closeAndReturnFocus();
    }
  }

  function updateNumber(value: string) {
    const next = normalizePhoneDigits(value);
    if (next && !/^[+()0-9.\-\s]+$/.test(next)) {
      setErrorCode("INVALID_CHARACTERS");
      return;
    }
    setErrorCode(undefined);
    if (next.trim().startsWith("+") || next.trim().startsWith("00")) {
      try {
        const normalized = normalizePhoneNumber(next, country);
        const parsed = parsePhoneNumberWithError(normalized, { extract: false });
        if (parsed.country) {
          setCountry(parsed.country);
          setNational(parsed.formatNational());
          return;
        }
      } catch {
        // Keep an incomplete international value editable until blur or submit.
      }
    }
    setNational(next);
  }

  useEffect(() => {
    if (!open) return;
    searchRef.current?.focus();
    const outside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);

  useEffect(() => {
    const input = inputRef.current;
    const form = input?.form;
    if (!input || !form) return;
    const code = errorCode === "INVALID_CHARACTERS"
      ? errorCode
      : validationCode(national, country, required);
    input.setCustomValidity(code
      ? code === "EMPTY" ? copy.required
        : code === "DUPLICATE_COUNTRY_CODE" ? copy.duplicate
          : code === "INVALID_CHARACTERS" ? copy.characters : copy.invalid
      : "");
    const submit = (event: Event) => {
      if (!code) return;
      event.preventDefault();
      event.stopPropagation();
      setErrorCode(code);
      input.focus();
    };
    form.addEventListener("submit", submit, true);
    return () => form.removeEventListener("submit", submit, true);
  }, [copy, country, errorCode, national, required]);

  return <div className={styles.field} ref={rootRef}>
    <label className={styles.label} htmlFor={inputId}>
      {label}{required ? <span aria-hidden="true"> *</span> : null}
    </label>
    <div className={styles.controls}>
      <div className={styles.picker}>
        <button
          aria-controls={listId}
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-label={`${copy.chooseCountry}: ${selected.name}, ${selected.dialCode}`}
          className={styles.countryButton}
          disabled={disabled}
          onClick={() => {
            if (open) setQuery("");
            setOpen((current) => !current);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setOpen(true);
            } else if (event.key === "Escape" && open) {
              event.preventDefault();
              setOpen(false);
              setQuery("");
            }
          }}
          ref={buttonRef}
          title={selected.name}
          type="button"
        >
          <span aria-hidden="true" className={styles.flag}>{countryFlag(selected.code)}</span>
          <span className={styles.countryName}>{selected.name}</span>
          <bdi className={styles.dialCode} dir="ltr">{selected.dialCode}</bdi>
          <ChevronDown aria-hidden="true" className={styles.chevron} size={16} />
        </button>
        {open ? <div className={styles.popover}>
          <label className={styles.searchLabel}>
            <span className={styles.visuallyHidden}>{copy.searchCountry}</span>
            <Search aria-hidden="true" size={17} />
            <input
              aria-controls={listId}
              autoComplete="off"
              className={styles.searchInput}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  closeAndReturnFocus();
                } else if (filteredOptions.length && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
                  event.preventDefault();
                  focusOption(event.key === "ArrowDown" ? 0 : filteredOptions.length - 1);
                }
              }}
              placeholder={copy.searchCountry}
              ref={searchRef}
              type="search"
              value={query}
            />
          </label>
          <div aria-label={copy.chooseCountry} className={styles.options} id={listId} role="listbox">
            {filteredOptions.map((option, index) => <button
              aria-selected={option.code === country}
              className={styles.option}
              key={option.code}
              onClick={() => selectCountry(option)}
              onKeyDown={(event) => optionKeyDown(event, index)}
              ref={(node) => {
                if (node) optionRefs.current.set(option.code, node);
                else optionRefs.current.delete(option.code);
              }}
              role="option"
              tabIndex={-1}
              type="button"
            >
              <span aria-hidden="true" className={styles.flag}>{countryFlag(option.code)}</span>
              <span className={styles.optionName}>{option.name}</span>
              <bdi className={styles.optionDial} dir="ltr">{option.dialCode}</bdi>
              {option.code === country ? <Check aria-hidden="true" size={16} /> : null}
            </button>)}
            {!filteredOptions.length ? <p className={styles.noResults} role="status">{copy.noCountries}</p> : null}
          </div>
        </div> : null}
      </div>
      <input
        aria-describedby={`${helpId}${errorText ? ` ${errorId}` : ""}`}
        aria-invalid={Boolean(errorText)}
        autoComplete="tel-national"
        className={styles.numberInput}
        dir="ltr"
        disabled={disabled}
        id={inputId}
        inputMode="tel"
        maxLength={40}
        onBlur={() => validate()}
        onChange={(event) => updateNumber(event.target.value)}
        onInvalid={(event: FormEvent<HTMLInputElement>) => {
          event.preventDefault();
          validate();
          inputRef.current?.focus();
        }}
        placeholder={copy.nationalNumber}
        ref={inputRef}
        required={required}
        type="tel"
        value={national}
      />
    </div>
    <input name={name} type="hidden" value={canonical} />
    <small className={styles.help} id={helpId}>{copy.help}</small>
    {errorText ? <small className={styles.error} id={errorId} role="alert">{errorText}</small> : null}
  </div>;
}
