import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { requirePagePermission } from "@/lib/auth";
import {
  COMPANY_LIFECYCLE_STATUSES,
  loadCompanyLifecycleWorkspace,
  type CompanyLifecycleAction,
  type CompanyLifecycleRecord,
  type CompanyLifecycleStatus,
} from "@/lib/company-lifecycle";
import {
  companyLifecycleActionLabel,
  companyLifecycleBlockerLabel,
  companyLifecycleMessages,
  companyLifecycleStatusLabel,
  companyLifecycleText,
} from "@/lib/company-lifecycle-i18n";
import { COD_PAYMENT_METHOD } from "@/lib/types";
import {
  activateCompanyAction,
  assignCompanyManagerAction,
  createCompanyAction,
  inviteCompanyAdministratorAction,
  regenerateCompanyBrandAction,
  resolveCompanyDuplicateAction,
  setCompanyPublicationAction,
  suspendCompanyAction,
  syncCompanyAdministratorAction,
  transitionCompanyLifecycleAction,
} from "../masters/actions";

type SearchValue = string | string[] | undefined;

function first(value: SearchValue) {
  return Array.isArray(value) ? value[0] : value;
}

function formatDate(locale: "en" | "ar" | "ms", value: Date | null | undefined) {
  if (!value) return "-";
  return new Intl.DateTimeFormat(
    locale === "ar" ? "ar-MY" : locale === "ms" ? "ms-MY" : "en-MY",
    { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kuala_Lumpur" },
  ).format(value);
}

const transitionTargets: Partial<Record<CompanyLifecycleAction, CompanyLifecycleStatus>> = {
  START_REVIEW: "UNDER_REVIEW",
  MARK_CONTACTED: "CONTACTED",
  REQUEST_INFORMATION: "INFORMATION_PENDING",
  START_ONBOARDING: "ONBOARDING",
  CREATE_PORTAL_DRAFT: "PORTAL_DRAFT",
  SUBMIT_COMPANY_REVIEW: "COMPANY_REVIEW",
  MARK_INACTIVE: "INACTIVE",
  ARCHIVE: "ARCHIVED",
  MARK_DUPLICATE: "DUPLICATE",
  REJECT: "REJECTED",
};

function TransitionForm({
  company,
  action,
  locale,
}: {
  company: CompanyLifecycleRecord;
  action: CompanyLifecycleAction;
  locale: "en" | "ar" | "ms";
}) {
  const target = transitionTargets[action];
  if (!target) return null;
  const copy = companyLifecycleMessages(locale);
  return (
    <form action={transitionCompanyLifecycleAction} className="table-action-stack">
      <input type="hidden" name="companyId" value={company.id} />
      <input type="hidden" name="toStatus" value={target} />
      <input
        name="reason"
        required
        minLength={3}
        maxLength={1000}
        placeholder={copy.reasonPlaceholder}
        aria-label={`${companyLifecycleActionLabel(locale, action)}: ${copy.reason}`}
      />
      <button className="button button-secondary" type="submit">
        {companyLifecycleActionLabel(locale, action)}
      </button>
    </form>
  );
}

function AssignmentForm({
  company,
  action,
  managers,
  locale,
}: {
  company: CompanyLifecycleRecord;
  action: Extract<CompanyLifecycleAction, "ASSIGN" | "REASSIGN" | "ADD_BACKUP" | "REPLACE_BACKUP">;
  managers: Array<{ id: string; name: string; email: string }>;
  locale: "en" | "ar" | "ms";
}) {
  const copy = companyLifecycleMessages(locale);
  const backup = action === "ADD_BACKUP" || action === "REPLACE_BACKUP";
  const excludedId = backup ? company.backupManager?.id : company.primaryManager?.id;
  const choices = managers.filter((manager) => manager.id !== excludedId);
  return (
    <details>
      <summary>{companyLifecycleActionLabel(locale, action)}</summary>
      <form action={assignCompanyManagerAction} className="form-grid">
        <input type="hidden" name="companyId" value={company.id} />
        <input type="hidden" name="assignmentType" value={backup ? "BACKUP" : "PRIMARY"} />
        <label className="field-full">
          {copy.chooseManager}
          <select name="managerUserId" required defaultValue="">
            <option value="" disabled>{copy.chooseManager}</option>
            {choices.map((manager) => (
              <option key={manager.id} value={manager.id}>
                {manager.name} ({manager.email})
              </option>
            ))}
          </select>
        </label>
        {backup ? (
          <>
            <label>{copy.coverageStarts}<input name="coverageStartsAt" type="datetime-local" required /></label>
            <label>{copy.coverageEnds}<input name="coverageEndsAt" type="datetime-local" required /></label>
          </>
        ) : null}
        <label className="field-full">
          {copy.reason}
          <textarea name="reason" required minLength={3} maxLength={1000} placeholder={copy.reasonPlaceholder} />
        </label>
        <div className="form-actions field-full">
          <button className="button button-primary" type="submit" disabled={!choices.length}>
            {copy.applyAssignment}
          </button>
        </div>
      </form>
    </details>
  );
}

function CompanyActions({
  company,
  managers,
  locale,
  owner,
}: {
  company: CompanyLifecycleRecord;
  managers: Array<{ id: string; name: string; email: string }>;
  locale: "en" | "ar" | "ms";
  owner: boolean;
}) {
  const copy = companyLifecycleMessages(locale);
  const actions = new Set(company.availableActions);
  const assignmentActions = (["ASSIGN", "REASSIGN", "ADD_BACKUP", "REPLACE_BACKUP"] as const)
    .filter((action) => actions.has(action));
  const transitionActions = (Object.keys(transitionTargets) as CompanyLifecycleAction[])
    .filter((action) => actions.has(action));

  return (
    <div className="table-action-stack">
      {assignmentActions.map((action) => (
        <AssignmentForm
          key={action}
          company={company}
          action={action}
          managers={managers}
          locale={locale}
        />
      ))}
      {transitionActions.map((action) => (
        <TransitionForm key={action} company={company} action={action} locale={locale} />
      ))}

      {actions.has("INVITE_ADMINISTRATOR") ? (
        <details>
          <summary>{copy.inviteAdministrator}</summary>
          <form action={inviteCompanyAdministratorAction} className="form-grid">
            <input type="hidden" name="companyId" value={company.id} />
            <label>{copy.administratorName}<input name="displayName" defaultValue={company.mainContactName} required /></label>
            <label>{copy.administratorEmail}<input name="email" type="email" defaultValue={company.mainContactEmail} required /></label>
            <label>{copy.administratorLocale}<select name="preferredLocale" defaultValue={locale}>
              <option value="en">{copy.english}</option>
              <option value="ar">{copy.arabic}</option>
              <option value="ms">{copy.malay}</option>
            </select></label>
            <div className="form-actions field-full"><button className="button button-primary" type="submit">{copy.sendInvitation}</button></div>
          </form>
        </details>
      ) : null}

      {actions.has("SYNC_ADMINISTRATOR") ? (
        <form action={syncCompanyAdministratorAction}>
          <input type="hidden" name="companyId" value={company.id} />
          <button className="button button-secondary" type="submit">{companyLifecycleActionLabel(locale, "SYNC_ADMINISTRATOR")}</button>
        </form>
      ) : null}

      {actions.has("ACTIVATE") && company.activationBlockedReasons.length === 0 ? (
        <form action={activateCompanyAction} className="table-action-stack">
          <input type="hidden" name="companyId" value={company.id} />
          <input name="reason" required minLength={3} maxLength={1000} placeholder={copy.reasonPlaceholder} aria-label={copy.reason} />
          <button className="button button-primary" type="submit">{companyLifecycleActionLabel(locale, "ACTIVATE")}</button>
        </form>
      ) : null}

      {actions.has("SUSPEND") ? (
        <details>
          <summary>{companyLifecycleActionLabel(locale, "SUSPEND")}</summary>
          <form action={suspendCompanyAction} className="table-action-stack">
            <input type="hidden" name="companyId" value={company.id} />
            <textarea name="reason" required minLength={3} maxLength={1000} placeholder={copy.reasonPlaceholder} aria-label={copy.reason} />
            <button className="button button-secondary" type="submit">{companyLifecycleActionLabel(locale, "SUSPEND")}</button>
          </form>
        </details>
      ) : null}

      {actions.has("PUBLISH") || actions.has("UNPUBLISH") ? (
        <details>
          <summary>{companyLifecycleActionLabel(locale, actions.has("PUBLISH") ? "PUBLISH" : "UNPUBLISH")}</summary>
          <form action={setCompanyPublicationAction} className="table-action-stack">
            <input type="hidden" name="companyId" value={company.id} />
            <input type="hidden" name="isPubliclyListed" value={actions.has("PUBLISH") ? "true" : "false"} />
            <p className="subtle">{copy.publicationHelp}</p>
            <input name="reason" required minLength={3} maxLength={1000} placeholder={copy.reasonPlaceholder} aria-label={copy.reason} />
            <button className="button button-secondary" type="submit">
              {companyLifecycleActionLabel(locale, actions.has("PUBLISH") ? "PUBLISH" : "UNPUBLISH")}
            </button>
          </form>
        </details>
      ) : null}

      {owner ? (
        <details>
          <summary>{copy.replaceLogo}</summary>
          <form action={regenerateCompanyBrandAction.bind(null, company.id)} className="table-action-stack">
            <label><span className="sr-only">{copy.replaceLogo}: {company.name}</span><input name="logo" type="file" accept="image/png,image/jpeg,image/webp" required /></label>
            <button className="button button-secondary" type="submit">{copy.regenerate}</button>
          </form>
        </details>
      ) : null}
    </div>
  );
}

function CompanyCard({
  company,
  managers,
  locale,
  highlighted,
  owner,
}: {
  company: CompanyLifecycleRecord;
  managers: Array<{ id: string; name: string; email: string }>;
  locale: "en" | "ar" | "ms";
  highlighted: boolean;
  owner: boolean;
}) {
  const copy = companyLifecycleMessages(locale);
  const percentage = company.onboarding.required
    ? Math.round((company.onboarding.passed / company.onboarding.required) * 100)
    : 0;
  return (
    <article
      id={`company-${company.id}`}
      className="panel"
      aria-label={highlighted ? `${copy.highlight}: ${company.name}` : company.name}
      style={highlighted ? { borderColor: "var(--tenant-primary, #0f766e)", boxShadow: "0 0 0 2px color-mix(in srgb, var(--tenant-primary, #0f766e) 25%, transparent)" } : undefined}
    >
      <div className="panel-header">
        <div>
          <p className="subtle">{company.code} · {company.registrationNumber}</p>
          <h2>{company.name}</h2>
          <p>{company.legalName} · {company.industry}</p>
        </div>
        <StatusBadge>{companyLifecycleStatusLabel(locale, company.status)}</StatusBadge>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 12 }}>
        <div><strong>{copy.mainContact}</strong><br />{company.mainContactName}<br /><span className="subtle">{company.mainContactEmail} · {company.mainContactPhone}</span></div>
        <div><strong>{copy.assignment}</strong><br />{company.primaryManager?.name ?? copy.unassigned}{company.backupManager ? <><br /><span className="subtle">{copy.backupManager}: {company.backupManager.name}</span></> : null}</div>
        <div><strong>{copy.privatePortal}</strong><br />{company.portalAccessEnabled ? copy.enabled : copy.disabled}<br /><span className="subtle">{copy.publicListing}: {company.isPubliclyListed ? copy.enabled : copy.disabled}</span></div>
      </div>

      <div style={{ marginBlockStart: 16 }}>
        <strong>{copy.onboarding}</strong>
        <p>{companyLifecycleText(locale, "progress", { passed: company.onboarding.passed, required: company.onboarding.required })}</p>
        <progress value={company.onboarding.passed} max={Math.max(1, company.onboarding.required)} aria-label={copy.onboarding} style={{ inlineSize: "100%" }}>{percentage}%</progress>
      </div>

      {company.activationBlockedReasons.length ? (
        <div className="panel" style={{ marginBlockStart: 16 }}>
          <strong>{copy.activationBlocked}</strong>
          <ul>{company.activationBlockedReasons.map((blocker) => <li key={blocker}>{companyLifecycleBlockerLabel(locale, blocker)}</li>)}</ul>
        </div>
      ) : <p><strong>{copy.activationReady}</strong></p>}

      {company.duplicateCandidates.length ? (
        <details open={company.duplicateReviewStatus === "POSSIBLE_DUPLICATE"}>
          <summary>{copy.duplicates} ({company.duplicateCandidates.length})</summary>
          {company.duplicateCandidates.map((candidate) => (
            <p key={candidate.id}><strong>{candidate.code} · {candidate.name}</strong><br /><span className="subtle">{companyLifecycleText(locale, "matchedOn", { fields: candidate.matchedFields.join(", ") })}</span></p>
          ))}
          {company.availableActions.includes("CLEAR_DUPLICATE") ? (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))", gap: 12 }}>
              {(["CLEAR", "CONFIRM"] as const).map((decision) => (
                <form key={decision} action={resolveCompanyDuplicateAction} className="table-action-stack">
                  <input type="hidden" name="companyId" value={company.id} />
                  <input type="hidden" name="decision" value={decision} />
                  <input name="reason" required minLength={3} maxLength={1000} placeholder={copy.reasonPlaceholder} aria-label={copy.reason} />
                  <button className="button button-secondary" type="submit">
                    {companyLifecycleActionLabel(locale, decision === "CLEAR" ? "CLEAR_DUPLICATE" : "MARK_DUPLICATE")}
                  </button>
                </form>
              ))}
            </div>
          ) : null}
        </details>
      ) : null}

      <details>
        <summary>{copy.checklist}</summary>
        <div className="data-table-wrap"><table className="data-table"><tbody>
          {company.onboarding.items.map((item) => (
            <tr key={item.code}>
              <th>{companyLifecycleBlockerLabel(locale, item.code)}</th>
              <td><StatusBadge>{item.status === "PASSED" ? copy.passed : item.status === "FAILED" ? copy.failed : item.status === "WAIVED" ? copy.waived : copy.pending}</StatusBadge></td>
              <td className="subtle">{item.completedAt ? formatDate(locale, item.completedAt) : companyLifecycleBlockerLabel(locale, item.code)}</td>
            </tr>
          ))}
        </tbody></table></div>
      </details>

      <details>
        <summary>{copy.history}</summary>
        <ol>{company.history.map((entry) => (
          <li key={entry.version}>
            <strong>{companyLifecycleStatusLabel(locale, entry.toStatus)}</strong>
            {entry.fromStatus ? ` (${companyLifecycleStatusLabel(locale, entry.fromStatus)} -> ${companyLifecycleStatusLabel(locale, entry.toStatus)})` : ""}
            <br /><span className="subtle">{entry.reason ?? "-"} · {formatDate(locale, entry.changedAt)} · {entry.changedByName ?? copy.system}</span>
          </li>
        ))}</ol>
      </details>

      {company.availableActions.length || owner ? (
        <details style={{ marginBlockStart: 16 }}>
          <summary>{copy.actions}</summary>
          <CompanyActions company={company} managers={managers} locale={locale} owner={owner} />
        </details>
      ) : null}
    </article>
  );
}

