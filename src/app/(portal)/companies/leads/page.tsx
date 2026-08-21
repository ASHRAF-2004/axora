import { requirePagePermission } from "@/lib/auth";
import {
  COMPANY_LEAD_STATUSES,
  loadCompanyLeadWorkspace,
  type CompanyLeadAction,
  type CompanyLeadRecord,
  type CompanyLeadStatus,
} from "@/lib/company-leads";
import {
  companyLeadActionLabel,
  companyLeadMessages,
  companyLeadStatusLabel,
} from "@/lib/company-leads-i18n";
import type { SupportedLocale } from "@/lib/i18n";
import Link from "next/link";
import {
  addCompanyLeadNoteAction,
  addCompanyLeadTaskAction,
  anonymizeCompanyLeadAction,
  assignCompanyLeadAction,
  completeCompanyLeadTaskAction,
  convertCompanyLeadAction,
  resolveCompanyLeadDuplicateAction,
  transitionCompanyLeadAction,
} from "./actions";

type SearchValue = string | string[] | undefined;
const first = (value: SearchValue) => Array.isArray(value) ? value[0] : value;
const removedContactMatchFields = new Set([
  "registrationNumber", "emailDomain", "contactEmail", "phone",
]);
const visibleMatchedFields = (fields: readonly string[]) =>
  fields.filter((field) => !removedContactMatchFields.has(field));

function formatDate(locale: SupportedLocale, timezone: string, value: Date | null) {
  if (!value) return "-";
  try {
    return new Intl.DateTimeFormat(
      locale === "ar" ? "ar-MY" : locale === "ms" ? "ms-MY" : "en-MY",
      { dateStyle: "medium", timeStyle: "short", timeZone: timezone },
    ).format(value);
  } catch {
    return value.toISOString();
  }
}

const transitions: Partial<Record<CompanyLeadAction, CompanyLeadStatus>> = {
  MARK_CONTACTED: "CONTACTED",
  REQUEST_INFORMATION: "INFORMATION_PENDING",
  QUALIFY: "QUALIFIED",
  ACTIVATE: "ACTIVE",
  REJECT: "REJECTED",
};

function actionsForRole(
  role: string,
  isOwner: boolean,
  source: readonly CompanyLeadAction[],
  status: CompanyLeadStatus,
) {
  if (isOwner) {
    // The database read model is the state- and permission-aware authority.
    // Do not hide valid Owner follow-up actions behind a second role list.
    return new Set(source);
  }
  const allowed = role === "HUMAN_RESOURCES_MANAGEMENT"
      ? new Set<CompanyLeadAction>(["ASSIGN", "REASSIGN", "REVIEW_DUPLICATE", "ADD_NOTE", "ADD_TASK"])
      : role === "CLIENT_ACCOUNT_MANAGER"
        ? new Set<CompanyLeadAction>([
          "MARK_CONTACTED", "REQUEST_INFORMATION", "QUALIFY", "CONVERT",
          "ACTIVATE", "REVIEW_DUPLICATE", "ADD_NOTE", "ADD_TASK",
        ])
        : new Set<CompanyLeadAction>();
  const candidates = role === "CLIENT_ACCOUNT_MANAGER" && status === "ONBOARDING"
    ? [...source, "ACTIVATE" as const]
    : source;
  return new Set(candidates.filter((action) => allowed.has(action)));
}

