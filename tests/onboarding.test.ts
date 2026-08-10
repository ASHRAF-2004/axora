import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SUPPORTED_LOCALES, type SupportedLocale } from "@/lib/i18n";
import { tutorialForRole } from "@/lib/onboarding";
import { applyDemoSeed, applyMigrations } from "./helpers/pglite";

const principalRoles = [
  "PLATFORM_OWNER",
  "PLATFORM_OPERATIONS",
  "COMPANY_ADMIN",
  "BRANCH_ADMIN",
  "BRANCH_APPROVER",
  "COMPANY_APPROVER",
  "REQUESTER",
  "FINANCE_REVIEWER",
  "AUDITOR",
  "TECHNICAL_SUPPORT",
  "DELIVERY_DRIVER",
  "RECEIVING_USER",
] as const;

describe("role-specific onboarding definitions", () => {
  it("defines a concise tutorial for every principal role", () => {
    for (const role of principalRoles) {
      const steps = tutorialForRole(role, role === "PLATFORM_OWNER");
      expect(steps.length).toBeGreaterThanOrEqual(3);
      expect(new Set(steps.map((step) => step.key)).size).toBe(steps.length);
      expect(steps.every((step) => step.title && step.body && step.target)).toBe(true);
    }
  });

  it("provides complete localized copy while preserving stable step keys and targets", () => {
    for (const role of principalRoles) {
      const isOwner = role === "PLATFORM_OWNER";
      const english = tutorialForRole(role, isOwner, "en");
      for (const locale of SUPPORTED_LOCALES) {
        const localized = tutorialForRole(role, isOwner, locale);
        expect(localized.map(({ key, target, mobileTarget }) => ({ key, target, mobileTarget })))
          .toEqual(english.map(({ key, target, mobileTarget }) => ({ key, target, mobileTarget })));
        for (const [index, step] of localized.entries()) {
          expect(step.title.trim().length).toBeGreaterThan(0);
          expect(step.body.trim().length).toBeGreaterThan(0);
          if (locale !== "en") {
            expect(step.title).not.toBe(english[index].title);
            expect(step.body).not.toBe(english[index].body);
          }
        }
      }
    }
  });

  it("uses English by default and for an unsupported runtime locale", () => {
    const english = tutorialForRole("REQUESTER", false, "en");
    expect(tutorialForRole("REQUESTER")).toEqual(english);
    expect(tutorialForRole("REQUESTER", false, "fr" as SupportedLocale)).toEqual(english);
  });

  it("does not expose a global skip-all tutorial step", () => {
    for (const role of principalRoles) {
      for (const locale of SUPPORTED_LOCALES) {
        expect(tutorialForRole(role, role === "PLATFORM_OWNER", locale)
          .some((step) => /skip[-_ ]?all/i.test(`${step.key} ${step.title}`))).toBe(false);
      }
    }
  });

  it("maps legacy roles to their safe modern tutorial", () => {
    expect(tutorialForRole("APPROVER")[0].key).toBe("approval-queue");
    expect(tutorialForRole("FINANCE")[0].key).toBe("finance-queue");
    expect(tutorialForRole("ADMIN", true)[0].key).toBe("owner-dashboard");
  });
});

describe("onboarding persistence schema", () => {
  let db: PGlite;
  let userId: string;

  beforeAll(async () => {
    db = new PGlite();
    await applyMigrations(db);
    await applyDemoSeed(db);
    const company = await db.query<{ id: string }>("SELECT id::text FROM companies LIMIT 1");
    const role = await db.query<{ id: string }>("SELECT id::text FROM roles WHERE role_key='REQUESTER'");
    const user = await db.query<{ id: string }>(`
      INSERT INTO users(email,display_name,password_hash,role_id,company_id,is_owner)
      VALUES ('onboarding@example.test','Onboarding User','not-a-real-hash',$1,$2,false)
      RETURNING id::text
    `, [role.rows[0].id, company.rows[0].id]);
    userId = user.rows[0].id;
  }, 30_000);

  afterAll(async () => {
    await db.close();
  });

  it("persists skipped and completed steps independently", async () => {
    await db.query(`
      INSERT INTO tutorial_step_progress(user_id,role_key,step_key,status,skipped_at)
      VALUES ($1,'REQUESTER','shop','SKIPPED',now()),
             ($1,'REQUESTER','cart','COMPLETED',NULL)
    `, [userId]);
    const result = await db.query<{ step_key: string; status: string }>(`
      SELECT step_key,status FROM tutorial_step_progress WHERE user_id=$1 ORDER BY step_key
    `, [userId]);
    expect(result.rows).toEqual([
      { step_key: "cart", status: "COMPLETED" },
      { step_key: "shop", status: "SKIPPED" },
    ]);
  });

  it("rejects unsupported all-skipped state values", async () => {
    await expect(db.query(`
      INSERT INTO tutorial_step_progress(user_id,role_key,step_key,status)
      VALUES ($1,'REQUESTER','invalid','SKIPPED_ALL')
    `, [userId])).rejects.toThrow();
  });
});
