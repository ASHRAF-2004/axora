import { afterEach, describe, expect, it } from "vitest";
import { compare } from "bcryptjs";
import { readFileSync } from "node:fs";
import {
  accountSetupTtlHours,
  generateAccountSetupToken,
  hashAccountSetupToken,
} from "@/lib/account-setup";
import {
  MAX_PASSWORD_CODE_POINTS,
  MIN_PASSWORD_CODE_POINTS,
  PENDING_ACCOUNT_PASSWORD_HASH,
  PasswordPolicyError,
  assertPasswordPolicy,
  hashPassword,
  passwordHashNeedsUpgrade,
  verifyPassword,
} from "@/lib/password-policy";
import { resolveUserCreation } from "@/lib/users";
import type { SessionUser } from "@/lib/auth";

const companyA = "10000000-0000-4000-8000-000000000001";
const branchA = "20000000-0000-4000-8000-000000000001";
const branchB = "20000000-0000-4000-8000-000000000002";

const owner: SessionUser = {
  id: "90000000-0000-4000-8000-000000000001",
  email: "owner@example.test",
  name: "Owner",
  role: "PLATFORM_OWNER",
  accountKind: "PLATFORM",
  scopeType: "PLATFORM",
  isOwner: true,
};
const companyAdmin: SessionUser = {
  id: "90000000-0000-4000-8000-000000000002",
  email: "admin@example.test",
  name: "Company admin",
  role: "ADMIN",
  companyId: companyA,
  isOwner: false,
};
const branchAdmin: SessionUser = {
  id: "90000000-0000-4000-8000-000000000003",
  email: "branch@example.test",
  name: "Branch admin",
  role: "BRANCH_ADMIN",
  companyId: companyA,
  branchId: branchA,
  isOwner: false,
};

