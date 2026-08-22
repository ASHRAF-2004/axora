import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrations } from "./helpers/pglite";

const ownerId = "a8100000-0000-4000-8000-000000000001";
const operatorId = "a8100000-0000-4000-8000-000000000002";
const ownerAssignment = "a8200000-0000-4000-8000-000000000001";
const operatorAssignment = "a8200000-0000-4000-8000-000000000002";

describe("Resend quota snapshot migration", () => {
  let db: PGlite;

  beforeAll(async () => {
    db = new PGlite();
    await db.exec("CREATE ROLE axora_app NOLOGIN");
    await applyMigrations(db);
    await db.exec(`
      INSERT INTO users(id,email,display_name,password_hash,role_id,is_owner,account_kind,account_status)
      SELECT '${ownerId}','quota-owner@example.test','Quota Owner','not-a-real-hash',id,true,'PLATFORM','ACTIVE'
      FROM roles WHERE role_key='PLATFORM_OWNER';
      INSERT INTO users(id,email,display_name,password_hash,role_id,is_owner,account_kind,account_status)
      SELECT '${operatorId}','quota-operator@example.test','Quota Operator','not-a-real-hash',id,false,'PLATFORM','ACTIVE'
      FROM roles WHERE role_key='PLATFORM_OPERATIONS';
      INSERT INTO role_assignments(id,user_id,role_id,scope_type)
      SELECT '${ownerAssignment}','${ownerId}',id,'PLATFORM' FROM roles WHERE role_key='PLATFORM_OWNER';
      INSERT INTO role_assignments(id,user_id,role_id,scope_type)
      SELECT '${operatorAssignment}','${operatorId}',id,'PLATFORM' FROM roles WHERE role_key='PLATFORM_OPERATIONS';
    `);
  });

  afterAll(async () => db.close());

  async function record(monthlyUsed: number, dailyUsed: number, capturedAt: string) {
    await db.exec("SELECT set_config('axora.system_identity','EMAIL_PROVIDER_QUOTA',false)");
    return db.query<{ changed: boolean }>(`
      SELECT axora_record_resend_quota_snapshot(
        'FREE'::text,$1::bigint,3000::bigint,$2::bigint,100::bigint,
        'PROVIDER_RESPONSE_HEADER'::text,2::smallint,$3::timestamptz
      ) AS changed
    `, [monthlyUsed, dailyUsed, capturedAt]);
  }

  it("persists the latest valid snapshot and refuses an older overwrite", async () => {
    await expect(record(8, 0, "2026-08-22T10:00:00.000Z"))
      .resolves.toMatchObject({ rows: [{ changed: true }] });
    await expect(record(3, 1, "2026-08-22T09:00:00.000Z"))
      .resolves.toMatchObject({ rows: [{ changed: false }] });
    await expect(db.query(`SELECT monthly_used::int,daily_used::int,captured_at::text FROM resend_quota_snapshot`))
      .resolves.toMatchObject({ rows: [expect.objectContaining({ monthly_used: 8, daily_used: 0 })] });
  });

  it("stores no credential, recipient, content, subject, body, or raw header fields", async () => {
    const columns = await db.query<{ column_name: string }>(`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema='public' AND table_name='resend_quota_snapshot'
    `);
    const names = columns.rows.map((row) => row.column_name).join(" ");
    expect(names).not.toMatch(/key|recipient|content|subject|body|header|authorization/i);
  });

  it("denies direct app-role reads and exposes the snapshot only to the active Owner", async () => {
    await db.exec("SET ROLE axora_app");
    await expect(db.query("SELECT * FROM resend_quota_snapshot"))
      .rejects.toThrow(/permission denied/i);

    await db.exec(`
      SELECT set_config('axora.user_id','${operatorId}',false),
        set_config('axora.role_assignment_id','${operatorAssignment}',false)
    `);
    await expect(db.query("SELECT axora_current_resend_quota_snapshot()"))
      .rejects.toThrow(/unavailable/i);

    await db.exec(`
      SELECT set_config('axora.user_id','${ownerId}',false),
        set_config('axora.role_assignment_id','${ownerAssignment}',false)
    `);
    await expect(db.query<{ snapshot: { monthlyUsed: number; dailyUsed: number } }>(`
      SELECT axora_current_resend_quota_snapshot() AS snapshot
    `)).resolves.toMatchObject({ rows: [{ snapshot: { monthlyUsed: 8, dailyUsed: 0 } }] });
    await db.exec("RESET ROLE");
  });

  it("upgrades a current migration-107 database without touching email delivery tables", async () => {
    const upgrade = new PGlite();
    try {
      await upgrade.exec("CREATE ROLE axora_app NOLOGIN");
      await applyMigrations(upgrade, { through: "107_mvp_simplification.sql" });
      await upgrade.exec(await readFile(new URL(
        "../database/migrations/108_resend_quota_snapshot.sql",
        import.meta.url,
      ), "utf8"));
      await expect(upgrade.query<{ table_name: string }>(`
        SELECT table_name FROM information_schema.tables
        WHERE table_schema='public' AND table_name='resend_quota_snapshot'
      `)).resolves.toMatchObject({ rows: [{ table_name: "resend_quota_snapshot" }] });
    } finally {
      await upgrade.close();
    }
  }, 45_000);
});
