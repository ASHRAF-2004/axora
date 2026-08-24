"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";

import { createBranchWithLocationAction, type BranchCreateState } from "@/app/(portal)/branches/new/actions";
import { BranchDeliveryLocationPicker, type DeliveryLocationSelection } from "@/components/BranchDeliveryLocationPicker";
import { branchDeliveryLocationMessages } from "@/lib/branch-delivery-location-i18n";
import { corePortalMessages } from "@/lib/core-portal-i18n";
import type { SupportedLocale } from "@/lib/i18n";

const initialState: BranchCreateState = { status: "idle", message: "", submissionId: "" };

export function BranchCreateForm({ companyId, companyName, locale, showCompany }: {
  companyId: string;
  companyName: string;
  locale: SupportedLocale;
  showCompany: boolean;
}) {
  const copy = corePortalMessages(locale).branches;
  const locationCopy = branchDeliveryLocationMessages(locale);
  const router = useRouter();
  const [selection, setSelection] = useState<DeliveryLocationSelection | null>(null);
  const [confirmed, setConfirmed] = useState<DeliveryLocationSelection | null>(null);
  const [state, action, pending] = useActionState(createBranchWithLocationAction, initialState);
  const [commandId] = useState(() => crypto.randomUUID());

  useEffect(() => {
    if (state.status === "success" && state.branchId) router.push(`/branches/${state.branchId}?notice=branch-created`);
  }, [router, state]);

  const ready = Boolean(selection && confirmed
    && selection.latitude === confirmed.latitude
    && selection.longitude === confirmed.longitude
    && selection.addressLabel === confirmed.addressLabel);

  return <form action={action} className="panel form-panel" aria-busy={pending} noValidate>
    <input type="hidden" name="companyId" value={companyId} />
    <input type="hidden" name="commandId" value={commandId} />
    <input type="hidden" name="addressLabel" value={confirmed?.addressLabel ?? ""} />
    <input type="hidden" name="latitude" value={confirmed?.latitude ?? ""} />
    <input type="hidden" name="longitude" value={confirmed?.longitude ?? ""} />
    <input type="hidden" name="providerId" value={confirmed?.providerId ?? ""} />
    <input type="hidden" name="providerPlaceId" value={confirmed?.providerPlaceId ?? ""} />
    <input type="hidden" name="providerAttribution" value={confirmed?.providerAttribution ?? ""} />

    <div className="form-grid">
      {showCompany ? <div className="field-full"><strong>{copy.selectCompany}</strong><p>{companyName}</p></div> : null}
      <label className="field-full">{copy.branchName}<input name="name" required minLength={2} maxLength={300} /></label>
      <label>{copy.shortCode}<input name="branchCode" placeholder="KL-HQ" required minLength={2} maxLength={50} /></label>
      <label>{copy.city}<input name="city" required minLength={2} maxLength={300} autoComplete="address-level2" /></label>
      <div className="field-full">
        <BranchDeliveryLocationPicker locale={locale} disabled={pending} onDraftChange={(draft) => { setSelection(draft); setConfirmed(null); }}
          onConfirm={(location) => { setSelection(location); setConfirmed(location); }} />
      </div>
      <label>{copy.contactName}<input name="contactName" required autoComplete="name" minLength={2} maxLength={300} /></label>
      <label>{copy.contactPhone}<input name="contactPhone" type="tel" inputMode="tel" autoComplete="tel" required minLength={5} maxLength={120} /></label>
      <label className="field-full">{copy.contactEmail}<input name="contactEmail" type="email" autoComplete="email" /></label>
      <label className="field-full">{copy.instructions}<textarea name="deliveryInstructions" maxLength={5_000} /></label>
      <label className="field-full">{copy.notes}<textarea name="notes" maxLength={1_000} /></label>
    </div>
    {!ready ? <p className="form-alert" role="status">{locationCopy.confirmationRequired}</p> : null}
    {state.status !== "idle" ? <p className={state.status === "success" ? "form-success" : "form-alert"} role={state.status === "success" ? "status" : "alert"}>{state.message}</p> : null}
    <div className="form-actions">
      <Link className="button button-secondary" href="/branches">{locale === "ar" ? "رجوع" : locale === "ms" ? "Kembali" : "Back"}</Link>
      <button className="button button-primary" type="submit" disabled={pending || !ready}>{pending ? `${copy.create}…` : copy.create}</button>
    </div>
  </form>;
}
