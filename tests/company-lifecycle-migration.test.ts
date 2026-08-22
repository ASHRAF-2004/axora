import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { applyDemoSeed, applyMigrations } from "./helpers/pglite";

const migrationUrl = new URL(
  "../database/migrations/051_company_lifecycle.sql",
  import.meta.url,
);
const actionsUrl = new URL(
  "../src/app/(portal)/masters/actions.ts",
  import.meta.url,
);

const ids = {
  owner: "51000000-0000-4000-8000-000000000001",
  managerA: "51000000-0000-4000-8000-000000000002",
  managerB: "51000000-0000-4000-8000-000000000003",
  managerC: "51000000-0000-4000-8000-000000000004",
  ownerAssignment: "51000000-0000-4000-8000-000000000011",
  managerAssignmentA: "51000000-0000-4000-8000-000000000012",
  managerAssignmentB: "51000000-0000-4000-8000-000000000013",
  managerAssignmentC: "51000000-0000-4000-8000-000000000014",
} as const;

interface Fixture {
  db: PGlite;
  baseCompanyId: string;
}

interface Mutation {
  companyId: string;
  companyName: string;
  companyVersion: number;
  eventKey: string;
  company: Record<string, unknown> | null;
  blockedReasons?: string[];
}

interface SnapshotRow {
  snapshot: Record<string, unknown> | null;
}

async function fixture(): Promise<Fixture> {
  const db = new PGlite();
  await applyMigrations(db, { through: "050_request_submission_idempotency.sql" });
  await applyDemoSeed(db);
  await db.exec(await readFile(migrationUrl, "utf8"));

  const company = await db.query<{ id: string }>(`
    SELECT id::text FROM companies WHERE active ORDER BY id LIMIT 1
  `);
  const baseCompanyId = company.rows[0]?.id;
  if (!baseCompanyId) throw new Error("Lifecycle fixture requires an active company");

  await db.query(`
    INSERT INTO users(
      id,email,display_name,password_hash,role_id,is_owner,
      account_setup_completed_at,account_kind,account_status,active,auth_version
    ) VALUES
      ($1,'owner-051@example.test','Lifecycle Owner','not-a-real-hash',
        (SELECT id FROM roles WHERE role_key='PLATFORM_OWNER'),true,
        now(),'PLATFORM','ACTIVE',true,1),
      ($2,'manager-a-051@example.test','Manager A','not-a-real-hash',
        (SELECT id FROM roles WHERE role_key='CLIENT_ACCOUNT_MANAGER'),false,
        now(),'PLATFORM','ACTIVE',true,1),
      ($3,'manager-b-051@example.test','Manager B','not-a-real-hash',
        (SELECT id FROM roles WHERE role_key='CLIENT_ACCOUNT_MANAGER'),false,
        now(),'PLATFORM','ACTIVE',true,1),
      ($4,'manager-c-051@example.test','Manager C','not-a-real-hash',
        (SELECT id FROM roles WHERE role_key='CLIENT_ACCOUNT_MANAGER'),false,
        now(),'PLATFORM','ACTIVE',true,1)
  `, [ids.owner, ids.managerA, ids.managerB, ids.managerC]);
  await db.query(`
    INSERT INTO role_assignments(
      id,user_id,role_id,scope_type,company_id,active,assigned_by
    ) VALUES
      ($1,$5,(SELECT id FROM roles WHERE role_key='PLATFORM_OWNER'),
        'PLATFORM',NULL,true,$5),
      ($2,$6,(SELECT id FROM roles WHERE role_key='CLIENT_ACCOUNT_MANAGER'),
        'COMPANY',$9,true,$5),
      ($3,$7,(SELECT id FROM roles WHERE role_key='CLIENT_ACCOUNT_MANAGER'),
        'COMPANY',$9,true,$5),
      ($4,$8,(SELECT id FROM roles WHERE role_key='CLIENT_ACCOUNT_MANAGER'),
        'COMPANY',$9,true,$5)
  `, [
    ids.ownerAssignment,
    ids.managerAssignmentA,
    ids.managerAssignmentB,
    ids.managerAssignmentC,
    ids.owner,
    ids.managerA,
    ids.managerB,
    ids.managerC,
    baseCompanyId,
  ]);
  return { db, baseCompanyId };
}