describe("secure account setup primitives", () => {
  const originalTtl = process.env.ACCOUNT_SETUP_TTL_HOURS;

  afterEach(() => {
    if (originalTtl === undefined) delete process.env.ACCOUNT_SETUP_TTL_HOURS;
    else process.env.ACCOUNT_SETUP_TTL_HOURS = originalTtl;
  });

  it("generates high-entropy URL-safe tokens and stores only deterministic digests", () => {
    const first = generateAccountSetupToken();
    const second = generateAccountSetupToken();

    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(second).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(second).not.toBe(first);
    expect(hashAccountSetupToken(first)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashAccountSetupToken(first)).toBe(hashAccountSetupToken(first));
    expect(hashAccountSetupToken(first)).not.toContain(first);
  });

  it("keeps invitation lifetime in the database-enforced one-week window", () => {
    delete process.env.ACCOUNT_SETUP_TTL_HOURS;
    expect(accountSetupTtlHours()).toBe(24);
    process.env.ACCOUNT_SETUP_TTL_HOURS = "2";
    expect(accountSetupTtlHours()).toBe(2);
    process.env.ACCOUNT_SETUP_TTL_HOURS = "9999";
    expect(accountSetupTtlHours()).toBe(168);
    process.env.ACCOUNT_SETUP_TTL_HOURS = "invalid";
    expect(accountSetupTtlHours()).toBe(24);
  });

  it("enforces the NIST length baseline in Unicode code points without truncation", () => {
    expect(assertPasswordPolicy("correct horse battery staple")).toEqual({
      codePointCount: 28,
      utf8ByteLength: 28,
    });
    expect(() => assertPasswordPolicy("too short")).toThrow(PasswordPolicyError);

    const emojiPassword = "🔐".repeat(MIN_PASSWORD_CODE_POINTS);
    expect(Buffer.byteLength(emojiPassword, "utf8")).toBe(60);
    expect(assertPasswordPolicy(emojiPassword).codePointCount).toBe(15);
    expect(assertPasswordPolicy(" ".repeat(MIN_PASSWORD_CODE_POINTS)).codePointCount).toBe(15);
    expect(assertPasswordPolicy("密".repeat(MAX_PASSWORD_CODE_POINTS)).codePointCount).toBe(128);
    expect(() => assertPasswordPolicy("密".repeat(MAX_PASSWORD_CODE_POINTS + 1)))
      .toThrow(/not truncated/i);
  });

  it("keeps pending accounts safe when only the application is rolled back", async () => {
    expect(PENDING_ACCOUNT_PASSWORD_HASH).toMatch(/^\$2b\$12\$/);
    await expect(compare(
      "rollback probe password",
      PENDING_ACCOUNT_PASSWORD_HASH,
    )).resolves.toBe(false);
  });

  it("stores new passwords with Argon2id while accepting legacy bcrypt", async () => {
    const password = "correct horse battery staple";
    const modernHash = await hashPassword(password);
    expect(modernHash).toMatch(/^\$argon2id\$v=19\$m=65536,t=3,p=1\$/);
    await expect(verifyPassword(password, modernHash)).resolves.toBe(true);
    await expect(verifyPassword("wrong password value", modernHash)).resolves.toBe(false);
    expect(passwordHashNeedsUpgrade(modernHash)).toBe(false);

    const legacyHash = await import("bcryptjs").then(({ hash }) => hash(password, 4));
    await expect(verifyPassword(password, legacyHash)).resolves.toBe(true);
    expect(passwordHashNeedsUpgrade(legacyHash)).toBe(true);
  });

  it("derives company and branch from the administrator instead of trusting form input", () => {
    const companyResult = resolveUserCreation({
      email: "  Person@Example.Test ",
      displayName: "  Person Name  ",
      role: "VIEWER",
      companyId: "attacker-company",
      branchId: branchB,
    }, companyAdmin);
    expect(companyResult).toEqual({
      email: "person@example.test",
      displayName: "Person Name",
      role: "AUDITOR",
      accountKind: "COMPANY",
      scopeType: "BRANCH",
      companyId: companyA,
      branchId: branchB,
      jobTitle: undefined,
      preferredLocale: "en",
    });

    const branchResult = resolveUserCreation({
      email: "requester@example.test",
      displayName: "Requester",
      role: "REQUESTER",
      companyId: "attacker-company",
      branchId: branchB,
    }, branchAdmin);
    expect(branchResult.companyId).toBe(companyA);
    expect(branchResult.branchId).toBe(branchA);
  });

  it("enforces creator role boundaries before opening a transaction", () => {
    expect(() => resolveUserCreation({
      email: "admin@example.test",
      displayName: "Admin User",
      role: "ADMIN",
    }, branchAdmin)).toThrow(/cannot create this role/i);

    expect(() => resolveUserCreation({
      email: "support@example.test",
      displayName: "Support User",
      role: "IT_SUPPORT",
      companyId: companyA,
    }, companyAdmin)).toThrow(/cannot create this role/i);

    expect(resolveUserCreation({
      email: "support@example.test",
      displayName: "Support User",
      role: "IT_SUPPORT",
      companyId: companyA,
    }, owner)).toMatchObject({
      role: "TECHNICAL_SUPPORT",
      accountKind: "PLATFORM",
      scopeType: "PLATFORM",
    });
    expect(resolveUserCreation({
      email: "support@example.test",
      displayName: "Support User",
      role: "IT_SUPPORT",
      companyId: companyA,
    }, owner).companyId).toBeUndefined();
  });

  it("derives delivery accounts and rejects the removed supplier actor", () => {
    const supplierId = "30000000-0000-4000-8000-000000000001";
    expect(() => resolveUserCreation({
      email: "supplier@example.test",
      displayName: "Supplier User",
      role: "SUPPLIER_USER",
      supplierId,
      companyId: companyA,
      branchId: branchA,
    }, owner)).toThrow(/cannot create this role/i);
    expect(resolveUserCreation({
      email: "driver@example.test",
      displayName: "Delivery Driver",
      role: "DELIVERY_DRIVER",
      supplierId,
      companyId: companyA,
      branchId: branchA,
    }, owner)).toEqual({
      email: "driver@example.test",
      displayName: "Delivery Driver",
      role: "DELIVERY_DRIVER",
      accountKind: "DELIVERY",
      scopeType: "DELIVERY",
      jobTitle: undefined,
      preferredLocale: "en",
    });
  });

  it("limits a branch administrator to the exact branch-safe role catalog", () => {
    for (const role of ["BRANCH_APPROVER", "REQUESTER", "RECEIVING_USER"] as const) {
      expect(resolveUserCreation({
        email: `${role.toLowerCase()}@example.test`,
        displayName: `${role} Person`,
        role,
        companyId: "attacker-company",
        branchId: branchB,
      }, branchAdmin)).toMatchObject({
        companyId: companyA,
        branchId: branchA,
        scopeType: "BRANCH",
      });
    }
    for (const role of ["BRANCH_ADMIN", "FINANCE_REVIEWER", "AUDITOR"] as const) {
      expect(() => resolveUserCreation({
        email: `${role.toLowerCase()}@example.test`,
        displayName: `${role} Person`,
        role,
        branchId: branchA,
      }, branchAdmin)).toThrow(/cannot create this role/i);
    }
  });

  it("validates department setup scope through the least-privilege capability", () => {
    const source = readFileSync(
      new URL("../src/lib/account-setup.ts", import.meta.url),
      "utf8",
    );

    expect(source.match(
      /axora_auth_department_scope\(\s*u\.id,intended_assignment\.id\s*\)/g,
    )).toHaveLength(2);
    expect(source).toContain(
      "department_scope.snapshot->>'departmentActive'",
    );
    expect(source).toContain(
      "department_scope.snapshot->>'assignmentStatus'",
    );
    expect(source).not.toMatch(/JOIN departments department/);
    expect(source).not.toMatch(/JOIN department_assignments department_assignment/);
  });
});
