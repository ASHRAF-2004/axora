import { assignCompanyManagerAction } from "@/app/(portal)/masters/actions";
import {
  COMPANY_MANAGER_ACCESS_MODES,
  COMPANY_MANAGER_ASSIGNABLE_PERMISSIONS,
  type CompanyLifecycleAction,
  type CompanyLifecycleManager,
  type CompanyLifecycleRecord,
} from "@/lib/company-lifecycle";
import {
  companyLifecycleActionLabel,
  companyLifecycleMessages,
  companyLifecycleText,
} from "@/lib/company-lifecycle-i18n";
import { StatusBadge } from "./StatusBadge";

type Locale = "en" | "ar" | "ms";
type AssignmentAction = Extract<
  CompanyLifecycleAction,
  "ASSIGN" | "REASSIGN" | "ADD_BACKUP" | "REPLACE_BACKUP"
>;

function formatDate(locale: Locale, value: Date | null | undefined) {
  if (!value) return "-";
  return new Intl.DateTimeFormat(
    locale === "ar" ? "ar-MY" : locale === "ms" ? "ms-MY" : "en-MY",
    { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kuala_Lumpur" },
  ).format(value);
}

function AssignmentForm({
  company,
  action,
  managers,
  locale,
}: {
  company: CompanyLifecycleRecord;
  action: AssignmentAction;
  managers: CompanyLifecycleManager[];
  locale: Locale;
}) {
  const copy = companyLifecycleMessages(locale);
  const backup = action === "ADD_BACKUP" || action === "REPLACE_BACKUP";
  const excludedId = backup ? company.backupManager?.id : company.primaryManager?.id;
  const choices = managers.filter((manager) => manager.id !== excludedId);
  const accessModes = COMPANY_MANAGER_ACCESS_MODES.filter((mode) => backup || mode !== "TEMPORARY");
  const accessModeLabel = (mode: typeof COMPANY_MANAGER_ACCESS_MODES[number]) => ({
    NORMAL: copy.normalAccess,
    TEMPORARY: copy.temporaryAccess,
    READ_ONLY: copy.readOnlyAccess,
    SPECIFIC_PERMISSIONS: copy.specificAccess,
  })[mode];
  const permissionLabel = (permission: typeof COMPANY_MANAGER_ASSIGNABLE_PERMISSIONS[number]) => ({
    "company.view.assigned": copy.permissionCompanyView,
    "company.edit": copy.permissionCompanyEdit,
    "user.view": copy.permissionUsersView,
    "organization.branch.view": copy.permissionBranchesView,
    "request.view": copy.permissionRequestsView,
    "document.view": copy.permissionDocumentsView,
    "report.view": copy.permissionReportsView,
  })[permission];

  return <details>
    <summary>{companyLifecycleActionLabel(locale, action)}</summary>
    <form action={assignCompanyManagerAction} className="form-grid">
      <input type="hidden" name="companyId" value={company.id} />
      <input type="hidden" name="assignmentType" value={backup ? "BACKUP" : "PRIMARY"} />
      <label className="field-full">{copy.chooseManager}
        <select name="managerUserId" required defaultValue="">
          <option value="" disabled>{copy.chooseManager}</option>
          {choices.map((manager) => {
            const available = backup ? manager.availableForBackup : manager.availableForPrimary;
            return <option key={manager.id} value={manager.id} disabled={!available}>
              {companyLifecycleText(locale, "managerOption", {
                name: manager.name,
                active: manager.activePrimaryAssignments,
                maximum: manager.maxPrimaryAssignments,
                region: manager.serviceRegionCode,
              })}
            </option>;
          })}
        </select>
      </label>
      {backup ? <>
        <label>{copy.coverageStarts}<input name="coverageStartsAt" type="datetime-local" required /></label>
        <label>{copy.coverageEnds}<input name="coverageEndsAt" type="datetime-local" required /></label>
      </> : null}
      <label>{copy.accessMode}<select name="accessMode" required defaultValue={backup ? "TEMPORARY" : "NORMAL"}>
        {accessModes.map((mode) => <option key={mode} value={mode}>{accessModeLabel(mode)}</option>)}
      </select></label>
      <label>{copy.documentVisibility}<select name="documentVisibility" required defaultValue="STANDARD">
        <option value="STANDARD">{copy.documentStandard}</option>
        <option value="COMPANY_SHARED_ONLY">{copy.documentCompanyShared}</option>
        <option value="NONE">{copy.documentNone}</option>
      </select></label>
      <fieldset className="field-full">
        <legend>{copy.specificPermissions}</legend>
        <p className="subtle">{copy.specificPermissionsHelp}</p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(210px,1fr))", gap: 8 }}>
          {COMPANY_MANAGER_ASSIGNABLE_PERMISSIONS.map((permission) => <label key={permission} style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input type="checkbox" name="specificPermissionCodes" value={permission} />
            {permissionLabel(permission)}
          </label>)}
        </div>
      </fieldset>
      <div className="panel field-full">
        <strong>{copy.transferPreview}</strong>
        <p className="subtle">{companyLifecycleText(locale, "transferPreviewCounts", {
          onboarding: company.openManagerWork.onboardingItems,
          reminders: company.openManagerWork.reminders,
          tasks: company.openManagerWork.leadTasks,
        })}</p>
      </div>
      <label className="field-full">{copy.handoverNotes}
        <textarea name="handoverNotes" maxLength={5000} placeholder={copy.handoverNotesHelp} />
      </label>
      <label className="field-full">{copy.handoverChecklist}
        <textarea name="handoverChecklist" maxLength={4800} placeholder={copy.handoverChecklistHelp} />
      </label>
      <label className="field-full">{copy.coverageReason}
        <textarea name="reason" required minLength={3} maxLength={1000} placeholder={copy.reasonPlaceholder} />
      </label>
      <div className="form-actions field-full">
        <button className="button button-primary" type="submit" disabled={!choices.length}>{copy.applyAssignment}</button>
      </div>
    </form>
  </details>;
}

