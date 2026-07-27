"use client";

import { createUserAction } from "@/app/(portal)/users/actions";
import type { Branch, Company, UserRole } from "@/lib/types";
import { useMemo, useState } from "react";

const requiredBranchRoles = new Set<UserRole>(["REQUESTER", "APPROVER", "BRANCH_ADMIN"]);
const optionalBranchRoles = new Set<UserRole>(["FINANCE", "VIEWER"]);

interface RoleOption {
  label: string;
  value: UserRole;
}

export function UserCreateForm({
  actorBranchId,
  actorCompanyId,
  actorIsOwner,
  branches,
  companies,
  roleOptions,
}: {
  actorBranchId?: string;
  actorCompanyId?: string;
  actorIsOwner: boolean;
  branches: Branch[];
  companies: Company[];
  roleOptions: RoleOption[];
}) {
  const initialCompanyId = actorCompanyId ?? companies.find((company) => company.status === "Active")?.id ?? "";
  const initialRole = actorIsOwner && roleOptions.some((option) => option.value === "ADMIN")
    ? "ADMIN"
    : roleOptions.some((option) => option.value === "REQUESTER")
      ? "REQUESTER"
      : roleOptions[0]?.value ?? "REQUESTER";
  const [companyId, setCompanyId] = useState(initialCompanyId);
  const [role, setRole] = useState<UserRole>(initialRole);
  const availableBranches = useMemo(
    () => branches.filter((branch) => branch.status === "Active" && branch.companyId === companyId),
    [branches, companyId],
  );
  const firstBranchId = actorBranchId ?? availableBranches[0]?.id ?? "";
  const [branchId, setBranchId] = useState(requiredBranchRoles.has(initialRole) ? firstBranchId : "");
  const requiresBranch = requiredBranchRoles.has(role);
  const allowsBranch = requiresBranch || optionalBranchRoles.has(role);
  const selectedBranchId = allowsBranch && availableBranches.some((branch) => branch.id === branchId)
    ? branchId
    : requiresBranch
      ? firstBranchId
      : "";

  function changeCompany(nextCompanyId: string) {
    const nextBranches = branches.filter(
      (branch) => branch.status === "Active" && branch.companyId === nextCompanyId,
    );
    setCompanyId(nextCompanyId);
    setBranchId(requiredBranchRoles.has(role) ? nextBranches[0]?.id ?? "" : "");
  }

  function changeRole(nextRole: UserRole) {
    setRole(nextRole);
    if (requiredBranchRoles.has(nextRole)) {
      setBranchId((current) => availableBranches.some((branch) => branch.id === current)
        ? current
        : firstBranchId);
    } else if (!optionalBranchRoles.has(nextRole)) {
      setBranchId("");
    }
  }

  return (
    <form action={createUserAction}>
      <div className="form-grid">
        <label>Full name<input name="displayName" required autoComplete="name" /></label>
        <label>Work email<input name="email" type="email" required autoComplete="username" /></label>
        {actorIsOwner ? (
          <label>Company
            <select
              name="companyId"
              required
              value={companyId}
              onChange={(event) => changeCompany(event.target.value)}
            >
              <option value="" disabled>Select company</option>
              {companies.filter((company) => company.status === "Active").map((company) => (
                <option key={company.id} value={company.id}>{company.name}</option>
              ))}
            </select>
          </label>
        ) : null}
        <label>Role
          <select
            name="role"
            value={role}
            onChange={(event) => changeRole(event.target.value as UserRole)}
          >
            {roleOptions.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
        <label>Assigned branch
          <select
            name="branchId"
            disabled={!allowsBranch}
            required={requiresBranch}
            value={selectedBranchId}
            onChange={(event) => setBranchId(event.target.value)}
          >
            {requiresBranch ? <option value="" disabled>Select branch</option> : <option value="">Company-wide</option>}
            {availableBranches.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {actorIsOwner ? `${branch.companyName} · ` : ""}{branch.name}
              </option>
            ))}
          </select>
          <small>
            {requiresBranch
              ? "This role works in one branch."
              : allowsBranch
                ? "Choose a branch or keep company-wide access."
                : "This role is company-wide."}
          </small>
        </label>
        <label>Initial password
          <input name="password" type="password" minLength={14} required autoComplete="new-password" />
          <small>At least 14 characters. Use a memorable passphrase and share it privately.</small>
        </label>
      </div>
      <div className="form-actions">
        <button
          className="button button-primary"
          type="submit"
          disabled={!companyId || (requiresBranch && !selectedBranchId)}
        >
          Create account
        </button>
      </div>
    </form>
  );
}