function LeadActions({
  lead,
  managers,
  locale,
  available,
}: {
  lead: CompanyLeadRecord;
  managers: Array<{ id: string; name: string; email: string }>;
  locale: SupportedLocale;
  available: Set<CompanyLeadAction>;
}) {
  const copy = companyLeadMessages(locale);
  return <div className="table-action-stack">
    {available.has("ASSIGN") || available.has("REASSIGN") ? <details>
      <summary>{companyLeadActionLabel(locale, available.has("REASSIGN") ? "REASSIGN" : "ASSIGN")}</summary>
      <form action={assignCompanyLeadAction} className="form-grid">
        <input type="hidden" name="leadId" value={lead.id} />
        <label className="field-full">{copy.chooseManager}<select name="managerUserId" required defaultValue="">
          <option value="" disabled>{copy.chooseManager}</option>
          {managers.map((manager) => <option key={manager.id} value={manager.id}>{manager.name} ({manager.email})</option>)}
        </select></label>
        <label className="field-full">{copy.reason}<textarea name="reason" required minLength={3} maxLength={1000} /></label>
        <button className="button button-primary" type="submit">{copy.assign}</button>
      </form>
    </details> : null}
    {Object.entries(transitions).map(([action, status]) => available.has(action as CompanyLeadAction) ? <details key={action}>
      <summary>{companyLeadActionLabel(locale, action as CompanyLeadAction)}</summary>
      <form action={transitionCompanyLeadAction} className="table-action-stack">
        <input type="hidden" name="leadId" value={lead.id} />
        <input type="hidden" name="status" value={status} />
        <label>{copy.reason}<textarea name="reason" required minLength={3} maxLength={1000} /></label>
        <button className="button button-secondary" type="submit">{copy.submitAction}</button>
      </form>
    </details> : null)}
    {available.has("CONVERT") ? <details>
      <summary>{copy.convert}</summary>
      <form action={convertCompanyLeadAction} className="table-action-stack">
        <input type="hidden" name="leadId" value={lead.id} />
        <label>{copy.reason}<textarea name="reason" required minLength={3} maxLength={1000} /></label>
        <button className="button button-primary" type="submit">{copy.convert}</button>
      </form>
    </details> : null}
    <Link className="button button-secondary" href={`/companies/leads/${lead.id}/export`}>{copy.export}</Link>
    {available.has("ANONYMIZE") ? <details>
      <summary>{copy.anonymize}</summary>
      <form action={anonymizeCompanyLeadAction} className="table-action-stack">
        <input type="hidden" name="leadId" value={lead.id} />
        <label>{copy.reason}<textarea name="reason" required minLength={3} maxLength={1000} /></label>
        <button className="button button-secondary" type="submit">{copy.anonymize}</button>
      </form>
    </details> : null}
  </div>;
}

