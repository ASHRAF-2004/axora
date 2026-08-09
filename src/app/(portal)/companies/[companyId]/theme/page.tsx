import { CompanyBrandPreview } from "@/components/CompanyBrandPreview";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { requirePagePermission } from "@/lib/auth";
import { companyBrandingMessages } from "@/lib/company-branding-i18n";
import { isDemoMode } from "@/lib/db";
import {
  CompanyBrandUnavailableError,
  getCompanyBrandReviewWorkspace,
  type CompanyBrandThemeVersion,
  type CompanyLogoQualityWarning,
} from "@/lib/tenant-branding";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { CSSProperties } from "react";
import { z } from "zod";
import {
  createCompanyBrandAlternativeAction,
  createCompanyBrandCustomDraftAction,
  rollbackCompanyBrandThemeAction,
  transitionCompanyBrandThemeAction,
  uploadCompanyBrandDraftAction,
} from "./actions";
import styles from "./ThemeReview.module.css";

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function formatDate(value: string, locale: "en" | "ar" | "ms") {
  return new Intl.DateTimeFormat(
    locale === "ar" ? "ar-MY" : locale === "ms" ? "ms-MY" : "en-MY",
    {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Asia/Kuala_Lumpur",
    },
  ).format(new Date(value));
}

const qualityCodes = [
  "LOW_RESOLUTION",
  "TRANSPARENCY",
  "MONOCHROME",
  "FALLBACK_PALETTE",
] as const satisfies readonly CompanyLogoQualityWarning[];

function qualityWarnings(theme: CompanyBrandThemeVersion) {
  const value = theme.extractionSummary.qualityWarnings;
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is CompanyLogoQualityWarning => (
      typeof item === "string"
      && qualityCodes.includes(item as CompanyLogoQualityWarning)
    ),
  );
}

