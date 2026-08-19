"use client";

import type { OrganizationDepartment } from "@/lib/organization-structure";
import { userProvisioningRoleConfig } from "@/lib/user-provisioning";
import { userFormMessages } from "@/lib/user-form-i18n";
import type { AccountKind, Branch, Company, RoleScopeType, UserRole } from "@/lib/types";
import type { SupportedLocale } from "@/lib/i18n";
import { useMemo, useState } from "react";
import { useFormStatus } from "react-dom";

const managementCopy = {
  en: {
    title: "Change role & scope", currentRole: "Current role", currentScope: "Current scope",
    newRole: "New role", reason: "Reason for change",
    reasonHelp: "Explain why this authorization change is required.",
    save: "Save role & scope", saving: "Saving access change…",
    requesterLevel: "Requester assignment level",
    warning: "This changes authorization. Existing sessions are invalidated and a pending setup invitation may need to be replaced.",
    ownerWarning: "Platform Owner is a protected high-risk role. Last-owner safeguards remain enforced by the database.",
    unavailable: "Role and scope changes are unavailable for this account state or assignment.",
    scope: { PLATFORM: "Platform", COMPANY: "Company", BRANCH: "Branch", DEPARTMENT: "Department", SUPPLIER: "Supplier", DELIVERY: "Delivery" },
  },
  ms: {
    title: "Tukar peranan & skop", currentRole: "Peranan semasa", currentScope: "Skop semasa",
    newRole: "Peranan baharu", reason: "Sebab perubahan",
    reasonHelp: "Terangkan mengapa perubahan kebenaran ini diperlukan.",
    save: "Simpan peranan & skop", saving: "Menyimpan perubahan akses…",
    requesterLevel: "Tahap tugasan pemohon",
    warning: "Ini mengubah kebenaran. Sesi lama dibatalkan dan jemputan persediaan yang belum selesai mungkin perlu diganti.",
    ownerWarning: "Platform Owner ialah peranan berisiko tinggi yang dilindungi. Perlindungan pemilik terakhir kekal dikuatkuasakan oleh pangkalan data.",
    unavailable: "Perubahan peranan dan skop tidak tersedia untuk keadaan akaun atau tugasan ini.",
    scope: { PLATFORM: "Platform", COMPANY: "Syarikat", BRANCH: "Cawangan", DEPARTMENT: "Jabatan", SUPPLIER: "Pembekal", DELIVERY: "Penghantaran" },
  },
  ar: {
    title: "تغيير الدور والنطاق", currentRole: "الدور الحالي", currentScope: "النطاق الحالي",
    newRole: "الدور الجديد", reason: "سبب التغيير",
    reasonHelp: "وضّح سبب الحاجة إلى هذا التغيير في الصلاحيات.",
    save: "حفظ الدور والنطاق", saving: "جارٍ حفظ تغيير الوصول…",
    requesterLevel: "مستوى تعيين مقدم الطلب",
    warning: "هذا تغيير في الصلاحيات. سيتم إبطال الجلسات القديمة وقد يلزم استبدال دعوة الإعداد المعلّقة.",
    ownerWarning: "دور مالك المنصة محمي وعالي الخطورة. تبقى حماية آخر مالك مفروضة في قاعدة البيانات.",
    unavailable: "تغيير الدور والنطاق غير متاح لحالة هذا الحساب أو هذا التعيين.",
    scope: { PLATFORM: "المنصة", COMPANY: "الشركة", BRANCH: "الفرع", DEPARTMENT: "القسم", SUPPLIER: "المورد", DELIVERY: "التسليم" },
  },
} as const;

function Submit({ locale, disabled }: { locale: SupportedLocale; disabled: boolean }) {
  const { pending } = useFormStatus();
  const copy = managementCopy[locale];
  return <button className="button button-primary" type="submit"
    disabled={disabled || pending} aria-busy={pending}
    data-feedback-label={copy.saving}>
    {pending ? copy.saving : copy.save}
  </button>;
}

export interface ManagedRoleOption {
  value: UserRole;
  label: string;
  accountKind: AccountKind;
}

