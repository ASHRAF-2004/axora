import { PageHeader } from "@/components/PageHeader";
import { requireSession } from "@/lib/auth";
import { isDemoMode } from "@/lib/db";
import { canAccess } from "@/lib/permissions";
import { listCompanies } from "@/lib/repository";
import { COD_PAYMENT_METHOD } from "@/lib/types";
import {
  Building2,
  Clock3,
  Coins,
  Database,
  FileCheck2,
  KeyRound,
  Percent,
  ShieldCheck,
  Truck,
  UserRoundCog,
} from "lucide-react";
import { updateCompanyPricingAction, updateProfileImagePolicyAction } from "./actions";
import { operationalMessage, type OperationalMessageKey } from "@/lib/operational-i18n";
import { getProfileImagePolicy } from "@/lib/profile-images";
import { profileImageMessages } from "@/lib/profile-image-i18n";

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  const actor = await requireSession();
  const { notice } = await searchParams;
  const locale = actor.preferredLocale ?? "en";
  const m = (key: OperationalMessageKey) => operationalMessage(locale, key);
  const mayManageCommercialSettings = canAccess(actor, "manage_commercial_pricing");
  const mayViewDiagnostics = canAccess(actor, "view_system_diagnostics");
  const mayManageProfileImages = canAccess(actor, "manage_settings");
  const platformWorkspace = actor.accountKind === "PLATFORM" || actor.isOwner;
  const companies = mayManageCommercialSettings || (mayManageProfileImages && platformWorkspace)
    ? await listCompanies(actor)
    : [];
  const imageCopy = profileImageMessages(locale);
  const profilePolicyCompanyIds = mayManageProfileImages
    ? actor.accountKind === "COMPANY" && actor.companyId
      ? [actor.companyId]
      : companies.map((company) => company.id)
    : [];
  const [globalProfilePolicy, companyProfilePolicies] = await Promise.all([
    mayManageProfileImages && platformWorkspace ? getProfileImagePolicy(actor) : Promise.resolve(null),
    Promise.all(profilePolicyCompanyIds.map((companyId) => getProfileImagePolicy(actor, companyId))),
  ]);
  const workspace = actor.accountKind === "PLATFORM" || actor.isOwner
    ? m("settings.platform")
    : companies[0]?.name ?? m("settings.assigned");

  return <><PageHeader eyebrow={m("settings.eyebrow")} title={m("settings.title")} description={m("settings.description")} />
    {notice === "pricing-updated" ? <div className="callout" role="status">{m("settings.updated")}</div> : null}
    {notice === "profile-image-policy-updated" ? <div className="callout" role="status">{imageCopy.policySaved}</div> : null}
    <section className="dashboard-grid"><article className="panel"><div className="panel-header"><div><h2>{m("settings.workspaceConfig")}</h2><p>{m("settings.defaults")}</p></div></div><div className="panel-body readiness-list">
      <div className="readiness-item"><Building2 /><div><strong>{m("settings.workspace")}</strong><p>{workspace}</p></div></div>
      <div className="readiness-item"><Clock3 /><div><strong>{m("settings.timezone")}</strong><p>{actor.timezone ?? "Asia/Kuala_Lumpur"}</p></div></div>
      <div className="readiness-item"><Coins /><div><strong>{m("settings.currency")}</strong><p>{m("settings.currencyValue")}</p></div></div>
      <div className="readiness-item"><Database /><div><strong>{m("settings.payment")}</strong><p>{COD_PAYMENT_METHOD}</p></div></div>
    </div></article><article className="panel"><div className="panel-header"><div><h2>{m("settings.protection")}</h2><p>{m("settings.protectionIntro")}</p></div></div><div className="panel-body readiness-list">
      <div className="readiness-item"><ShieldCheck /><div><strong>{m("settings.isolation")}</strong><p>{m("settings.isolationBody")}</p></div></div>
      <div className="readiness-item"><UserRoundCog /><div><strong>{m("settings.permissions")}</strong><p>{m("settings.permissionsBody")}</p></div></div>
      <div className="readiness-item"><KeyRound /><div><strong>{m("settings.accounts")}</strong><p>{m("settings.accountsBody")}</p></div></div>
      <div className="readiness-item"><FileCheck2 /><div><strong>{m("settings.documents")}</strong><p>{m("settings.documentsBody")}</p></div></div>
    </div></article></section>
    {mayManageCommercialSettings ? <section className="panel" style={{ marginTop: 17 }}>
      <div className="panel-header">
        <div>
          <h3>{m("settings.pricing")}</h3>
          <p>{m("settings.pricingIntro")}</p>
        </div>
      </div>

      <div className="panel-body">
        {companies.length ? (
          <div className="settings-pricing-grid">
            {companies.map((company) => (
              <form
                key={company.id}
                action={updateCompanyPricingAction}
                className="settings-pricing-card"
              >
                <input
                  type="hidden"
                  name="companyId"
                  value={company.id}
                />

                <div>
                  <strong>{company.name}</strong>
                  <p>{company.code} · {m("settings.snapshot")}</p>
                </div>

                <label>
                  <span>
                    <Percent size={16} />
                    {m("settings.tax")}
                  </span>
                  <input
                    name="taxRate"
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    defaultValue={company.taxRate}
                    required
                  />
                  <small>{m("settings.taxHelp")}</small>
                </label>

                <label>
                  <span>
                    <Truck size={16} />
                    {m("settings.fee")}
                  </span>
                  <input
                    name="estimatedDeliveryFee"
                    type="number"
                    min="0"
                    step="0.01"
                    defaultValue={company.estimatedDeliveryFee}
                    required
                  />
                  <small>{m("settings.feeHelp")}</small>
                </label>

                <button
                  className="button button-primary"
                  type="submit"
                >
                  {m("settings.savePricing")}
                </button>
              </form>
            ))}
          </div>
        ) : (
          <div className="callout">
            <strong>{m("settings.noCompany")}</strong>
            <p>{m("settings.noCompanyBody")}</p>
          </div>
        )}
      </div>
    </section> : null}

    {mayManageProfileImages ? <section className="panel profile-policy-panel" style={{ marginTop: 17 }}>
      <div className="panel-header"><div><h3>{imageCopy.settingsTitle}</h3><p>{imageCopy.settingsBody}</p></div></div>
      <div className="panel-body profile-policy-grid">
        {globalProfilePolicy ? <form action={updateProfileImagePolicyAction} className="settings-pricing-card">
          <input type="hidden" name="scope" value="global" />
          <label className="policy-confirmation"><input name="deliveryAgentPhotoRequired" type="checkbox" defaultChecked={globalProfilePolicy.deliveryAgentPhotoRequired} /><span><ShieldCheck size={18} /><span><strong>{imageCopy.deliveryRequired}</strong><small>{imageCopy.deliveryRequiredHelp}</small></span></span></label>
          <button className="button button-primary" type="submit">{imageCopy.savePolicy}</button>
        </form> : null}
        {companyProfilePolicies.map((policy) => policy.companyId ? <form action={updateProfileImagePolicyAction} className="settings-pricing-card" key={policy.companyId}>
          <input type="hidden" name="scope" value="company" />
          <input type="hidden" name="companyId" value={policy.companyId} />
          <strong>{policy.companyName}</strong>
          <label className="policy-confirmation"><input name="companyPhotoDisplayEnabled" type="checkbox" defaultChecked={policy.companyPhotoDisplayEnabled} /><span><UserRoundCog size={18} /><span><strong>{imageCopy.companyDisplay}</strong><small>{imageCopy.companyDisplayHelp}</small></span></span></label>
          <button className="button button-primary" type="submit">{imageCopy.savePolicy}</button>
        </form> : null)}
      </div>
    </section> : null}

    {(mayViewDiagnostics || actor.isOwner) ? <section className="panel" data-tour="system-health" style={{ marginTop: 17 }}><div className="panel-header"><div><h3>{m("settings.mode")}</h3><p>{m("settings.modeIntro")}</p></div></div><div className="panel-body"><div className="callout"><strong>{m(isDemoMode() ? "settings.local" : "settings.production")}</strong><p>{m(isDemoMode() ? "settings.localBody" : "settings.productionBody")}</p></div></div></section> : null}
  </>;
}
