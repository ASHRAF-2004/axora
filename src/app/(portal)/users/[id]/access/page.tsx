import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import {
  accessAdministrationMessages,
  accessAdministrationNotice,
  localizedAccessChangeType,
} from "@/lib/access-administration-i18n";
import {
  AccessAdministrationUnavailableError,
  loadAccessAdministration,
  type AccessAdministrationSnapshot,
} from "@/lib/access-administration";
import { requirePagePermission } from "@/lib/auth";
import { formatDateTime } from "@/lib/domain";
import type { SupportedLocale } from "@/lib/i18n";
import { localizedAccountRole } from "@/lib/user-form-i18n";
import { formatZonedDateTimeInput } from "@/lib/zoned-date-time";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  removePermissionOverrideAction,
  setPermissionOverrideAction,
} from "./actions";

type Scope = AccessAdministrationSnapshot["selectedScope"];
type PermissionOption = AccessAdministrationSnapshot["permissionOptions"][number];

function scopeLabel(
  scope: AccessAdministrationSnapshot["assignments"][number]["scope"] | Scope,
  locale: SupportedLocale,
) {
  const copy = accessAdministrationMessages(locale);
  if (scope.type === "PLATFORM") return copy.platform;
  if (scope.type === "DELIVERY") return copy.delivery;
  const names = [
    scope.companyName,
    scope.branchName,
    scope.departmentName,
    scope.supplierName,
  ].filter((value): value is string => Boolean(value));
  return names.length
    ? `${copy.scopeTypes[scope.type]} · ${names.join(" · ")}`
    : copy.scopeTypes[scope.type];
}

