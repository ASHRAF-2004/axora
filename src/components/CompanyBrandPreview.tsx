"use client";

import Image from "next/image";
import { useState, type CSSProperties } from "react";
import {
  companyBrandingMessages,
  companyBrandPreviewMessages,
} from "@/lib/company-branding-i18n";
import { LOCALE_NAMES, type SupportedLocale } from "@/lib/i18n";
import type {
  CompanyBrandThemeVersion,
  CompanyLogoPlacement,
  CompanyLogoVariant,
} from "@/lib/tenant-branding";
import styles from "./CompanyBrandPreview.module.css";

type Device = "desktop" | "tablet" | "mobile";
type Appearance = "light" | "dark";

interface CompanyBrandPreviewProps {
  companyName: string;
  logoUrl: string;
  theme: CompanyBrandThemeVersion;
  locale: SupportedLocale;
}

function logoStyle(
  variant: CompanyLogoVariant,
  placement: CompanyLogoPlacement,
) {
  return {
    "data-variant": variant,
    "data-placement": placement,
  };
}

export function CompanyBrandPreview({
  companyName,
  logoUrl,
  theme,
  locale,
}: CompanyBrandPreviewProps) {
  const copy = companyBrandingMessages(locale);
  const [device, setDevice] = useState<Device>("desktop");
  const [previewLocale, setPreviewLocale] = useState<SupportedLocale>(locale);
  const [appearance, setAppearance] = useState<Appearance>(
    theme.themePreference.toLowerCase() as Appearance,
  );
  const preview = companyBrandPreviewMessages(previewLocale);
  const dark = appearance === "dark";
  const tokenStyle = {
    "--preview-primary": theme.tokens.primary,
    "--preview-primary-foreground": theme.tokens.primaryForeground,
    "--preview-accent": theme.tokens.accent,
    "--preview-page": dark
      ? theme.tokens.darkPageBackground
      : theme.tokens.pageBackground,
    "--preview-surface": dark
      ? theme.tokens.darkSurface
      : theme.tokens.surface,
    "--preview-border": dark
      ? theme.tokens.darkBorder
      : theme.tokens.border,
    "--preview-text": dark
      ? theme.tokens.textInverse
      : theme.tokens.text,
    "--preview-icon": dark
      ? theme.tokens.iconInverse
      : theme.tokens.icon,
    "--preview-focus": theme.tokens.focusRing,
  } as CSSProperties;
  const components = new Set(theme.pageConfiguration.components);

  return (
    <div className={styles.workspace}>
      <div className={styles.controls}>
        <fieldset>
          <legend>{copy.device}</legend>
          <div className={styles.options}>
            {(["desktop", "tablet", "mobile"] as const).map((value) => (
              <label key={value}>
                <input
                  type="radio"
                  name="brand-preview-device"
                  checked={device === value}
                  onChange={() => setDevice(value)}
                />
                {copy[value]}
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend>{copy.previewLanguage}</legend>
          <div className={styles.options}>
            {(["en", "ar", "ms"] as const).map((value) => (
              <label key={value}>
                <input
                  type="radio"
                  name="brand-preview-locale"
                  checked={previewLocale === value}
                  onChange={() => setPreviewLocale(value)}
                />
                {LOCALE_NAMES[value].native}
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend>{copy.appearance}</legend>
          <div className={styles.options}>
            {(["light", "dark"] as const).map((value) => (
              <label key={value}>
                <input
                  type="radio"
                  name="brand-preview-appearance"
                  checked={appearance === value}
                  onChange={() => setAppearance(value)}
                />
                {copy[value]}
              </label>
            ))}
          </div>
        </fieldset>
      </div>

      <div className={styles.stage}>
        <section
          className={styles.frame}
          data-device={device}
          data-appearance={appearance}
          lang={previewLocale}
          dir={LOCALE_NAMES[previewLocale].dir}
          style={tokenStyle}
          aria-label={copy.previewTitle}
        >
          <header className={styles.header}>
            <Image
              className={styles.logo}
              src={logoUrl}
              width={180}
              height={56}
              alt={companyName}
              unoptimized
              {...logoStyle(theme.logoVariant, theme.logoPlacement)}
            />
            <nav className={styles.nav} aria-label={copy.previewTitle}>
              {preview.navigation.map((label) => <span key={label}>{label}</span>)}
            </nav>
          </header>

          {components.has("hero") ? (
            <div className={styles.hero}>
              <div>
                <span className={styles.eyebrow}>{preview.eyebrow}</span>
                <h3>{preview.heading}</h3>
                <p>{preview.body}</p>
                <button className={styles.action} type="button">
                  {preview.action}
                </button>
              </div>
              <aside className={styles.summary}>
                <strong>{preview.budget}</strong>
                <div className={styles.metric}>
                  <span>{preview.available}</span><b>RM 42,800</b>
                </div>
                <div className={styles.metric}>
                  <span>{preview.reserved}</span><b>RM 7,200</b>
                </div>
              </aside>
            </div>
          ) : null}

          <div className={styles.content}>
            {components.has("requestSummary") ? (
              <article className={styles.card}>
                <h4>{preview.requests}</h4>
                {[68, 44, 27].map((value, index) => (
                  <div className={styles.barRow} key={value}>
                    <span>{index ? preview.approved : preview.submitted}</span>
                    <span
                      className={styles.bar}
                      style={{
                        "--bar-size": value + "%",
                        "--bar-color": theme.tokens.chart[index],
                      } as CSSProperties}
                    />
                    <b>{value}</b>
                  </div>
                ))}
              </article>
            ) : null}
            {components.has("budgetSummary") ? (
              <article className={styles.card}>
                <h4>{preview.budget}</h4>
                <p><strong>RM 50,000</strong></p>
                <p>{preview.available}: RM 42,800</p>
                <p>{preview.reserved}: RM 7,200</p>
              </article>
            ) : null}
            {components.has("recentActivity") ? (
              <article className={styles.card}>
                <h4>{preview.activity}</h4>
                <ol className={styles.activity}>
                  <li>PR-2408-018 · {preview.submitted}</li>
                  <li>PR-2408-012 · {preview.approved}</li>
                  <li>PR-2408-009 · {preview.approved}</li>
                </ol>
              </article>
            ) : null}
          </div>
        </section>
      </div>
    </div>
  );
}
