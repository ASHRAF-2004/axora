"use client";

import { approveCompanyVerificationAction } from "@/app/(portal)/companies/[companyId]/onboarding/actions";
import { activateCompanyAction } from "@/app/(portal)/masters/actions";
import { useFormStatus } from "react-dom";

function PendingButton({ label, pendingLabel }: {
  label: string;
  pendingLabel: string;
}) {
  const { pending } = useFormStatus();
  return <button
    className="button button-primary"
    type="submit"
    disabled={pending}
    aria-disabled={pending}
  >{pending ? pendingLabel : label}</button>;
}

export function CompanyVerificationApprovalForm({
  companyId,
  expectedVersion,
  label,
  pendingLabel,
}: {
  companyId: string;
  expectedVersion: number;
  label: string;
  pendingLabel: string;
}) {
  return <form action={approveCompanyVerificationAction}>
    <input type="hidden" name="companyId" value={companyId} />
    <input type="hidden" name="expectedVersion" value={expectedVersion} />
    <PendingButton label={label} pendingLabel={pendingLabel} />
  </form>;
}

export function CompanyActivationForm({
  companyId,
  expectedVersion,
  label,
  pendingLabel,
}: {
  companyId: string;
  expectedVersion: number;
  label: string;
  pendingLabel: string;
}) {
  return <form action={activateCompanyAction}>
    <input type="hidden" name="companyId" value={companyId} />
    <input type="hidden" name="expectedVersion" value={expectedVersion} />
    <PendingButton label={label} pendingLabel={pendingLabel} />
  </form>;
}