export default async function CompanyLeadsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, SearchValue>>;
}) {
  const actor = await requirePagePermission("manage_companies");
  const locale: SupportedLocale = actor.preferredLocale ?? "en";
  const timezone = actor.timezone ?? "Asia/Kuala_Lumpur";
  const copy = companyLeadMessages(locale);
  const search = await searchParams;
  const status = first(search.status);
  const assignment = first(search.assignment);
  const duplicateRisk = first(search.duplicateRisk);
  const filters = {
    status: status && (COMPANY_LEAD_STATUSES as readonly string[]).includes(status) ? status : undefined,
    assignment: ["VISIBLE", "ALL", "MINE", "UNASSIGNED"].includes(assignment ?? "") ? assignment : "VISIBLE",
    source: first(search.source)?.slice(0, 80),
    industry: first(search.industry)?.slice(0, 200),
    duplicateRisk: ["CLEAR", "POSSIBLE_DUPLICATE", "CLEARED", "CONFIRMED"].includes(duplicateRisk ?? "") ? duplicateRisk : undefined,
    createdFrom: /^\d{4}-\d{2}-\d{2}$/.test(first(search.createdFrom) ?? "") ? first(search.createdFrom) : undefined,
  };
  const workspace = await loadCompanyLeadWorkspace(actor, filters);
  const selectedLead = first(search.lead);

  return <div className="page-stack">
    <header className="page-header">
      <div><p className="eyebrow">{copy.queueTitle}</p><h1>{copy.queueTitle}</h1><p>{copy.queueIntro}</p></div>
      <div className="action-row">
        {actor.isOwner ? <Link className="button button-primary" href="/companies/leads/new">{copy.createAction}</Link> : null}
        <Link className="button button-secondary" href="/companies">{copy.backToCompanies}</Link>
      </div>
    </header>

    {first(search.notice) === "lead-created" ? <section className="panel" role="status"><strong>{copy.leadCreated}</strong></section> : null}

    <section className="panel" aria-labelledby="lead-filters">
      <h2 id="lead-filters">{copy.filters}</h2>
      <form className="form-grid" method="get">
        <label>{copy.status}<select name="status" defaultValue={filters.status ?? ""}><option value="">{copy.allVisible}</option>{COMPANY_LEAD_STATUSES.map((item) => <option key={item} value={item}>{companyLeadStatusLabel(locale, item)}</option>)}</select></label>
        {workspace.canViewAll ? <label>{copy.assignment}<select name="assignment" defaultValue={filters.assignment}><option value="VISIBLE">{copy.allVisible}</option><option value="MINE">{copy.mine}</option><option value="UNASSIGNED">{copy.unassigned}</option></select></label> : null}
        <label>{copy.source}<input name="source" maxLength={80} defaultValue={filters.source ?? ""} /></label>
        <label>{copy.industry}<input name="industry" maxLength={200} defaultValue={filters.industry ?? ""} /></label>
        <label>{copy.duplicateRisk}<select name="duplicateRisk" defaultValue={filters.duplicateRisk ?? ""}><option value="">{copy.allVisible}</option><option value="CLEAR">CLEAR</option><option value="POSSIBLE_DUPLICATE">POSSIBLE DUPLICATE</option><option value="CLEARED">CLEARED</option><option value="CONFIRMED">CONFIRMED</option></select></label>
        <label>{copy.createdFrom}<input name="createdFrom" type="date" defaultValue={filters.createdFrom ?? ""} /></label>
        <div className="form-actions"><button className="button button-primary" type="submit">{copy.applyFilters}</button></div>
      </form>
    </section>

    {!workspace.leads.length ? <section className="empty-state"><p>{copy.noLeads}</p></section> : null}
    <div className="page-stack">
      {workspace.leads.map((lead) => {
        const available = actionsForRole(actor.role, actor.isOwner, lead.availableActions, lead.status);
        return <article className="panel" key={lead.id} id={`lead-${lead.id}`}>
          <header className="section-heading">
            <div><p className="eyebrow">{lead.code}</p><h2>{lead.companyName}</h2><p>{lead.legalName}</p></div>
            <div className="status-cluster"><span className="status-badge">{companyLeadStatusLabel(locale, lead.status)}</span>{lead.overdue ? <span className="status-badge status-danger">{copy.overdue}</span> : null}</div>
          </header>
          <dl className="summary-grid">
            <div><dt>{copy.contact}</dt><dd>{lead.contactName}</dd></div>
            <div><dt>{copy.location}</dt><dd>{lead.city}<br />{lead.industry}</dd></div>
            <div><dt>{copy.preferences}</dt><dd>{lead.preferredContactMethod}<br /><span dir="ltr">{lead.contactTimezone}</span></dd></div>
            <div><dt>{copy.submitted}</dt><dd>{formatDate(locale, timezone, lead.createdAt)}<br />{copy.due}: {formatDate(locale, timezone, lead.slaDueAt)}</dd></div>
            <div><dt>{copy.assignment}</dt><dd>{lead.assignment?.managerName ?? copy.unassigned}</dd></div>
            <div><dt>{copy.duplicateRisk}</dt><dd>{lead.duplicateRisk}</dd></div>
          </dl>
          <details open={selectedLead === lead.id}>
            <summary>{copy.originalMessage}</summary>
            <div className="page-stack">
              <p><strong>{lead.subject}</strong></p><p className="pre-wrap">{lead.message}</p>
              <p>{copy.company}: {lead.companyName} / {lead.legalName}</p>
              {lead.consentAt ? <p>{copy.consent}: {formatDate(locale, timezone, lead.consentAt)} ({lead.privacyPolicyVersion})</p> : null}
              <p>{copy.retentionUntil}: {formatDate(locale, timezone, lead.retentionUntil)}</p>
              {lead.convertedCompanyId ? <p>{copy.convertedCompany}: <Link href={`/companies?created=${lead.convertedCompanyId}`}>{lead.convertedCompanyId}</Link></p> : null}
              <LeadActions lead={lead} managers={workspace.managers} locale={locale} available={available} />

              {lead.duplicateCandidates.length ? <section><h3>{copy.duplicateCandidates}</h3>{lead.duplicateCandidates.map((candidate) => <div className="subpanel" key={candidate.id}>
                <p><strong>{candidate.kind}: {candidate.label}</strong></p>{visibleMatchedFields(candidate.matchedFields).length ? <p>{copy.matched}: {visibleMatchedFields(candidate.matchedFields).join(", ")}</p> : null}<p>{candidate.reviewStatus}</p>
                {candidate.reviewStatus === "PENDING" && available.has("REVIEW_DUPLICATE") ? <form action={resolveCompanyLeadDuplicateAction} className="form-grid">
                  <input type="hidden" name="leadId" value={lead.id} /><input type="hidden" name="candidateId" value={candidate.id} />
                  <label>{copy.reason}<input name="reason" minLength={3} maxLength={1000} required /></label>
                  <div className="form-actions"><button className="button button-secondary" name="resolution" value="CLEAR" type="submit">{copy.clearCandidate}</button><button className="button button-secondary" name="resolution" value="CONFIRM" type="submit">{copy.confirmDuplicate}</button></div>
                </form> : null}
              </div>)}</section> : null}

              {available.has("ADD_NOTE") ? <section><h3>{copy.addNote}</h3><form action={addCompanyLeadNoteAction} className="form-grid">
                <input type="hidden" name="leadId" value={lead.id} />
                <label>{copy.noteType}<select name="noteType"><option value="INTERNAL">INTERNAL</option><option value="CONTACT_ATTEMPT">CONTACT ATTEMPT</option><option value="INFORMATION_RECEIVED">INFORMATION RECEIVED</option></select></label>
                <label className="field-full">{copy.note}<textarea name="note" required minLength={2} maxLength={5000} /></label>
                <button className="button button-secondary" type="submit">{copy.addNote}</button>
              </form></section> : null}
              {lead.notes.length ? <section><h3>{copy.notes}</h3><ol className="timeline">{lead.notes.map((note) => <li key={note.id}><strong>{note.type}</strong> {note.note}<br /><small>{note.createdByName}, {formatDate(locale, timezone, note.createdAt)}</small></li>)}</ol></section> : null}

              {available.has("ADD_TASK") ? <section><h3>{copy.addTask}</h3><form action={addCompanyLeadTaskAction} className="form-grid">
                <input type="hidden" name="leadId" value={lead.id} />
                <label>{copy.taskTitle}<input name="title" minLength={2} maxLength={240} required /></label>
                <label>{copy.taskDue}<input name="dueAt" type="datetime-local" required /></label>
                <label>{copy.taskOwner}<select name="assignedUserId" required defaultValue=""><option value="" disabled>{copy.taskOwner}</option>{workspace.managers.map((manager) => <option key={manager.id} value={manager.id}>{manager.name}</option>)}</select></label>
                <button className="button button-secondary" type="submit">{copy.addTask}</button>
              </form></section> : null}
              {lead.tasks.length ? <section><h3>{copy.tasks}</h3>{lead.tasks.map((task) => <div className="subpanel" key={task.id}><p><strong>{task.title}</strong> / {task.assignedUserName} / {formatDate(locale, timezone, task.dueAt)} / {task.status}</p>{task.status === "OPEN" ? <form action={completeCompanyLeadTaskAction} className="form-grid"><input type="hidden" name="leadId" value={lead.id} /><input type="hidden" name="taskId" value={task.id} /><label>{copy.completionNote}<input name="completionNote" maxLength={1000} /></label><button className="button button-secondary" type="submit">{copy.complete}</button></form> : task.completionNote ? <p>{task.completionNote}</p> : null}</div>)}</section> : null}

              <section><h3>{copy.timeline}</h3><ol className="timeline">{lead.statusHistory.map((item, index) => <li key={`${item.toStatus}-${item.changedAt.toISOString()}-${index}`}><strong>{companyLeadStatusLabel(locale, item.toStatus)}</strong> {item.reason}<br /><small>{item.changedByName ?? "Axora"}, {formatDate(locale, timezone, item.changedAt)}</small></li>)}</ol></section>
            </div>
          </details>
        </article>;
      })}
    </div>
  </div>;
}