export function UserRoleScopeEditor({
  action,
  accountKind,
  currentRole,
  currentScope,
  companies,
  branches,
  departments,
  roleOptions,
  locale,
  enabled,
}: {
  action: (formData: FormData) => void | Promise<void>;
  accountKind: AccountKind;
  currentRole: UserRole;
  currentScope: {
    type: RoleScopeType;
    companyId?: string;
    branchId?: string;
    departmentId?: string;
  };
  companies: Company[];
  branches: Array<Pick<Branch, "id" | "companyId" | "name" | "status">>;
  departments: OrganizationDepartment[];
  roleOptions: ManagedRoleOption[];
  locale: SupportedLocale;
  enabled: boolean;
}) {
  const formCopy = userFormMessages(locale);
  const copy = managementCopy[locale];
  const [role, setRole] = useState<UserRole>(currentRole);
  const [requesterScope, setRequesterScope] = useState<"BRANCH" | "DEPARTMENT">(
    currentRole === "REQUESTER" && currentScope.type === "DEPARTMENT"
      ? "DEPARTMENT" : "BRANCH",
  );
  const [companyId, setCompanyId] = useState(currentScope.companyId ?? "");
  const [branchId, setBranchId] = useState(currentScope.branchId ?? "");
  const [departmentId, setDepartmentId] = useState(currentScope.departmentId ?? "");
  const config = userProvisioningRoleConfig(role);
  const effectiveScope = role === "REQUESTER"
    ? requesterScope
    : config?.creationScopes[0];
  const showCompany = Boolean(config?.showCompany);
  const showBranch = Boolean(config?.showBranch && effectiveScope !== "COMPANY");
  const showDepartment = Boolean(config?.showDepartment && effectiveScope === "DEPARTMENT");

  const availableBranches = useMemo(() => branches.filter((branch) => (
    branch.status === "Active" && branch.companyId === companyId
  )), [branches, companyId]);
  const availableDepartments = useMemo(() => departments.filter((department) => (
    department.active && department.companyId === companyId
      && department.branchId === branchId
  )), [departments, companyId, branchId]);

  function chooseRole(next: UserRole) {
    setRole(next);
    const nextConfig = userProvisioningRoleConfig(next);
    const firstScope = nextConfig?.creationScopes[0];
    setRequesterScope(firstScope === "DEPARTMENT" ? "DEPARTMENT" : "BRANCH");
    if (!nextConfig?.showCompany) setCompanyId("");
    if (!nextConfig?.showBranch) setBranchId("");
    if (!nextConfig?.showDepartment) setDepartmentId("");
  }

  function chooseCompany(next: string) {
    setCompanyId(next); setBranchId(""); setDepartmentId("");
  }
  function chooseBranch(next: string) {
    setBranchId(next); setDepartmentId("");
  }

  const ready = enabled && accountKind === config?.accountKind
    && Boolean(effectiveScope)
    && (!showCompany || Boolean(companyId))
    && (!showBranch || Boolean(branchId))
    && (!showDepartment || Boolean(departmentId));

  return <section className="panel" aria-labelledby="role-scope-editor-title">
    <div className="panel-header"><div>
      <h2 id="role-scope-editor-title">{copy.title}</h2>
      <p>{copy.warning}</p>
    </div></div>
    <div className="panel-body">
      {!enabled ? <div className="callout"><strong>{copy.unavailable}</strong></div> : null}
      <form action={action}>
        <input type="hidden" name="scopeType" value={effectiveScope ?? ""} />
        <div className="form-grid">
          <label>{copy.currentRole}
            <input readOnly value={formCopy.roles[currentRole]?.label ?? currentRole} />
          </label>
          <label>{copy.currentScope}
            <input readOnly value={copy.scope[currentScope.type]} />
          </label>
          <label className="field-full">{copy.newRole}
            <select name="role" value={role}
              onChange={(event) => chooseRole(event.target.value as UserRole)}
              disabled={!enabled} required>
              {roleOptions.map((option) => <option key={option.value} value={option.value}>
                {formCopy.roles[option.value]?.label ?? option.label}
              </option>)}
            </select>
          </label>

          {role === "REQUESTER" ? <label className="field-full">{copy.requesterLevel}
            <select value={requesterScope}
              onChange={(event) => {
                setRequesterScope(event.target.value as "BRANCH" | "DEPARTMENT");
                setDepartmentId("");
              }}>
              <option value="BRANCH">{formCopy.branchScope}</option>
              <option value="DEPARTMENT">{formCopy.departmentScope}</option>
            </select>
          </label> : null}

          {showCompany ? <label>{formCopy.customerCompany}
            <select name="companyId" value={companyId}
              onChange={(event) => chooseCompany(event.target.value)} required>
              <option value="">{formCopy.selectCompany}</option>
              {companies.filter((company) => company.status === "Active")
                .map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}
            </select>
          </label> : null}

          {showBranch ? <label>{formCopy.assignedBranch}
            <select name="branchId" value={branchId}
              onChange={(event) => chooseBranch(event.target.value)}
              disabled={!companyId} required>
              <option value="">{formCopy.selectBranch}</option>
              {availableBranches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
            </select>
          </label> : null}

          {showDepartment ? <label>{formCopy.department}
            <select name="departmentId" value={departmentId}
              onChange={(event) => setDepartmentId(event.target.value)}
              disabled={!branchId} required>
              <option value="">{formCopy.selectDepartment}</option>
              {availableDepartments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}
            </select>
          </label> : null}

          <label className="field-full">{copy.reason}
            <textarea name="reason" required minLength={3} maxLength={500} />
            <small>{copy.reasonHelp}</small>
          </label>
          {role === "PLATFORM_OWNER" ? <div className="callout field-full"><strong>{copy.ownerWarning}</strong></div> : null}
        </div>
        <div className="form-actions"><Submit locale={locale} disabled={!ready} /></div>
      </form>
    </div>
  </section>;
}
