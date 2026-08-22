"use client";

import type { PermissionCode } from "@/lib/authorization-policy";
import type { SupportedLocale } from "@/lib/i18n";
import { useState } from "react";
import { useFormStatus } from "react-dom";
import { PermissionChecklist, type PermissionChecklistOption } from "./PermissionChecklist";

const messages = {
  en: { save: "Save permissions", saving: "Saving permissions..." },
  ar: { save: "حفظ الصلاحيات", saving: "جارٍ حفظ الصلاحيات..." },
  ms: { save: "Simpan kebenaran", saving: "Menyimpan kebenaran..." },
} as const;

function SaveButton({ locale }: { locale: SupportedLocale }) {
  const { pending } = useFormStatus();
  return <button className="button button-primary" type="submit" disabled={pending} aria-busy={pending}>
    {pending ? messages[locale].saving : messages[locale].save}
  </button>;
}

export function PermissionEditorForm({
  action,
  locale,
  options,
  initialPermissions,
}: {
  action: (formData: FormData) => void | Promise<void>;
  locale: SupportedLocale;
  options: readonly PermissionChecklistOption[];
  initialPermissions: readonly PermissionCode[];
}) {
  const [selected, setSelected] = useState(new Set(initialPermissions));
  return <form action={action} className="panel form-panel" data-draft-id="effective-access">
    <PermissionChecklist locale={locale} options={options} selected={selected} onChange={setSelected} />
    <div className="form-actions"><SaveButton locale={locale} /></div>
  </form>;
}