function noticeText(locale: "en" | "ar" | "ms", notice: string | undefined) {
  const copy = companyLifecycleMessages(locale);
  if (notice === "company-created") return copy.createdConfirmation;
  if (notice === "company-assigned") return copy.noticeAssigned;
  if (notice === "company-status-updated") return copy.noticeUpdated;
  if (notice === "company-duplicate-reviewed") return copy.noticeDuplicate;
  if (notice === "company-activated") return copy.noticeActivated;
  if (notice === "company-activation-blocked") return copy.noticeActivationBlocked;
  if (notice === "company-suspended") return copy.noticeSuspended;
  if (notice === "company-published" || notice === "company-unpublished") return copy.noticePublished;
  if (notice === "company-administrator-invited" || notice === "company-administrator-synced") return copy.noticeAdministrator;
  if (notice === "company-administrator-email-failed") return copy.noticeAdministratorFailed;
  if (notice === "company-administrator-invitation-rate-limited") return copy.noticeRateLimited;
  return undefined;
}

export default async function CompaniesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, SearchValue>>;
}) {
  const actor = await requirePagePermission("manage_companies");
  const locale = actor.preferredLocale ?? "en";
  const copy = companyLifecycleMessages(locale);
  const [workspace, params] = await Promise.all([
    loadCompanyLifecycleWorkspace(actor),
    searchParams,
  ]);
  const requestedStatus = first(params.status);
  const status = COMPANY_LIFECYCLE_STATUSES.includes(requestedStatus as CompanyLifecycleStatus)
    ? requestedStatus as CompanyLifecycleStatus
    : undefined;
  const view = first(params.view) === "mine" ? "mine" : "all";
  const created = first(params.created);
  const notice = noticeText(locale, first(params.notice));
  const companies = workspace.companies.filter((company) => (
    (!status || company.status === status)
    && (view !== "mine" || company.isAssignedToActor)
  ));

  return (
    <>
      <PageHeader eyebrow={copy.eyebrow} title={copy.title} description={copy.description} />
      {notice ? <section className="panel" role="status" aria-live="polite"><strong>{notice}</strong></section> : null}

      <section className="panel" style={{ marginBlockStart: 16 }}>
        <div className="panel-header"><div><h2>{copy.register}</h2><p>{companyLifecycleText(locale, "count", { count: companies.length })}</p></div></div>
        <form method="get" className="form-grid">
          {workspace.canViewAll ? <label>{copy.allCompanies}<select name="view" defaultValue={view}><option value="all">{copy.allCompanies}</option><option value="mine">{copy.myCompanies}</option></select></label> : <input type="hidden" name="view" value="mine" />}
          <label>{copy.status}<select name="status" defaultValue={status ?? ""}><option value="">{copy.allStatuses}</option>{COMPANY_LIFECYCLE_STATUSES.map((item) => <option key={item} value={item}>{companyLifecycleStatusLabel(locale, item)}</option>)}</select></label>
          <div className="form-actions"><button className="button button-secondary" type="submit">{copy.filter}</button></div>
        </form>
      </section>

      <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,420px),1fr))", gap: 16, marginBlockStart: 16 }}>
        {companies.length ? companies.map((company) => (
          <CompanyCard key={company.id} company={company} managers={workspace.managers} locale={locale} highlighted={company.id === created} owner={actor.isOwner} />
        )) : <article className="panel"><p>{copy.noCompanies}</p></article>}
      </section>

      {workspace.canCreate ? (
        <form action={createCompanyAction} className="panel form-panel" style={{ marginBlockStart: 16 }}>
          <h2>{copy.createTitle}</h2><p>{copy.createIntro}</p>
          <div className="form-grid">
            <label>{copy.displayName}<input name="name" required maxLength={300} /></label>
            <label>{copy.legalName}<input name="legalName" required maxLength={300} /></label>
            <label>{copy.registrationNumber}<input name="registrationNumber" required maxLength={160} /></label>
            <label>{copy.industry}<input name="industry" required maxLength={300} /></label>
            <label className="field-full">{copy.companyInformation}<textarea name="companyInformation" required maxLength={3000} /></label>
            <label className="field-full">{copy.website}<input name="websiteUrl" type="url" inputMode="url" placeholder="https://example.com" /></label>
            <label className="field-full">{copy.logo}<input name="logo" type="file" accept="image/png,image/jpeg,image/webp" required /><small>{copy.logoHelp}</small></label>
            <label>{copy.mainContact}<input name="mainContactName" required /></label>
            <label>{copy.mainEmail}<input name="mainContactEmail" type="email" required /></label>
            <label>{copy.mainPhone}<input name="mainContactPhone" required /></label>
            <label>{copy.billingCycle}<select name="billingCycle"><option value="Monthly">{copy.monthly}</option><option value="Per order">{copy.perOrder}</option><option value="Weekly">{copy.weekly}</option></select></label>
            <label>{copy.billingContact}<input name="billingContactName" /></label>
            <label>{copy.billingEmail}<input name="billingContactEmail" type="email" /></label>
            <label>{copy.billingPhone}<input name="billingContactPhone" /></label>
            <label><span>{copy.paymentTerms}</span><input name="paymentTerms" value={COD_PAYMENT_METHOD} readOnly required /></label>
            <label className="field-full">{copy.billingAddress}<textarea name="billingAddress" required /></label>
            <label className="field-full">{copy.notes}<textarea name="notes" /></label>
          </div>
          <div className="form-actions"><button className="button button-primary" type="submit">{copy.submit}</button></div>
        </form>
      ) : null}
    </>
  );
}