function formatMoney(
  amount: string,
  currency: string,
  locale: SupportedLocale,
) {
  const regionalLocale = locale === "ar" ? "ar-MY"
    : locale === "ms" ? "ms-MY" : "en-MY";
  return new Intl.NumberFormat(regionalLocale, {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(Number(amount));
}

function PermissionOverrideForm({
  copy,
  effect,
  options,
  startsAt,
  timeZone,
  minimumExpiry,
  action,
}: {
  copy: ReturnType<typeof accessAdministrationMessages>;
  effect: "GRANT" | "DENY";
  options: PermissionOption[];
  startsAt: string;
  timeZone: string;
  minimumExpiry: string;
  action: (formData: FormData) => void | Promise<void>;
}) {
  if (!options.length) return null;
  return (
    <form action={action} className="panel form-panel">
      <h3>{effect === "GRANT" ? copy.grant : copy.deny}</h3>
      <input type="hidden" name="effect" value={effect} />
      <input type="hidden" name="startsAt" value={startsAt} />
      <div className="form-grid">
        <label className="field-full">{copy.permission}
          <select name="permission" required defaultValue="">
            <option value="" disabled>{copy.permission}</option>
            {options.map((permission) => (
              <option key={permission.code} value={permission.code}>
                {permission.group} · {permission.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field-full">{copy.expiresAt} <span className="subtle">({copy.optional})</span>
          <input name="endsAt" type="datetime-local" min={minimumExpiry} />
          <small>{timeZone}</small>
        </label>
        <label className="field-full">{copy.reason}
          <textarea
            name="reason"
            required
            minLength={3}
            maxLength={500}
            placeholder={copy.reasonPlaceholder}
          />
        </label>
      </div>
      <div className="form-actions">
        <button
          className="button button-primary"
          type="submit"
          data-feedback-label={copy.applying}
        >{copy.apply}</button>
      </div>
    </form>
  );
}

export default async function UserAccessPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ assignment?: string; notice?: string }>;
}) {
  const actor = await requirePagePermission("manage_users");
  const locale = actor.preferredLocale ?? "en";
  const timeZone = actor.timezone ?? "Asia/Kuala_Lumpur";
  const copy = accessAdministrationMessages(locale);
  const { id } = await params;
  const query = await searchParams;

  let snapshot: AccessAdministrationSnapshot;
  try {
    snapshot = await loadAccessAdministration(actor, id, query.assignment);
  } catch (error) {
    if (error instanceof AccessAdministrationUnavailableError) notFound();
    throw error;
  }

  const selectedAssignment = snapshot.assignments.find((assignment) => (
    assignment.id === snapshot.selectedAssignmentId
  ));
  if (!selectedAssignment) notFound();

  const selectedScope = snapshot.selectedScope;
  const actionArguments = [
    snapshot.identity.id,
    snapshot.selectedAssignmentId,
    selectedScope.type,
    selectedScope.companyId,
    selectedScope.branchId,
    selectedScope.departmentId,
    selectedScope.supplierId,
  ] as const;
  const setOverrideAction = setPermissionOverrideAction.bind(
    null,
    ...actionArguments,
  );
  const grantableOptions = snapshot.permissionOptions.filter((permission) => (
    permission.actorCanGrant
  ));
  const groupedPermissions = new Map<string, PermissionOption[]>();
  for (const permission of snapshot.permissionOptions) {
    const group = groupedPermissions.get(permission.group) ?? [];
    group.push(permission);
    groupedPermissions.set(permission.group, group);
  }
  const notice = accessAdministrationNotice(locale, query.notice);
  const minimumExpiry = formatZonedDateTimeInput(
    new Date(snapshot.capturedAt.getTime() + 60_000),
    timeZone,
  );

  return (
    <>
      <PageHeader
        eyebrow={copy.eyebrow}
        title={copy.title(snapshot.identity.displayName)}
        description={copy.description}
      />

      <p><Link href="/users" className="button button-secondary">{copy.backToUsers}</Link></p>

      {notice ? <div className="callout" role="status"><strong>{notice}</strong></div> : null}

      <section className="detail-grid">
        <article className="panel">
          <div className="panel-header"><div><h2>{copy.identity}</h2><p>{snapshot.identity.email}</p></div></div>
          <div className="panel-body">
            <dl className="detail-list">
              <div><dt>{copy.account}</dt><dd>{snapshot.identity.accountKind}</dd></div>
              <div><dt>{copy.jobTitle}</dt><dd>{snapshot.identity.jobTitle ?? "—"}</dd></div>
              <div><dt>{copy.assignment}</dt><dd>{localizedAccountRole(selectedAssignment.roleKey, locale)?.label ?? selectedAssignment.roleLabel}</dd></div>
              <div><dt>{copy.scopeTypes[selectedScope.type]}</dt><dd>{scopeLabel(selectedAssignment.scope, locale)}</dd></div>
            </dl>
          </div>
        </article>

        <article className="panel">
          <div className="panel-header"><div><h2>{copy.assignments}</h2><p>{copy.assignmentsDescription}</p></div></div>
          <div className="panel-body">
            <div className="table-action-stack">
              {snapshot.assignments.map((assignment) => (
                <div className="callout" key={assignment.id}>
                  <strong>{localizedAccountRole(assignment.roleKey, locale)?.label ?? assignment.roleLabel}</strong>
                  <p>{scopeLabel(assignment.scope, locale)}</p>
                  <div className="action-row">
                    {assignment.selected
                      ? <StatusBadge status="Active">{copy.selected}</StatusBadge>
                      : <Link
                          className="button button-secondary"
                          href={`/users/${snapshot.identity.id}/access?assignment=${assignment.id}`}
                        >{copy.assignment}</Link>}
                    <span className="subtle">{assignment.manageable ? copy.manageable : copy.viewOnly}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </article>
      </section>

      <section className="panel" style={{ marginBlockStart: 17 }}>
        <div className="panel-header"><div><h2>{copy.permissions}</h2><p>{copy.permissionsDescription}</p></div></div>
        <div className="panel-body">
          {[...groupedPermissions.entries()].map(([group, permissions]) => (
            <div key={group} style={{ marginBlockEnd: 24 }}>
              <h3>{group}</h3>
              <div className="data-table-wrap"><table className="data-table"><thead><tr>
                <th>{copy.permission}</th><th>{copy.source}</th><th>{copy.outcome}</th><th>{copy.highRisk}</th>
              </tr></thead><tbody>
                {permissions.map((permission) => (
                  <tr key={permission.code}>
                    <td><strong>{permission.label}</strong><br /><span className="subtle">{permission.description}</span></td>
                    <td>{permission.targetRoleIncludes ? copy.roleIncluded : copy.roleNotIncluded}</td>
                    <td><StatusBadge status={permission.effective ? "Active" : "Inactive"}>{permission.effective ? copy.effective : copy.notEffective}</StatusBadge></td>
                    <td>{permission.highRisk ? copy.highRisk : copy.standardRisk}</td>
                  </tr>
                ))}
              </tbody></table></div>
            </div>
          ))}
        </div>
      </section>

      <section style={{ marginBlockStart: 17 }}>
        <div className="panel-header"><div><h2>{copy.applyOverride}</h2><p>{copy.applyOverrideDescription}</p></div></div>
        {snapshot.canManagePermissions ? (
          <div className="detail-grid">
            <PermissionOverrideForm
              copy={copy}
              effect="GRANT"
              options={grantableOptions}
              startsAt={snapshot.capturedAt.toISOString()}
              timeZone={timeZone}
              minimumExpiry={minimumExpiry}
              action={setOverrideAction}
            />
            <PermissionOverrideForm
              copy={copy}
              effect="DENY"
              options={snapshot.permissionOptions}
              startsAt={snapshot.capturedAt.toISOString()}
              timeZone={timeZone}
              minimumExpiry={minimumExpiry}
              action={setOverrideAction}
            />
          </div>
        ) : <div className="callout"><strong>{copy.noManagePermission}</strong></div>}
      </section>

      <section className="panel" style={{ marginBlockStart: 17 }}>
        <div className="panel-header"><div><h2>{copy.overrides}</h2><p>{copy.overridesDescription}</p></div></div>
        {snapshot.permissionOverrides.length ? (
          <div className="data-table-wrap"><table className="data-table"><thead><tr>
            <th>{copy.permission}</th><th>{copy.effect}</th><th>{copy.assignment}</th><th>{copy.period}</th><th>{copy.changedBy}</th><th>{copy.remove}</th>
          </tr></thead><tbody>
            {snapshot.permissionOverrides.map((override) => {
              const removeAction = removePermissionOverrideAction.bind(
                null,
                snapshot.identity.id,
                snapshot.selectedAssignmentId,
                override.id,
              );
              return <tr key={override.id}>
                <td><strong>{override.permissionLabel}</strong><br /><span className="subtle">{override.reason}</span></td>
                <td><StatusBadge status={override.effect === "GRANT" ? "Active" : "Inactive"}>{override.effect === "GRANT" ? copy.grant : copy.deny}</StatusBadge></td>
                <td>{scopeLabel(override.scope, locale)}</td>
                <td>{formatDateTime(override.startsAt.toISOString(), locale, timeZone)} — {override.endsAt ? formatDateTime(override.endsAt.toISOString(), locale, timeZone) : copy.noExpiry}</td>
                <td>{override.changedByName}</td>
                <td>{override.manageable ? (
                  <form action={removeAction}>
                    <label><span className="sr-only">{copy.removeReason}</span>
                      <input name="reason" minLength={3} maxLength={500} required placeholder={copy.removeReason} />
                    </label>
                    <button className="button button-secondary" type="submit" data-feedback-label={copy.removing}>{copy.remove}</button>
                  </form>
                ) : <span className="subtle">{copy.viewOnly}</span>}</td>
              </tr>;
            })}
          </tbody></table></div>
        ) : <div className="panel-body"><p className="subtle">{copy.noOverrides}</p></div>}
      </section>

      <section className="panel" style={{ marginBlockStart: 17 }}>
        <div className="panel-header"><div><h2>{copy.approvalLimits}</h2><p>{copy.approvalLimitsDescription}</p></div></div>
        {snapshot.approvalLimits.length ? (
          <div className="data-table-wrap"><table className="data-table"><thead><tr>
            <th>{copy.permission}</th><th>{copy.amount}</th><th>{copy.subject}</th><th>{copy.selfApproval}</th><th>{copy.assignment}</th><th>{copy.period}</th>
          </tr></thead><tbody>
            {snapshot.approvalLimits.map((limit) => <tr key={limit.id}>
              <td><strong>{limit.permissionLabel}</strong><br /><span className="subtle">{limit.reason}</span></td>
              <td>{formatMoney(limit.maximumAmount, limit.currency, locale)}</td>
              <td>{limit.subjectType === "USER" ? copy.userSubject : copy.roleSubject}</td>
              <td>{limit.allowSelfApproval ? copy.allowed : copy.notAllowed}</td>
              <td>{scopeLabel(limit.scope, locale)}</td>
              <td>{formatDateTime(limit.startsAt.toISOString(), locale, timeZone)} — {limit.endsAt ? formatDateTime(limit.endsAt.toISOString(), locale, timeZone) : copy.noExpiry}</td>
            </tr>)}
          </tbody></table></div>
        ) : <div className="panel-body"><p className="subtle">{copy.noApprovalLimits}</p></div>}
      </section>

      <section className="panel" style={{ marginBlockStart: 17 }}>
        <div className="panel-header"><div><h2>{copy.delegatedAccess}</h2><p>{copy.delegatedAccessDescription}</p></div></div>
        {snapshot.delegations.length ? (
          <div className="data-table-wrap"><table className="data-table"><thead><tr>
            <th>{copy.authorizedBy}</th><th>{copy.permissions}</th><th>{copy.assignment}</th><th>{copy.period}</th><th>{copy.reason}</th>
          </tr></thead><tbody>
            {snapshot.delegations.map((delegation) => <tr key={delegation.id}>
              <td>{delegation.authorizedByName}</td>
              <td>{delegation.permissions.join(", ")}</td>
              <td>{delegation.scopes.map((scope) => scopeLabel(scope, locale)).join("; ")}</td>
              <td>{formatDateTime(delegation.startsAt.toISOString(), locale, timeZone)} — {formatDateTime(delegation.endsAt.toISOString(), locale, timeZone)}</td>
              <td>{delegation.reason}</td>
            </tr>)}
          </tbody></table></div>
        ) : <div className="panel-body"><p className="subtle">{copy.noDelegations}</p></div>}
      </section>

      <section className="panel" style={{ marginBlockStart: 17 }}>
        <div className="panel-header"><div><h2>{copy.history}</h2><p>{copy.historyDescription}</p></div></div>
        {!snapshot.canViewHistory ? (
          <div className="panel-body"><p className="subtle">{copy.historyUnavailable}</p></div>
        ) : snapshot.history.length ? (
          <div className="data-table-wrap"><table className="data-table"><thead><tr>
            <th>{copy.outcome}</th><th>{copy.changedBy}</th><th>{copy.reason}</th><th>{copy.occurredAt}</th>
          </tr></thead><tbody>
            {snapshot.history.map((entry) => <tr key={entry.id}>
              <td>{localizedAccessChangeType(locale, entry.changeType)}</td>
              <td>{entry.actorName}</td>
              <td>{entry.reason}</td>
              <td>{formatDateTime(entry.occurredAt.toISOString(), locale, timeZone)}</td>
            </tr>)}
          </tbody></table></div>
        ) : <div className="panel-body"><p className="subtle">{copy.noHistory}</p></div>}
      </section>
    </>
  );
}