export default async function CompanyThemeReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ companyId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requirePagePermission("manage_companies");
  const locale = actor.preferredLocale ?? "en";
  const copy = companyBrandingMessages(locale);
  const [{ companyId: rawCompanyId }, query] = await Promise.all([
    params,
    searchParams,
  ]);
  const parsedCompanyId = z.uuid().safeParse(rawCompanyId);
  if (!parsedCompanyId.success) notFound();
  let workspace: Awaited<ReturnType<typeof getCompanyBrandReviewWorkspace>>;
  try {
    workspace = await getCompanyBrandReviewWorkspace(
      parsedCompanyId.data,
      actor,
    );
  } catch (error) {
    if (error instanceof CompanyBrandUnavailableError) notFound();
    throw error;
  }

  const draft = workspace.themes.find(
    (theme) => theme.status === "REVIEW_REQUIRED"
      || theme.status === "APPROVED",
  );
  const published = workspace.themes.find((theme) => theme.active);
  const displayed = draft ?? published;
  const noticeCode = first(query.notice);
  const notice = noticeCode === "logo-required"
    ? copy.chooseLogo
    : noticeCode
      ? copy.notices[noticeCode]
      : undefined;
  const warnings = displayed ? qualityWarnings(displayed) : [];
  const contrastLabels: Record<
    keyof CompanyBrandThemeVersion["contrastSummary"],
    string
  > = {
    primaryForeground: copy.primary,
    primaryHoverForeground: copy.primary + " · " + copy.hover,
    primaryActiveForeground: copy.primary + " · " + copy.activeState,
    secondaryForeground: copy.secondary,
    textOnBackground: copy.text,
    textInverseOnDark: copy.inverseText,
    iconOnBackground: copy.icon,
    iconInverseOnDark: copy.inverseIcon,
    linkOnBackground: copy.link,
    focusOnBackground: copy.focus,
    passes: copy.pass,
  };
  const contrastEntries = displayed
    ? Object.entries(displayed.contrastSummary).filter(
      (entry): entry is [string, number] => entry[0] !== "passes",
    )
    : [];
  const logoUrl = displayed
    ? isDemoMode()
      ? "/brand/axora-logo.png"
      : "/api/company-brand/" + workspace.company.id + "/logo?theme="
        + displayed.id + "&v=" + displayed.version
    : "";

  return (
    <div className={styles.layout}>
      <PageHeader
        eyebrow={copy.eyebrow}
        title={copy.title + ": " + workspace.company.name}
        description={copy.description}
      />
      <div className="action-row">
        <Link className="button button-secondary" href="/companies">
          {copy.back}
        </Link>
        {displayed ? (
          <StatusBadge>{copy.status[displayed.status]}</StatusBadge>
        ) : null}
      </div>
      {notice ? (
        <section className="panel" role="status" aria-live="polite">
          <strong>{notice}</strong>
        </section>
      ) : null}

      {displayed ? (
        <section className={"panel " + styles.overview}>
          <div>
            <div className="panel-header">
              <div>
                <h2>{draft ? copy.draft : copy.published}</h2>
                <p>{copy.workflow}: {copy.status[displayed.status]}</p>
              </div>
              <StatusBadge>{copy.version + " " + displayed.version}</StatusBadge>
            </div>
            <dl className={styles.metadata}>
              <div><dt>{copy.algorithm}</dt><dd>{displayed.algorithmVersion}</dd></div>
              <div><dt>{copy.sourceHash}</dt><dd className={styles.hash}>{displayed.sourceLogoHash}</dd></div>
              <div><dt>{copy.logoVariant}</dt><dd>{
                displayed.logoVariant === "MONOCHROME"
                  ? copy.monochrome
                  : displayed.logoVariant === "INVERTED"
                    ? copy.inverted
                    : copy.original
              }</dd></div>
              <div><dt>{copy.preferredAppearance}</dt><dd>{
                displayed.themePreference === "DARK" ? copy.dark : copy.light
              }</dd></div>
            </dl>
          </div>
          <div className={styles.swatches} aria-label={copy.palette}>
            {[
              [copy.primary, displayed.tokens.primary, displayed.tokens.primaryForeground],
              [copy.secondary, displayed.tokens.secondary, displayed.tokens.secondaryForeground],
              [copy.accent, displayed.tokens.accent, displayed.tokens.primaryForeground],
            ].map(([label, color, foreground]) => (
              <div
                className={styles.swatch}
                key={label}
                style={{
                  "--swatch-color": color,
                  "--swatch-foreground": foreground,
                } as CSSProperties}
              >
                <span>{label}</span><span>{color}</span>
              </div>
            ))}
          </div>
        </section>
      ) : (
        <section className="panel"><p>{copy.notPublished}</p></section>
      )}

      {displayed ? (
        <section className="panel">
          <div className="panel-header">
            <div><h2>{copy.previewTitle}</h2><p>{copy.previewHelp}</p></div>
          </div>
          <CompanyBrandPreview
            companyName={workspace.company.name}
            logoUrl={logoUrl}
            theme={displayed}
            locale={locale}
          />
        </section>
      ) : null}

      {displayed ? (
        <section className={styles.decisionGrid}>
          <article className="panel">
            <h2>{copy.contrastTitle}</h2>
            <p>{copy.contrastHelp}</p>
            <ul className={styles.contrastList}>
              {contrastEntries.map(([key, ratio]) => {
                const minimum = key.includes("icon") || key.includes("focus")
                  ? 3
                  : 4.5;
                const pass = ratio >= minimum;
                return (
                  <li key={key} data-pass={pass}>
                    <span>{contrastLabels[key as keyof typeof contrastLabels]}</span>
                    <strong>{ratio.toFixed(2)}:1 · {pass ? copy.pass : copy.fail}</strong>
                  </li>
                );
              })}
            </ul>
            {!displayed.contrastSummary.passes ? (
              <p role="alert"><strong>{copy.blocked}</strong></p>
            ) : null}
          </article>
          <article className="panel">
            <h2>{copy.qualityTitle}</h2>
            {warnings.length ? (
              <ul>{warnings.map((warning) => (
                <li key={warning}>{copy.quality[warning]}</li>
              ))}</ul>
            ) : <p>{copy.qualityClear}</p>}
          </article>
        </section>
      ) : null}

      <section className="panel form-panel">
        <h2>{copy.replaceTitle}</h2>
        <p>{copy.replaceHelp}</p>
        <form
          action={uploadCompanyBrandDraftAction.bind(null, workspace.company.id)}
          className="form-grid"
        >
          <label className="field-full">
            {copy.chooseLogo}
            <input
              name="logo"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              required
            />
          </label>
          <div className="form-actions field-full">
            <button className="button button-secondary" type="submit">
              {copy.generateDraft}
            </button>
          </div>
        </form>
      </section>

      {displayed ? (
        <section className={styles.editorGrid}>
          <article className="panel form-panel">
            <h2>{copy.paletteTitle}</h2>
            <p>{copy.paletteHelp}</p>
            <form
              action={createCompanyBrandAlternativeAction.bind(
                null,
                workspace.company.id,
              )}
              className="form-grid"
            >
              <input type="hidden" name="baseThemeId" value={displayed.id} />
              <label className="field-full">
                {copy.palette}
                <select name="paletteChoice" defaultValue="REVERSED">
                  <option value="REVERSED">{copy.reversed}</option>
                  <option value="VIVID">{copy.vivid}</option>
                  <option value="AXORA_DEFAULT">{copy.safeDefault}</option>
                </select>
              </label>
              <div className="form-actions field-full">
                <button className="button button-secondary" type="submit">
                  {copy.createAlternative}
                </button>
              </div>
            </form>
          </article>

          <article className="panel form-panel">
            <h2>{copy.editTitle}</h2>
            <p>{copy.editHelp}</p>
            <form
              action={createCompanyBrandCustomDraftAction.bind(
                null,
                workspace.company.id,
              )}
              className="form-grid"
            >
              <input type="hidden" name="baseThemeId" value={displayed.id} />
              {[
                ["primary", copy.primary, displayed.tokens.primary],
                ["secondary", copy.secondary, displayed.tokens.secondary],
                ["accent", copy.accent, displayed.tokens.accent],
                ["pageBackground", copy.pageBackground, displayed.tokens.pageBackground],
                ["darkPageBackground", copy.darkBackground, displayed.tokens.darkPageBackground],
                ["text", copy.text, displayed.tokens.text],
                ["textInverse", copy.inverseText, displayed.tokens.textInverse],
                ["icon", copy.icon, displayed.tokens.icon],
                ["iconInverse", copy.inverseIcon, displayed.tokens.iconInverse],
              ].map(([name, label, value]) => (
                <label key={name}>
                  {label}
                  <input name={name} type="color" defaultValue={value} required />
                </label>
              ))}
              <label>
                {copy.logoVariant}
                <select name="logoVariant" defaultValue={displayed.logoVariant}>
                  <option value="ORIGINAL">{copy.original}</option>
                  <option value="MONOCHROME">{copy.monochrome}</option>
                  <option value="INVERTED">{copy.inverted}</option>
                </select>
              </label>
              <label>
                {copy.logoPlacement}
                <select name="logoPlacement" defaultValue={displayed.logoPlacement}>
                  <option value="HEADER_START">{copy.headerStart}</option>
                  <option value="HEADER_CENTER">{copy.headerCenter}</option>
                </select>
              </label>
              <label>
                {copy.preferredAppearance}
                <select name="themePreference" defaultValue={displayed.themePreference}>
                  <option value="LIGHT">{copy.light}</option>
                  <option value="DARK">{copy.dark}</option>
                </select>
              </label>
              <label className="field-full">
                {copy.reason}
                <textarea name="reason" required minLength={3} maxLength={1000} />
                <small>{copy.reasonHelp}</small>
              </label>
              <div className="form-actions field-full">
                <button className="button button-secondary" type="submit">
                  {copy.saveDraft}
                </button>
              </div>
            </form>
          </article>
        </section>
      ) : null}

      {draft ? (
        <section className="panel form-panel">
          <h2>{copy.reviewTitle}</h2>
          <p>{workspace.canPublish
            ? copy.publishPermission
            : copy.noPublishPermission}</p>
          <div className={styles.decisionGrid}>
            {draft.status === "REVIEW_REQUIRED" ? (
              <form
                action={transitionCompanyBrandThemeAction.bind(
                  null,
                  workspace.company.id,
                )}
                className="form-grid"
              >
                <input type="hidden" name="themeId" value={draft.id} />
                <input type="hidden" name="action" value="APPROVE" />
                <label className="field-full">
                  {copy.reason}
                  <textarea name="reason" required minLength={3} maxLength={1000} />
                </label>
                <button className="button button-primary" type="submit">
                  {copy.approve}
                </button>
              </form>
            ) : workspace.canPublish ? (
              <form
                action={transitionCompanyBrandThemeAction.bind(
                  null,
                  workspace.company.id,
                )}
                className="form-grid"
              >
                <input type="hidden" name="themeId" value={draft.id} />
                <input type="hidden" name="action" value="PUBLISH" />
                <label className="field-full">
                  {copy.reason}
                  <textarea name="reason" required minLength={3} maxLength={1000} />
                </label>
                <button className="button button-primary" type="submit">
                  {copy.publish}
                </button>
              </form>
            ) : <p>{copy.noPublishPermission}</p>}
            <form
              action={transitionCompanyBrandThemeAction.bind(
                null,
                workspace.company.id,
              )}
              className="form-grid"
            >
              <input type="hidden" name="themeId" value={draft.id} />
              <input type="hidden" name="action" value="REJECT" />
              <label className="field-full">
                {copy.reason}
                <textarea name="reason" required minLength={3} maxLength={1000} />
              </label>
              <button className="button button-secondary" type="submit">
                {copy.reject}
              </button>
            </form>
          </div>
        </section>
      ) : null}

      <section className="panel">
        <h2>{copy.historyTitle}</h2>
        <div className={styles.versionList}>
          {workspace.themes.map((theme) => (
            <article className={styles.version} key={theme.id}>
              <div className={styles.versionHeader}>
                <strong>{copy.version} {theme.version}</strong>
                <StatusBadge>{copy.status[theme.status]}</StatusBadge>
              </div>
              <p className={styles.hash}>{theme.sourceLogoHash}</p>
              <p className="subtle">
                {formatDate(theme.createdAt, locale)}
                {theme.createdBy?.name
                  ? " · " + copy.by + " " + theme.createdBy.name
                  : ""}
              </p>
              {workspace.canPublish && theme.publishedBy && !theme.active ? (
                <form
                  action={rollbackCompanyBrandThemeAction.bind(
                    null,
                    workspace.company.id,
                  )}
                  className="table-action-stack"
                >
                  <input type="hidden" name="themeId" value={theme.id} />
                  <input
                    name="reason"
                    required
                    minLength={3}
                    maxLength={1000}
                    aria-label={copy.reason}
                  />
                  <button className="button button-secondary" type="submit">
                    {copy.rollback}
                  </button>
                </form>
              ) : null}
            </article>
          ))}
        </div>
      </section>

      <section className="panel">
        <h2>{copy.eventHistory}</h2>
        <ol className={styles.timeline}>
          {workspace.events.map((event) => (
            <li key={event.id}>
              <strong>{copy.eventStatus[
                event.status as keyof typeof copy.eventStatus
              ] ?? event.status}</strong>
              <br />
              <span>{event.reason}</span>
              <br />
              <span className="subtle">
                {formatDate(event.createdAt, locale)} · {copy.by}{" "}
                {event.actor?.name ?? copy.system}
              </span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
