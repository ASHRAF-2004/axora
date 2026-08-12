"use client";

import type { PermissionCode } from "@/lib/authorization-policy";
import type { SupportedLocale } from "@/lib/i18n";
import { useState } from "react";
import { useFormStatus } from "react-dom";
import { PermissionChecklist, type PermissionChecklistOption } from "./PermissionChecklist";

const messages = {
  en: { save: "Save effective access", saving: "Saving access...", reason: "Reason for this access change", reasonHint: "Required for the immutable permission audit trail." },
  ar: { save: "حفظ الصلاحيات الفعلية", saving: "جارٍ حفظ الصلاحيات...", reason: "سبب تغيير الصلاحيات", reasonHint: "مطلوب لسجل تدقيق الصلاحيات غير القابل للتغيير." },
  ms: { save: "Simpan akses berkesan", saving: "Menyimpan akses...", reason: "Sebab perubahan akses", reasonHint: "Diperlukan untuk jejak audit kebenaran yang tidak boleh diubah." },
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
    <label className="field-full">{messages[locale].reason}
      <textarea name="reason" required minLength={3} maxLength={500} />
      <small>{messages[locale].reasonHint}</small>
    </label>
    <div className="form-actions"><SaveButton locale={locale} /></div>
  </form>;
}
