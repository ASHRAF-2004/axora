import { randomUUID } from "node:crypto";
import { PageHeader } from "@/components/PageHeader";
import { requirePermission } from "@/lib/auth";
import { getCategoryPolicyWorkspace } from "@/lib/category-policy";
import { categoryPolicyMessages } from "@/lib/category-policy-i18n";
import { updateCategoryPolicyAction } from "./actions";

export default async function ProcurementSettingsPage({
  searchParams,
}: { searchParams: Promise<{ notice?: string }> }) {
  const actor = await requirePermission("manage_category_policy");
  const { notice } = await searchParams;
  const copy = categoryPolicyMessages(actor.preferredLocale ?? "en");
  const workspace = await getCategoryPolicyWorkspace(actor);
  const noticeText = notice && notice in copy
    ? copy[notice as "saved" | "stale" | "parent" | "denied" | "failed"] : null;
  return <>
    <PageHeader eyebrow={copy.eyebrow} title={copy.title} description={copy.description} />
    {noticeText ? <div className="callout" role="status" aria-live="polite">{noticeText}</div> : null}
    {!workspace.scopes.length ? <div className="callout" role="status">{copy.noScopes}</div> : (
      <section className="settings-pricing-grid" aria-label={copy.title}>
        {workspace.scopes.map((scope) => {
          const scopeLabel = scope.type === "COMPANY" ? copy.company
            : scope.type === "BRANCH" ? copy.branch : copy.department;
          const name = scope.departmentName ?? scope.branchName ?? scope.companyName;
          return <form action={updateCategoryPolicyAction} className="settings-pricing-card" key={`${scope.type}:${scope.departmentId ?? scope.branchId ?? scope.companyId}`}>
            <input type="hidden" name="scopeType" value={scope.type} />
            <input type="hidden" name="companyId" value={scope.companyId} />
            <input type="hidden" name="branchId" value={scope.branchId ?? ""} />
            <input type="hidden" name="departmentId" value={scope.departmentId ?? ""} />
            <input type="hidden" name="expectedVersion" value={scope.version ?? 0} />
            <input type="hidden" name="commandId" value={randomUUID()} />
            <div><strong>{scopeLabel}: {name}</strong><p>{scope.companyName}{scope.branchName ? ` · ${scope.branchName}` : ""}</p></div>
            <label className="policy-confirmation">
              <input name="enabled" type="checkbox" defaultChecked={scope.enabled} />
              <span><span><strong>{copy.enabled}</strong><small>{copy.ruleHelp}</small></span></span>
            </label>
            <fieldset>
              <legend>{copy.categories}</legend>
              <div className="permission-grid">
                {workspace.categories.map((category) => <label key={category} className="policy-confirmation">
                  <input name="allowedCategory" type="checkbox" value={category} defaultChecked={scope.allowedCategories.includes(category)} />
                  <span>{category}</span>
                </label>)}
              </div>
            </fieldset>
            <button className="button button-primary" type="submit">{copy.save}</button>
          </form>;
        })}
      </section>
    )}
  </>;
}
