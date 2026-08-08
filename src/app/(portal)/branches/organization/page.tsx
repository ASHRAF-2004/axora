import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { requirePagePermission } from "@/lib/auth";
import { formatDateTime } from "@/lib/domain";
import { loadOrganizationStructureWorkspace } from "@/lib/organization-structure";
import { organizationStructureMessages } from "@/lib/organization-structure-i18n";
import Link from "next/link";
import { saveOrganizationNodeAction, setOrganizationNodeActiveAction } from "./actions";

const TIMEZONES = ["Asia/Kuala_Lumpur", "Asia/Singapore", "Asia/Riyadh", "Asia/Dubai", "UTC"];

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function OrganizationPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requirePagePermission("view_branches");
  const locale = actor.preferredLocale ?? "en";
  const copy = organizationStructureMessages(locale);
  const [workspace, query] = await Promise.all([
    loadOrganizationStructureWorkspace(actor),
    searchParams,
  ]);
  const companyName = new Map(workspace.companies.map((company) => [company.id, company.name]));
  const branchName = new Map(workspace.branches.map((branch) => [branch.id, branch.name]));
  const departmentName = new Map(workspace.departments.map((department) => [department.id, department.name]));
  const businessUnitName = new Map(workspace.businessUnits.map((unit) => [unit.id, unit.name]));
  const depth = (id: string, parents: Map<string, string | undefined>) => {
    let value = 0;
    let current = parents.get(id);
    while (current && value < 12) { value += 1; current = parents.get(current); }
    return value;
  };
  const departmentParents = new Map(workspace.departments.map((item) => [item.id, item.parentDepartmentId]));
  const unitParents = new Map(workspace.businessUnits.map((item) => [item.id, item.parentBusinessUnitId]));
  const notice = first(query.notice) === "saved" ? copy.saved : undefined;

  const StatusForm = ({ nodeType, nodeId, active }: {
    nodeType: "BRANCH" | "DEPARTMENT" | "BUSINESS_UNIT" | "COST_CENTRE" | "DELIVERY_LOCATION";
    nodeId: string;
    active: boolean;
  }) => <form action={setOrganizationNodeActiveAction} className="table-action-stack">
    <input type="hidden" name="nodeType" value={nodeType} /><input type="hidden" name="nodeId" value={nodeId} /><input type="hidden" name="active" value={active ? "false" : "true"} />
    <input name="reason" required minLength={3} maxLength={1000} placeholder={copy.reason} aria-label={copy.reason} />
    <button className="button button-secondary" type="submit">{active ? copy.deactivate : copy.reactivate}</button>
  </form>;

  const companyOptions = workspace.companies.filter((company) => company.status === "Active");

  return <>
    <PageHeader eyebrow={copy.eyebrow} title={copy.title} description={copy.description} />
    <div className="action-row" style={{ marginBlockEnd: 16 }}><Link className="button button-secondary" href="/branches">{copy.back}</Link></div>
    {notice ? <section className="panel" role="status" aria-live="polite"><strong>{notice}</strong></section> : null}

    <section className="panel" style={{ marginBlockStart: 16 }}><div className="panel-header"><div><h2>{copy.hierarchy}</h2><p>{copy.hierarchyHelp}</p></div></div>
      <div className="data-table-wrap"><table className="data-table"><thead><tr><th>{copy.branches}</th><th>{copy.company}</th><th>{copy.timezone}</th><th>{copy.active}</th>{workspace.canManageBranches ? <th>{copy.update}</th> : null}</tr></thead><tbody>{workspace.branches.map((branch) => <tr key={branch.id}><td><strong>{branch.name}</strong><br /><span className="subtle">{branch.branchCode}</span></td><td>{branch.companyName}</td><td>{branch.timezone}</td><td><StatusBadge status={branch.status}>{branch.status === "Active" ? copy.active : copy.inactive}</StatusBadge></td>{workspace.canManageBranches ? <td><details><summary>{copy.edit}</summary><form action={saveOrganizationNodeAction} className="table-action-stack"><input type="hidden" name="nodeType" value="BRANCH" /><input type="hidden" name="nodeId" value={branch.id} /><input type="hidden" name="companyId" value={branch.companyId} /><input type="hidden" name="code" value={branch.branchCode} /><label>{copy.name}<input name="name" defaultValue={branch.name} required /></label><label>{copy.timezone}<select name="timezone" defaultValue={branch.timezone}>{TIMEZONES.map((zone) => <option key={zone}>{zone}</option>)}</select></label><label>{copy.reason}<input name="reason" required minLength={3} /></label><button className="button button-secondary" type="submit">{copy.update}</button></form></details><StatusForm nodeType="BRANCH" nodeId={branch.id} active={branch.status === "Active"} /></td> : null}</tr>)}</tbody></table></div>
    </section>

    <section className="detail-grid" style={{ marginBlockStart: 17 }}>
      <article className="panel"><h2>{copy.departments}</h2>{workspace.departments.length ? <ul className="list-reset">{workspace.departments.map((department) => <li key={department.id} className="callout" style={{ marginInlineStart: `${depth(department.id, departmentParents) * 18}px`, marginBlockEnd: 8 }}><div className="panel-header"><div><strong>{department.name}</strong><br /><span className="subtle">{department.code} · {branchName.get(department.branchId ?? "") ?? companyName.get(department.companyId)}</span></div><StatusBadge>{department.active ? copy.active : copy.inactive}</StatusBadge></div>{workspace.canManageDepartments ? <StatusForm nodeType="DEPARTMENT" nodeId={department.id} active={department.active} /> : null}</li>)}</ul> : <p className="subtle">{copy.noRecords}</p>}</article>
      <article className="panel"><h2>{copy.businessUnits}</h2>{workspace.businessUnits.length ? <ul className="list-reset">{workspace.businessUnits.map((unit) => <li key={unit.id} className="callout" style={{ marginInlineStart: `${depth(unit.id, unitParents) * 18}px`, marginBlockEnd: 8 }}><div className="panel-header"><div><strong>{unit.name}</strong><br /><span className="subtle">{unit.code} · {companyName.get(unit.companyId)}</span></div><StatusBadge>{unit.active ? copy.active : copy.inactive}</StatusBadge></div>{workspace.canManageCostCentres ? <StatusForm nodeType="BUSINESS_UNIT" nodeId={unit.id} active={unit.active} /> : null}</li>)}</ul> : <p className="subtle">{copy.noRecords}</p>}</article>
    </section>

    {(workspace.canManageDepartments || workspace.canManageCostCentres || workspace.canManageDeliveryLocations) ? <section className="detail-grid" style={{ marginBlockStart: 17 }}>
      {workspace.canManageDepartments ? <article className="panel form-panel"><h2>{copy.createDepartment}</h2><form action={saveOrganizationNodeAction} className="form-grid"><input type="hidden" name="nodeType" value="DEPARTMENT" /><label>{copy.company}<select name="companyId" required>{companyOptions.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}</select></label><label>{copy.branch}<select name="branchId"><option value="">{copy.noDepartment}</option>{workspace.branches.filter((branch) => branch.status === "Active").map((branch) => <option key={branch.id} value={branch.id}>{branch.companyName} · {branch.name}</option>)}</select></label><label>{copy.parent}<select name="parentId"><option value="">{copy.noParent}</option>{workspace.departments.filter((item) => item.active).map((item) => <option key={item.id} value={item.id}>{companyName.get(item.companyId)} · {item.name}</option>)}</select></label><label>{copy.code}<input name="code" required pattern="[A-Za-z0-9][A-Za-z0-9_-]{1,39}" /></label><label>{copy.name}<input name="name" required /></label><label>{copy.timezone}<select name="timezone" defaultValue="Asia/Kuala_Lumpur">{TIMEZONES.map((zone) => <option key={zone}>{zone}</option>)}</select></label><label className="field-full">{copy.descriptionLabel}<textarea name="description" maxLength={1000} /></label><label className="field-full">{copy.reason}<input name="reason" required minLength={3} /></label><div className="form-actions field-full"><button className="button button-primary" type="submit">{copy.create}</button></div></form></article> : null}
      {workspace.canManageCostCentres ? <article className="panel form-panel"><h2>{copy.createBusinessUnit}</h2><form action={saveOrganizationNodeAction} className="form-grid"><input type="hidden" name="nodeType" value="BUSINESS_UNIT" /><label>{copy.company}<select name="companyId" required>{companyOptions.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}</select></label><label>{copy.parent}<select name="parentId"><option value="">{copy.noParent}</option>{workspace.businessUnits.filter((item) => item.active).map((item) => <option key={item.id} value={item.id}>{companyName.get(item.companyId)} · {item.name}</option>)}</select></label><label>{copy.code}<input name="code" required pattern="[A-Za-z0-9][A-Za-z0-9_-]{1,39}" /></label><label>{copy.name}<input name="name" required /></label><label className="field-full">{copy.descriptionLabel}<textarea name="description" maxLength={1000} /></label><label className="field-full">{copy.reason}<input name="reason" required minLength={3} /></label><div className="form-actions field-full"><button className="button button-primary" type="submit">{copy.create}</button></div></form></article> : null}
      {workspace.canManageCostCentres ? <article className="panel form-panel"><h2>{copy.createCostCentre}</h2><form action={saveOrganizationNodeAction} className="form-grid"><input type="hidden" name="nodeType" value="COST_CENTRE" /><label>{copy.company}<select name="companyId" required>{companyOptions.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}</select></label><label>{copy.businessUnit}<select name="businessUnitId"><option value="">{copy.noParent}</option>{workspace.businessUnits.filter((item) => item.active).map((item) => <option key={item.id} value={item.id}>{companyName.get(item.companyId)} · {item.name}</option>)}</select></label><label>{copy.branch}<select name="branchId"><option value="">{copy.noDepartment}</option>{workspace.branches.filter((branch) => branch.status === "Active").map((branch) => <option key={branch.id} value={branch.id}>{branch.companyName} · {branch.name}</option>)}</select></label><label>{copy.department}<select name="departmentId"><option value="">{copy.noDepartment}</option>{workspace.departments.filter((item) => item.active).map((item) => <option key={item.id} value={item.id}>{companyName.get(item.companyId)} · {item.name}</option>)}</select></label><label>{copy.code}<input name="code" required /></label><label>{copy.name}<input name="name" required /></label><label>{copy.currency}<input name="currency" defaultValue="MYR" required pattern="[A-Za-z]{3}" /></label><label className="field-full">{copy.descriptionLabel}<textarea name="description" /></label><label className="field-full">{copy.reason}<input name="reason" required minLength={3} /></label><div className="form-actions field-full"><button className="button button-primary" type="submit">{copy.create}</button></div></form></article> : null}
      {workspace.canManageDeliveryLocations ? <article className="panel form-panel"><h2>{copy.createDeliveryLocation}</h2><form action={saveOrganizationNodeAction} className="form-grid"><input type="hidden" name="nodeType" value="DELIVERY_LOCATION" /><label>{copy.company}<select name="companyId" required>{companyOptions.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}</select></label><label>{copy.branch}<select name="branchId" required>{workspace.branches.filter((branch) => branch.status === "Active").map((branch) => <option key={branch.id} value={branch.id}>{branch.companyName} · {branch.name}</option>)}</select></label><label>{copy.department}<select name="departmentId"><option value="">{copy.noDepartment}</option>{workspace.departments.filter((item) => item.active).map((item) => <option key={item.id} value={item.id}>{companyName.get(item.companyId)} · {item.name}</option>)}</select></label><label>{copy.code}<input name="code" required /></label><label>{copy.name}<input name="name" required /></label><label>{copy.city}<input name="city" required /></label><label className="field-full">{copy.address}<textarea name="address" required /></label><label>{copy.state}<input name="stateRegion" /></label><label>{copy.postalCode}<input name="postalCode" /></label><label>{copy.countryCode}<input name="countryCode" defaultValue="MY" required /></label><label>{copy.timezone}<select name="timezone" defaultValue="Asia/Kuala_Lumpur">{TIMEZONES.map((zone) => <option key={zone}>{zone}</option>)}</select></label><label>{copy.contactName}<input name="contactName" /></label><label>{copy.contactPhone}<input name="contactPhone" /></label><label>{copy.contactEmail}<input name="contactEmail" type="email" /></label><label className="field-full">{copy.instructions}<textarea name="deliveryInstructions" /></label><label className="field-full"><input type="checkbox" name="isPrimary" value="true" /> {copy.primary}</label><label className="field-full">{copy.reason}<input name="reason" required minLength={3} /></label><div className="form-actions field-full"><button className="button button-primary" type="submit">{copy.create}</button></div></form></article> : null}
    </section> : null}

    <section className="detail-grid" style={{ marginBlockStart: 17 }}>
      <article className="panel"><h2>{copy.costCentres}</h2>{workspace.costCentres.length ? <ul>{workspace.costCentres.map((centre) => <li key={centre.id}><strong>{centre.code} · {centre.name}</strong> · {centre.currency}<br /><span className="subtle">{businessUnitName.get(centre.businessUnitId ?? "") ?? branchName.get(centre.branchId ?? "") ?? companyName.get(centre.companyId)} · {departmentName.get(centre.departmentId ?? "") ?? ""}</span>{workspace.canManageCostCentres ? <StatusForm nodeType="COST_CENTRE" nodeId={centre.id} active={centre.active} /> : null}</li>)}</ul> : <p className="subtle">{copy.noRecords}</p>}</article>
      <article className="panel"><h2>{copy.deliveryLocations}</h2>{workspace.deliveryLocations.length ? <ul>{workspace.deliveryLocations.map((location) => <li key={location.id}><strong>{location.code} · {location.name}</strong><br /><span className="subtle">{branchName.get(location.branchId)} · {location.city} · {location.address}</span>{workspace.canManageDeliveryLocations ? <StatusForm nodeType="DELIVERY_LOCATION" nodeId={location.id} active={location.active} /> : null}</li>)}</ul> : <p className="subtle">{copy.noRecords}</p>}</article>
    </section>

    <section className="panel" style={{ marginBlockStart: 17 }}><div className="panel-header"><div><h2>{copy.history}</h2><p>{copy.hierarchyHelp}</p></div></div>{workspace.history.length ? <div className="data-table-wrap"><table className="data-table"><tbody>{workspace.history.map((entry) => <tr key={entry.id}><td>{entry.nodeType.replaceAll("_", " ")}</td><td><StatusBadge>{entry.changeType}</StatusBadge></td><td>{entry.reason}</td><td>{entry.changedByName ?? "-"}</td><td>{formatDateTime(entry.changedAt.toISOString(), locale, actor.timezone ?? "Asia/Kuala_Lumpur")}</td></tr>)}</tbody></table></div> : <div className="panel-body"><p className="subtle">{copy.noRecords}</p></div>}</section>
  </>;
}