export function CompanyManagerAssignmentWorkspace({
  company,
  managers,
  locale,
}: {
  company: CompanyLifecycleRecord;
  managers: CompanyLifecycleManager[];
  locale: Locale;
}) {
  const copy = companyLifecycleMessages(locale);
  const actions = new Set(company.availableActions);
  const assignmentActions = (["ASSIGN", "REASSIGN", "ADD_BACKUP", "REPLACE_BACKUP"] as const)
    .filter((action) => actions.has(action));
  return <div className="page-stack">
    <section className="panel">
      <h2>{copy.coverageAndHandover}</h2>
      <p><StatusBadge>{company.managerCoverage.status === "COVERED" ? copy.covered : copy.coverageGap}</StatusBadge>{company.managerCoverage.reason ? <> <span className="subtle">{company.managerCoverage.reason}</span></> : null}</p>
      {[company.primaryManager, company.backupManager].filter((manager) => manager !== null).map((manager) => <div className="panel" key={manager.assignmentId} style={{ marginBlockStart: 12 }}>
        <strong>{manager.name}</strong> · {manager.accessMode === "NORMAL" ? copy.normalAccess : manager.accessMode === "TEMPORARY" ? copy.temporaryAccess : manager.accessMode === "READ_ONLY" ? copy.readOnlyAccess : copy.specificAccess}
        <p className="subtle">{manager.coverageReason} · {copy.assignedBy} {manager.assignedByName} · {formatDate(locale, manager.assignedAt)}</p>
        {manager.coverageEndsAt ? <p className="subtle">{companyLifecycleText(locale, "backupWindow", { start: formatDate(locale, manager.coverageStartsAt), end: formatDate(locale, manager.coverageEndsAt) })}</p> : null}
        {manager.handoverNotes ? <p><strong>{copy.handoverNotes}:</strong> {manager.handoverNotes}</p> : null}
        {manager.handoverChecklist.length ? <ul>{manager.handoverChecklist.map((item) => <li key={item}>{item}</li>)}</ul> : null}
      </div>)}
      <p>{companyLifecycleText(locale, "transferPreviewCounts", {
        onboarding: company.openManagerWork.onboardingItems,
        reminders: company.openManagerWork.reminders,
        tasks: company.openManagerWork.leadTasks,
      })}</p>
    </section>
    {assignmentActions.length ? <section className="panel form-panel">
      <h2>{copy.actions}</h2>
      <div className="detail-grid">{assignmentActions.map((action) => <AssignmentForm key={action} company={company} action={action} managers={managers} locale={locale} />)}</div>
    </section> : null}
    <section className="panel">
      <h2>{copy.assignmentHistory}</h2>
      {company.assignmentHistory.length ? <ol>{company.assignmentHistory.map((entry) => <li key={entry.assignmentId}>
        <strong>{entry.managerName}</strong> · {entry.assignmentType === "PRIMARY" ? copy.primaryManager : copy.backupManager} · {entry.status === "ACTIVE" ? copy.activeAssignment : copy.endedAssignment}
        <br /><span className="subtle">{entry.coverageReason} · {formatDate(locale, entry.assignedAt)}{entry.endedAt ? ` - ${formatDate(locale, entry.endedAt)}` : ""}</span>
      </li>)}</ol> : <p className="subtle">{copy.noAssignmentHistory}</p>}
    </section>
  </div>;
}