async function createLead(
  db: PGlite,
  suffix: string,
  actorId: string = ids.owner,
  assignmentId: string = ids.ownerAssignment,
  identity: Partial<{
    name: string;
    legalName: string;
    registrationNumber: string;
    email: string;
    phone: string;
  }> = {},
) {
  const result = await db.query<{ snapshot: Mutation }>(`
    SELECT axora_create_company_lead(
      $1,$2,$3,$4,$5,'Professional services','Lifecycle fixture',NULL,
      'Primary Contact',$6,$7,'Billing Contact',$6,$7,
      'Lifecycle fixture address','Cash on delivery (COD)','Monthly',NULL,now()
    ) AS snapshot
  `, [
    actorId,
    assignmentId,
    identity.name ?? `Lifecycle ${suffix}`,
    identity.legalName ?? `Lifecycle ${suffix} Sdn Bhd`,
    identity.registrationNumber ?? `REG-051-${suffix}`,
    identity.email ?? `contact-${suffix.toLowerCase()}@${suffix.toLowerCase()}.example.test`,
    identity.phone ?? `+60351${suffix.replace(/\D/g, "").padStart(6, "0")}`,
  ]);
  const snapshot = result.rows[0]?.snapshot;
  if (!snapshot?.companyId) throw new Error("Company lead creation failed");
  return snapshot;
}

async function workspace(
  db: PGlite,
  actorId: string,
  assignmentId: string,
  at = new Date(),
) {
  const result = await db.query<SnapshotRow>(`
    SELECT axora_company_lifecycle_workspace($1,$2,$3) AS snapshot
  `, [actorId, assignmentId, at]);
  const snapshot = result.rows[0]?.snapshot;
  if (!snapshot) return null;
  return snapshot as {
    companies: Array<Record<string, unknown>>;
    managers: Array<Record<string, unknown>>;
    canCreate: boolean;
    canViewAll: boolean;
  };
}

async function assign(
  db: PGlite,
  companyId: string,
  managerId: string,
  assignmentType: "PRIMARY" | "BACKUP" = "PRIMARY",
  startsAt?: Date,
  endsAt?: Date,
) {
  return db.query<{ snapshot: Mutation }>(`
    SELECT axora_assign_company_manager(
      $1,$2,$3,$4,$5,$6,$7,'Lifecycle test assignment',now()
    ) AS snapshot
  `, [
    ids.owner,
    ids.ownerAssignment,
    companyId,
    managerId,
    assignmentType,
    startsAt ?? null,
    endsAt ?? null,
  ]);
}

async function transition(
  db: PGlite,
  companyId: string,
  toStatus: string,
  actorId: string = ids.owner,
  assignmentId: string = ids.ownerAssignment,
) {
  return db.query<{ snapshot: Mutation }>(`
    SELECT axora_transition_company_lifecycle(
      $1,$2,$3,$4,'Lifecycle test transition',now()
    ) AS snapshot
  `, [actorId, assignmentId, companyId, toStatus]);
}

async function advanceToCompanyReview(db: PGlite, suffix: string) {
  const created = await createLead(db, suffix);
  await assign(db, created.companyId, ids.managerA);
  await transition(db, created.companyId, "CONTACTED");
  await transition(db, created.companyId, "ONBOARDING");
  await transition(db, created.companyId, "PORTAL_DRAFT");
  await transition(db, created.companyId, "COMPANY_REVIEW");
  return created.companyId;
}

