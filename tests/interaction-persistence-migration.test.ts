import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyDemoSeed, applyMigrations } from "./helpers/pglite";

const migrationUrl = new URL(
  "../database/migrations/013_trusted_interactions.sql",
  import.meta.url,
);
const companyA = "10000000-0000-4000-8000-000000000001";
const companyB = "10000000-0000-4000-8000-000000000002";

describe("trusted interaction persistence migration", () => {
  let db: PGlite;

  beforeAll(async () => {
    db = new PGlite();
    await applyMigrations(db);
    await applyDemoSeed(db);
  }, 30_000);

  afterAll(async () => {
    await db.close();
  });

  it("creates company-scoped profiles, revisions, and licensed asset metadata", async () => {
    const result = await db.query<{ table_name: string }>(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema='public'
        AND table_name IN (
          'company_interaction_profiles',
          'interaction_revisions',
          'interaction_assets'
        )
      ORDER BY table_name
    `);

    expect(result.rows.map((row) => row.table_name)).toEqual([
      "company_interaction_profiles",
      "interaction_assets",
      "interaction_revisions",
    ]);

    const cascades = await db.query<{ child_table: string; delete_action: string }>(`
      SELECT child.relname AS child_table, constraint_record.confdeltype AS delete_action
      FROM pg_constraint constraint_record
      JOIN pg_class child ON child.oid=constraint_record.conrelid
      JOIN pg_class parent ON parent.oid=constraint_record.confrelid
      WHERE constraint_record.contype='f'
        AND parent.relname='companies'
        AND child.relname IN (
          'company_interaction_profiles',
          'interaction_revisions',
          'interaction_assets'
        )
      ORDER BY child.relname
    `);
    expect(cascades.rows).toEqual([
      { child_table: "company_interaction_profiles", delete_action: "c" },
      { child_table: "interaction_assets", delete_action: "c" },
      { child_table: "interaction_revisions", delete_action: "c" },
    ]);
  });

  it("keeps an owner override intact when the AI recommendation regenerates", async () => {
    await db.query(
      `INSERT INTO company_interaction_profiles (
         company_id, ai_recommendation, ai_rationale, ai_recommended_at,
         owner_override, owner_override_at
       ) VALUES ($1,$2::jsonb,'Initial rationale',now(),$3::jsonb,now())
       ON CONFLICT (company_id) DO UPDATE SET
         ai_recommendation=EXCLUDED.ai_recommendation,
         ai_rationale=EXCLUDED.ai_rationale,
         ai_recommended_at=EXCLUDED.ai_recommended_at,
         owner_override=EXCLUDED.owner_override,
         owner_override_at=EXCLUDED.owner_override_at`,
      [
        companyA,
        JSON.stringify({ recommendation: "restrained-motion" }),
        JSON.stringify({ enabled: false, choice: "owner-disabled" }),
      ],
    );

    await db.query(
      `UPDATE company_interaction_profiles
       SET ai_recommendation=$2::jsonb,
           ai_rationale='Regenerated rationale',
           ai_recommended_at=now()
       WHERE company_id=$1`,
      [companyA, JSON.stringify({ recommendation: "friendly-guide" })],
    );

    const result = await db.query<{
      ai_recommendation: Record<string, unknown>;
      owner_override: Record<string, unknown>;
    }>(
      `SELECT ai_recommendation, owner_override
       FROM company_interaction_profiles WHERE company_id=$1`,
      [companyA],
    );

    expect(result.rows[0].ai_recommendation).toEqual({
      recommendation: "friendly-guide",
    });
    expect(result.rows[0].owner_override).toEqual({
      enabled: false,
      choice: "owner-disabled",
    });
  });

  it("enforces one current revision and preserves immutable publication history", async () => {
    await db.query(
      `INSERT INTO interaction_revisions
         (company_id,revision_number,config,source,is_current)
       VALUES ($1,1,$2::jsonb,'PUBLISH',true)`,
      [companyA, JSON.stringify({ version: 1 })],
    );

    await expect(
      db.query(
        `INSERT INTO interaction_revisions
           (company_id,revision_number,config,source,is_current)
         VALUES ($1,2,$2::jsonb,'PUBLISH',true)`,
        [companyA, JSON.stringify({ version: 2 })],
      ),
    ).rejects.toThrow();

    await db.query(
      "UPDATE interaction_revisions SET is_current=false WHERE company_id=$1",
      [companyA],
    );
    await db.query(
      `INSERT INTO interaction_revisions
         (company_id,revision_number,config,source,is_current)
       VALUES ($1,2,$2::jsonb,'PUBLISH',true)`,
      [companyA, JSON.stringify({ version: 2 })],
    );

    const revisions = await db.query<{
      revision_number: number;
      is_current: boolean;
    }>(
      `SELECT revision_number,is_current
       FROM interaction_revisions
       WHERE company_id=$1 ORDER BY revision_number`,
      [companyA],
    );
    expect(revisions.rows).toEqual([
      { revision_number: 1, is_current: false },
      { revision_number: 2, is_current: true },
    ]);

    await expect(
      db.query(
        `UPDATE interaction_revisions
         SET config=$2::jsonb
         WHERE company_id=$1 AND revision_number=1`,
        [companyA, JSON.stringify({ version: "silently-edited" })],
      ),
    ).rejects.toThrow(/immutable/i);

    const companyBRevision = await db.query<{ id: string }>(
      `INSERT INTO interaction_revisions
         (company_id,revision_number,config,source,is_current)
       VALUES ($1,1,$2::jsonb,'PUBLISH',true)
       RETURNING id::text`,
      [companyB, JSON.stringify({ version: "company-b" })],
    );
    await expect(
      db.query(
        `INSERT INTO interaction_revisions
           (company_id,revision_number,config,source,source_revision_id,is_current)
         VALUES ($1,3,$2::jsonb,'ROLLBACK',$3,false)`,
        [
          companyA,
          JSON.stringify({ version: "cross-tenant" }),
          companyBRevision.rows[0].id,
        ],
      ),
    ).rejects.toThrow();
  });

  it("rejects unlicensed, oversized, malformed, and hotlinked assets", async () => {
    const validValues = [
      companyA,
      "guide-original",
      "Axora guide",
      "SVG",
      "image/svg+xml",
      "interactions/guide-original.svg",
      1024,
      "a".repeat(64),
      "axora://original/guide",
      "Axora original asset",
      "Owned by Axora; commercial use approved",
      true,
    ];
    const insert = `INSERT INTO interaction_assets (
      company_id,asset_key,display_name,asset_type,content_type,storage_path,
      byte_size,sha256,source_url,license_name,license_reference,
      commercial_use_approved
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`;

    await db.query(insert, validValues);

    await expect(
      db.query(insert, [
        companyA,
        "unlicensed",
        ...validValues.slice(2, 6),
        1024,
        "b".repeat(64),
        ...validValues.slice(8, 11),
        false,
      ]),
    ).rejects.toThrow();

    await expect(
      db.query(insert, [
        companyA,
        "too-large",
        ...validValues.slice(2, 6),
        5 * 1024 * 1024 + 1,
        "c".repeat(64),
        ...validValues.slice(8),
      ]),
    ).rejects.toThrow();

    await expect(
      db.query(insert, [
        companyA,
        "bad-checksum",
        ...validValues.slice(2, 7),
        "not-a-checksum",
        ...validValues.slice(8),
      ]),
    ).rejects.toThrow();

    await expect(
      db.query(insert, [
        companyA,
        "hotlink",
        validValues[2],
        validValues[3],
        validValues[4],
        "https://example.test/guide.svg",
        ...validValues.slice(6),
      ]),
    ).rejects.toThrow();
  });

  it("allows the same approved asset key in another company but never crosses tenants", async () => {
    await db.query(
      `INSERT INTO interaction_assets (
        company_id,asset_key,display_name,asset_type,content_type,storage_path,
        byte_size,sha256,source_url,license_name,license_reference,
        commercial_use_approved
      ) VALUES ($1,'guide-original','Company B guide','SVG','image/svg+xml',
        'interactions/company-b-guide.svg',900,$2,'axora://original/company-b-guide',
        'Axora original asset','Owned by Axora; commercial use approved',true)`,
      [companyB, "d".repeat(64)],
    );

    const companyAAssets = await db.query<{ company_id: string }>(
      "SELECT company_id::text FROM interaction_assets WHERE company_id=$1",
      [companyA],
    );
    expect(companyAAssets.rows.every((row) => row.company_id === companyA)).toBe(
      true,
    );
  });

  it("records interaction changes in the existing company audit history", async () => {
    const actorId = "91000000-0000-4000-8000-000000000001";
    await db.query(
      `INSERT INTO users (
        id,email,display_name,password_hash,role_id,company_id,is_owner
      ) VALUES (
        $1,'interaction.admin@example.test','Interaction Admin','test-hash',
        (SELECT id FROM roles WHERE role_key='ADMIN'),$2,false
      ) ON CONFLICT (id) DO NOTHING`,
      [actorId, companyB],
    );

    await db.exec("BEGIN");
    try {
      await db.query(
        "SELECT set_config('axora.user_id',$1,true), set_config('axora.change_reason',$2,true)",
        [actorId, "Interaction recommendation regenerated"],
      );
      await db.query(
        `INSERT INTO company_interaction_profiles (
           company_id,ai_recommendation,ai_rationale,ai_recommended_at,ai_recommended_by
         ) VALUES ($1,$2::jsonb,'Company B rationale',now(),$3)
         ON CONFLICT (company_id) DO UPDATE SET
           ai_recommendation=EXCLUDED.ai_recommendation,
           ai_rationale=EXCLUDED.ai_rationale,
           ai_recommended_at=EXCLUDED.ai_recommended_at,
           ai_recommended_by=EXCLUDED.ai_recommended_by`,
        [companyB, JSON.stringify({ recommendation: "none" }), actorId],
      );
      await db.exec("COMMIT");
    } catch (error) {
      await db.exec("ROLLBACK");
      throw error;
    }

    const audit = await db.query<{
      actor_id: string;
      company_id: string;
      reason: string;
    }>(
      `SELECT actor_id::text,company_id::text,reason
       FROM audit_logs
       WHERE entity_type='company_interaction_profiles'
         AND company_id=$1
       ORDER BY occurred_at DESC,id DESC
       LIMIT 1`,
      [companyB],
    );
    expect(audit.rows[0]).toEqual({
      actor_id: actorId,
      company_id: companyB,
      reason: "Interaction recommendation regenerated",
    });
  });

  it("can be applied repeatedly without losing persisted interaction data", async () => {
    const sql = await readFile(migrationUrl, "utf8");
    await db.exec(sql);

    const result = await db.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM company_interaction_profiles",
    );
    expect(Number(result.rows[0].count)).toBe(2);
  });
});
