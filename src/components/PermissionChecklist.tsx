"use client";

import type { PermissionCode } from "@/lib/authorization-policy";
import type { SupportedLocale } from "@/lib/i18n";
import { localizePermissionOption } from "@/lib/permission-catalog-i18n";

export interface PermissionChecklistOption {
  code: PermissionCode;
  group: string;
  label: string;
  description: string;
  highRisk: boolean;
}

const copy = {
  en: { selected: "permissions selected", highRisk: "Sensitive", standard: "Standard" },
  ar: { selected: "صلاحيات محددة", highRisk: "حساس", standard: "قياسي" },
  ms: { selected: "kebenaran dipilih", highRisk: "Sensitif", standard: "Standard" },
} as const;

export function PermissionChecklist({
  locale,
  options,
  selected,
  onChange,
}: {
  locale: SupportedLocale;
  options: readonly PermissionChecklistOption[];
  selected: ReadonlySet<PermissionCode>;
  onChange: (next: Set<PermissionCode>) => void;
}) {
  const groups = new Map<string, PermissionChecklistOption[]>();
  for (const original of options) {
    const option = localizePermissionOption(original, locale);
    const group = groups.get(option.group) ?? [];
    group.push(option);
    groups.set(option.group, group);
  }

  function toggle(code: PermissionCode, checked: boolean) {
    const next = new Set(selected);
    if (checked) next.add(code);
    else next.delete(code);
    onChange(next);
  }

  return (
    <div className="permission-checklist">
      <p className="subtle" aria-live="polite">
        {selected.size} {copy[locale].selected}
      </p>
      {[...groups.entries()].map(([group, permissions]) => (
        <fieldset className="permission-group" key={group}>
          <legend>{group}</legend>
          <div className="permission-grid">
            {permissions.map((permission) => (
              <label className="permission-option" key={permission.code}>
                <input
                  type="checkbox"
                  name="permissions"
                  value={permission.code}
                  checked={selected.has(permission.code)}
                  onChange={(event) => toggle(permission.code, event.target.checked)}
                />
                <span>
                  <strong>{permission.label}</strong>
                  <small>{permission.description}</small>
                  <small className={permission.highRisk ? "permission-risk-high" : "subtle"}>
                    {permission.highRisk ? copy[locale].highRisk : copy[locale].standard}
                  </small>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      ))}
    </div>
  );
}
