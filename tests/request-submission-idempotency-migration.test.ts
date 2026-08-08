import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { applyDemoSeed, applyMigrations } from "./helpers/pglite";

const migrationUrl = new URL(
  "../database/migrations/050_request_submission_idempotency.sql",
  import.meta.url,
);

const keyOne = "10000000-0000-4000-8000-000000000050";
const keyTwo = "20000000-0000-4000-8000-000000000050";

async function fixture() {
  const db = new PGlite();
  await applyMigrations(db, {
    through: "049_active_request_write_boundary.sql",
  });
  await applyDemoSeed(db);
  const before = await db.query<{ count: number }>(
    "SELECT count(*)::int AS count FROM requests",
  );
  await db.exec(await readFile(migrationUrl, "utf8"));
  return { db, before: before.rows[0]?.count ?? 0 };
}

async function cloneRequest(db: PGlite, submissionKey: string) {
  return db.query<{ id: string; createdBy: string }>(`
    INSERT INTO requests(
      order_code,request_date,request_type_id,company_id,branch_id,
      department_id,department,requested_by,requester_contact,
      needed_by_date,urgency_id,status_id,notes,created_by,
      estimated_delivery_fee,tax_rate,client_submission_key
    )
    SELECT
      next_order_code(),CURRENT_DATE,template.request_type_id,
      template.company_id,template.branch_id,template.department_id,
      template.department,template.requested_by,template.requester_contact,
      GREATEST(template.needed_by_date,CURRENT_DATE),template.urgency_id,
      template.status_id,template.notes,template.created_by,
      template.estimated_delivery_fee,template.tax_rate,$1
    FROM requests template
    WHERE template.created_by IS NOT NULL
    ORDER BY template.id
    LIMIT 1
    RETURNING id::text,created_by::text AS "createdBy"
  `, [submissionKey]);
}

describe("request submission idempotency migration", () => {
  it("adds the key without rewriting historical requests", async () => {
    const { db, before } = await fixture();
    try {
      const state = await db.query<{
        requestCount: number;
        keyedCount: number;
        nullable: string;
        indexCount: number;
      }>(`
        SELECT
          (SELECT count(*)::int FROM requests) AS "requestCount",
          (SELECT count(*)::int FROM requests
            WHERE client_submission_key IS NOT NULL) AS "keyedCount",
          (SELECT is_nullable FROM information_schema.columns
            WHERE table_schema='public' AND table_name='requests'
              AND column_name='client_submission_key') AS nullable,
          (SELECT count(*)::int FROM pg_indexes
            WHERE schemaname='public'
              AND indexname='requests_creator_submission_key_uq')
            AS "indexCount"
      `);
      expect(state.rows[0]).toEqual({
        requestCount: before,
        keyedCount: 0,
        nullable: "YES",
        indexCount: 1,
      });
    } finally {
      await db.close();
    }
  }, 30_000);

  it("permits one request per creator and submission key", async () => {
    const { db } = await fixture();
    try {
      const first = await cloneRequest(db, keyOne);
      expect(first.rows).toHaveLength(1);
      const creatorId = first.rows[0]?.createdBy;
      expect(creatorId).toBeTruthy();

      await expect(cloneRequest(db, keyOne)).rejects.toThrow();
      await expect(cloneRequest(db, keyTwo)).resolves.toMatchObject({
        rows: [expect.objectContaining({ createdBy: creatorId })],
      });
    } finally {
      await db.close();
    }
  }, 30_000);

  it("makes the submission identity immutable and keeps its trigger private", async () => {
    const { db } = await fixture();
    try {
      const created = await cloneRequest(db, keyOne);
      const requestId = created.rows[0]?.id;
      expect(requestId).toBeTruthy();
      await expect(db.query(`
        UPDATE requests
        SET client_submission_key=$2
        WHERE id=$1
      `, [requestId, keyTwo])).rejects.toThrow(
        "Request submission identity is immutable",
      );

      const boundary = await db.query<{
        publicExecute: boolean;
        triggerCount: number;
      }>(`
        SELECT
          has_function_privilege(
            'public','axora_protect_request_submission_identity()','EXECUTE'
          ) AS "publicExecute",
          (SELECT count(*)::int FROM pg_trigger
            WHERE tgname='protect_request_submission_identity'
              AND NOT tgisinternal) AS "triggerCount"
      `);
      expect(boundary.rows[0]).toEqual({
        publicExecute: false,
        triggerCount: 1,
      });
    } finally {
      await db.close();
    }
  }, 30_000);
});