describe("company lifecycle migration", () => {
  it("enforces the canonical lifecycle transition sequence and immutable history", async () => {
    const { db } = await fixture();
    try {
      const created = await createLead(db, "LIFECYCLE-1");
      await expect(transition(db, created.companyId, "ACTIVE")).rejects.toThrow(
        "not permitted",
      );
      await assign(db, created.companyId, ids.managerA);
      await transition(db, created.companyId, "CONTACTED");
      await transition(db, created.companyId, "INFORMATION_PENDING");
      await transition(db, created.companyId, "ONBOARDING");
      await transition(db, created.companyId, "PORTAL_DRAFT");
      await transition(db, created.companyId, "COMPANY_REVIEW");

      const state = await db.query<{
        status: string;
        version: number;
        history: number;
      }>(`
        SELECT lifecycle_status AS status,lifecycle_version AS version,
          (SELECT count(*)::int FROM company_status_history history
            WHERE history.company_id=company.id) AS history
        FROM companies company WHERE id=$1
      `, [created.companyId]);
      expect(state.rows[0]).toMatchObject({ status: "COMPANY_REVIEW" });
      expect(state.rows[0]?.history).toBe(state.rows[0]?.version);
      await expect(db.query(`
        UPDATE company_status_history SET reason='rewritten' WHERE company_id=$1
      `, [created.companyId])).rejects.toThrow("append-only");
    } finally {
      await db.close();
    }
  }, 30_000);

  it("filters owner, primary, backup-window, other-manager, and public views", async () => {
    const { db } = await fixture();
    try {
      const created = await createLead(db, "VISIBILITY-2");
      const ownerView = await workspace(db, ids.owner, ids.ownerAssignment);
      const managerBefore = await workspace(db, ids.managerA, ids.managerAssignmentA);
      expect(ownerView?.companies.some((company) => company.id === created.companyId)).toBe(true);
      expect(managerBefore?.companies.some((company) => company.id === created.companyId)).toBe(false);

      await assign(db, created.companyId, ids.managerA);
      const startsAt = new Date(Date.now() - 60_000);
      const endsAt = new Date(Date.now() + 3_600_000);
      await assign(db, created.companyId, ids.managerB, "BACKUP", startsAt, endsAt);
      const primaryView = await workspace(db, ids.managerA, ids.managerAssignmentA);
      const backupView = await workspace(db, ids.managerB, ids.managerAssignmentB);
      const otherView = await workspace(db, ids.managerC, ids.managerAssignmentC);
      const expiredBackupView = await workspace(
        db,
        ids.managerB,
        ids.managerAssignmentB,
        new Date(endsAt.getTime() + 1),
      );
      expect(primaryView?.companies.some((company) => company.id === created.companyId)).toBe(true);
      expect(backupView?.companies.some((company) => company.id === created.companyId)).toBe(true);
      expect(otherView?.companies.some((company) => company.id === created.companyId)).toBe(false);
      expect(expiredBackupView?.companies.some((company) => company.id === created.companyId)).toBe(false);

      await db.query(`
        SELECT axora_set_company_publication(
          $1,$2,$3,true,'Explicit public listing test',now()
        )
      `, [ids.owner, ids.ownerAssignment, created.companyId]);
      const publicRows = await db.query<Record<string, unknown>>(
        "SELECT * FROM axora_public_company_listing_rows() WHERE company_id=$1",
        [created.companyId],
      );
      expect(publicRows.rows).toHaveLength(1);
      expect(Object.keys(publicRows.rows[0] ?? {}).sort()).toEqual([
        "company_code", "company_id", "display_name", "industry", "website_url",
      ]);
      const privateContact = await db.query<{ email: string }>(
        "SELECT main_contact_email AS email FROM companies WHERE id=$1",
        [created.companyId],
      );
      expect(JSON.stringify(publicRows.rows)).not.toContain(privateContact.rows[0]?.email);
    } finally {
      await db.close();
    }
  }, 30_000);

  it("returns a stable created record immediately and invalidates the company list path", async () => {
    const { db } = await fixture();
    try {
      const created = await createLead(db, "CREATE-LIST-3");
      const ownerView = await workspace(db, ids.owner, ids.ownerAssignment);
      const visible = ownerView?.companies.find((company) => company.id === created.companyId);
      expect(visible).toMatchObject({
        id: created.companyId,
        code: expect.stringMatching(/^C-/),
        status: "NEW_LEAD",
      });
      const actions = await readFile(actionsUrl, "utf8");
      expect(actions).toContain('revalidatePath("/companies")');
      expect(actions).toContain("/companies/${created.companyId}?notice=company-created");
    } finally {
      await db.close();
    }
  }, 30_000);

  it("serializes duplicate submissions and creates review evidence without merging", async () => {
    const { db } = await fixture();
    try {
      const identity = {
        name: "Concurrent Duplicate",
        legalName: "Concurrent Duplicate Sdn Bhd",
        registrationNumber: "DUP-CONCURRENT-051",
        email: "contact@duplicate-051.example.test",
        phone: "+6035100051",
      };
      const [first, second] = await Promise.all([
        createLead(db, "DUP-A", ids.owner, ids.ownerAssignment, identity),
        createLead(db, "DUP-B", ids.owner, ids.ownerAssignment, identity),
      ]);
      expect(first.companyId).not.toBe(second.companyId);
      const state = await db.query<{
        companies: number;
        possible: number;
        candidates: number;
      }>(`
        SELECT
          (SELECT count(*)::int FROM companies
            WHERE registration_number='DUP-CONCURRENT-051') AS companies,
          (SELECT count(*)::int FROM companies
            WHERE registration_number='DUP-CONCURRENT-051'
              AND duplicate_review_status='POSSIBLE_DUPLICATE') AS possible,
          (SELECT count(*)::int FROM company_duplicate_candidates duplicate
            JOIN companies company ON company.id=duplicate.company_id
            WHERE company.registration_number='DUP-CONCURRENT-051') AS candidates
      `);
      expect(state.rows[0]).toEqual({ companies: 2, possible: 1, candidates: 1 });
    } finally {
      await db.close();
    }
  }, 30_000);

  it("reassignment revokes former access, transfers open work, and preserves attribution", async () => {
    const { db } = await fixture();
    try {
      const created = await createLead(db, "REASSIGN-5");
      await assign(db, created.companyId, ids.managerA);
      await transition(
        db,
        created.companyId,
        "CONTACTED",
        ids.managerA,
        ids.managerAssignmentA,
      );
      await assign(db, created.companyId, ids.managerB);

      const formerView = await workspace(db, ids.managerA, ids.managerAssignmentA);
      const newView = await workspace(db, ids.managerB, ids.managerAssignmentB);
      expect(formerView?.companies.some((company) => company.id === created.companyId)).toBe(false);
      expect(newView?.companies.some((company) => company.id === created.companyId)).toBe(true);
      const state = await db.query<{
        oldEnded: number;
        newActive: number;
        openOwnedByNew: number;
        formerHistory: number;
      }>(`
        SELECT
          (SELECT count(*)::int FROM company_assignments
            WHERE company_id=$1 AND manager_user_id=$2 AND status='ENDED') AS "oldEnded",
          (SELECT count(*)::int FROM company_assignments
            WHERE company_id=$1 AND manager_user_id=$3 AND status='ACTIVE'
              AND assignment_type='PRIMARY') AS "newActive",
          (SELECT count(*)::int FROM company_onboarding_items
            WHERE company_id=$1 AND status IN ('PENDING','FAILED')
              AND assigned_manager_user_id=$3) AS "openOwnedByNew",
          (SELECT count(*)::int FROM company_status_history
            WHERE company_id=$1 AND changed_by=$2) AS "formerHistory"
      `, [created.companyId, ids.managerA, ids.managerB]);
      expect(state.rows[0]?.oldEnded).toBe(1);
      expect(state.rows[0]?.newActive).toBe(1);
      expect(state.rows[0]?.openOwnedByNew).toBeGreaterThan(0);
      expect(state.rows[0]?.formerHistory).toBe(1);
    } finally {
      await db.close();
    }
  }, 30_000);

  it("blocks activation until every mandatory item passes and never publishes implicitly", async () => {
    const { db } = await fixture();
    try {
      const companyId = await advanceToCompanyReview(db, "ACTIVATE-6");
      await db.query(`
        SELECT axora_apply_company_status(
          $1,'COMPANY_ADMINISTRATOR_INVITED',$2,
          'Lifecycle activation fixture',now(),'{}'::jsonb
        )
      `, [companyId, ids.owner]);
      await db.query(`
        SELECT axora_apply_company_status(
          $1,'COMPANY_ADMINISTRATOR_ACTIVATED',$2,
          'Lifecycle activation fixture',now(),'{}'::jsonb
        )
      `, [companyId, ids.owner]);

      const blocked = await db.query<{ snapshot: Mutation }>(`
        SELECT axora_activate_company(
          $1,$2,$3,'Attempt before checklist completion',now()
        ) AS snapshot
      `, [ids.owner, ids.ownerAssignment, companyId]);
      expect(blocked.rows[0]?.snapshot.blockedReasons).toContain("APPROVED_BRAND");
      const stillInactive = await db.query<{ active: boolean }>(
        "SELECT active FROM companies WHERE id=$1",
        [companyId],
      );
      expect(stillInactive.rows[0]?.active).toBe(false);

      await db.query(`
        UPDATE company_onboarding_items
        SET status='PASSED',blocking_reason=NULL,completed_by=$2,completed_at=now()
        WHERE company_id=$1 AND status NOT IN ('PASSED','WAIVED')
      `, [companyId, ids.owner]);
      const activated = await db.query<{ snapshot: Mutation }>(`
        SELECT axora_activate_company(
          $1,$2,$3,'All mandatory checks completed',now()
        ) AS snapshot
      `, [ids.owner, ids.ownerAssignment, companyId]);
      expect(activated.rows[0]?.snapshot.company).toMatchObject({
        status: "ACTIVE",
        active: true,
        portalAccessEnabled: true,
        isPubliclyListed: false,
      });
      const publicRows = await db.query<{ count: number }>(`
        SELECT count(*)::int AS count FROM axora_public_company_listing_rows()
        WHERE company_id=$1
      `, [companyId]);
      expect(publicRows.rows[0]?.count).toBe(0);
    } finally {
      await db.close();
    }
  }, 30_000);

  it("suspends with open work without deleting or rewriting historical records", async () => {
    const { db } = await fixture();
    try {
      const target = await db.query<{ companyId: string; requests: number }>(`
        SELECT company.id::text AS "companyId",count(request.id)::int AS requests
        FROM companies company
        JOIN requests request ON request.company_id=company.id
        WHERE company.lifecycle_status='ACTIVE'
        GROUP BY company.id
        HAVING count(request.id)>0
        ORDER BY company.id
        LIMIT 1
      `);
      const companyId = target.rows[0]?.companyId;
      const requestCount = target.rows[0]?.requests;
      expect(companyId).toBeTruthy();
      const result = await db.query<{ snapshot: Mutation }>(`
        SELECT axora_suspend_company(
          $1,$2,$3,'Compliance review with open work preserved',now()
        ) AS snapshot
      `, [ids.owner, ids.ownerAssignment, companyId]);
      expect(result.rows[0]?.snapshot.company).toMatchObject({
        status: "SUSPENDED",
        active: false,
        portalAccessEnabled: false,
      });
      const after = await db.query<{
        requests: number;
        openRequests: number;
        reason: string;
      }>(`
        SELECT
          (SELECT count(*)::int FROM requests WHERE company_id=$1) AS requests,
          (SELECT (metadata->>'openRequestsPreserved')::int
            FROM company_status_history
            WHERE company_id=$1 AND to_status='SUSPENDED'
            ORDER BY lifecycle_version DESC LIMIT 1) AS "openRequests",
          suspension_reason AS reason
        FROM companies WHERE id=$1
      `, [companyId]);
      expect(after.rows[0]?.requests).toBe(requestCount);
      expect(after.rows[0]?.openRequests).toBeGreaterThan(0);
      expect(after.rows[0]?.reason).toBe("Compliance review with open work preserved");
    } finally {
      await db.close();
    }
  }, 30_000);

  it("exposes lifecycle state only through least-privilege application capabilities", async () => {
    const db = new PGlite();
    try {
      await applyMigrations(db, { through: "050_request_submission_idempotency.sql" });
      await applyDemoSeed(db);
      await db.exec("CREATE ROLE axora_app NOLOGIN");
      await db.exec(await readFile(migrationUrl, "utf8"));
      const privileges = await db.query<{
        workspace: boolean;
        helper: boolean;
        assignmentsSelect: boolean;
        publicWorkspace: boolean;
      }>(`
        SELECT
          has_function_privilege(
            'axora_app','axora_company_lifecycle_workspace(uuid,uuid,timestamptz)','EXECUTE'
          ) AS workspace,
          has_function_privilege(
            'axora_app','axora_company_actor_can_view(jsonb,uuid,uuid,timestamptz)','EXECUTE'
          ) AS helper,
          has_table_privilege(
            'axora_app','company_assignments','SELECT'
          ) AS "assignmentsSelect",
          has_function_privilege(
            'public','axora_company_lifecycle_workspace(uuid,uuid,timestamptz)','EXECUTE'
          ) AS "publicWorkspace"
      `);
      expect(privileges.rows[0]).toEqual({
        workspace: true,
        helper: false,
        assignmentsSelect: false,
        publicWorkspace: false,
      });
    } finally {
      await db.close();
    }
  }, 30_000);
});
