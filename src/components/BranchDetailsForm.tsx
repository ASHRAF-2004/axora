"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";

import {
  updateBranchDetailsAction,
  type BranchDetailsActionState,
} from "@/app/(portal)/branches/[branchId]/edit/actions";
import { branchDetailsMessages } from "@/lib/branch-details-i18n";
import { corePortalMessages } from "@/lib/core-portal-i18n";
import type { SupportedLocale } from "@/lib/i18n";
import type { OrganizationBranch } from "@/lib/organization-access";

const initialState: BranchDetailsActionState = {
  status: "idle",
  message: "",
  submissionId: "",
};

export function BranchDetailsForm({ branch, locale }: {
  branch: OrganizationBranch;
  locale: SupportedLocale;
}) {
  const copy = corePortalMessages(locale).branches;
  const detailsCopy = branchDetailsMessages(locale);
  const router = useRouter();
  const [state, action, pending] = useActionState(updateBranchDetailsAction, initialState);
  const [commandId] = useState(() => crypto.randomUUID());

  useEffect(() => {
    if (state.status === "success" && state.branchId) {
      router.push(`/branches/${state.branchId}?notice=branch-updated`);
    }
  }, [router, state]);

  return <form action={action} className="panel form-panel" aria-busy={pending} noValidate>
    <input type="hidden" name="branchId" value={branch.id} />
    <input type="hidden" name="commandId" value={commandId} />
    <div className="form-grid">
      <label className="field-full">{copy.branchName}<input name="name" defaultValue={branch.name} required minLength={2} maxLength={300} /></label>
      <label>{copy.shortCode}<input value={branch.branchCode} readOnly aria-readonly="true" /></label>
      <label>{copy.city}<input name="city" defaultValue={branch.city} required minLength={2} maxLength={300} autoComplete="address-level2" /></label>
      <label>{copy.contactName}<input name="contactName" defaultValue={branch.contactName} required minLength={2} maxLength={300} autoComplete="name" /></label>
      <label>{copy.contactPhone}<input name="contactPhone" defaultValue={branch.contactPhone} type="tel" inputMode="tel" autoComplete="tel" required minLength={5} maxLength={120} /></label>
      <label className="field-full">{copy.contactEmail}<input name="contactEmail" defaultValue={branch.contactEmail} type="email" autoComplete="email" maxLength={320} /></label>
      <label className="field-full">{copy.notes}<textarea name="notes" defaultValue={branch.notes ?? ""} maxLength={1_000} /></label>
    </div>
    {state.status !== "idle" ? <p className={state.status === "success" ? "form-success" : "form-alert"} role={state.status === "success" ? "status" : "alert"}>{state.message}</p> : null}
    <div className="form-actions">
      <Link className="button button-secondary" href={`/branches/${branch.id}`}>{detailsCopy.cancel}</Link>
      <button className="button button-primary" type="submit" disabled={pending}>{pending ? detailsCopy.saving : detailsCopy.save}</button>
    </div>
  </form>;
}
