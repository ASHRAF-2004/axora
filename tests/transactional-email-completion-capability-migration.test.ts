import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrations } from "./helpers/pglite";

const signature = "axora_record_transactional_email_attempt(uuid,text,text,integer,text,text,integer,text,text,text,integer,uuid)";

describe("transactional email completion capability migration", () => {
  let db: PGlite;

  beforeAll(async () => {
    db = new PGlite();
    await db.exec("CREATE ROLE axora_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT");
    const applied = await applyMigrations(db);
    expect(applied.at(-1)).toBe("126_transactional_email_completion_capability.sql");
    await db.exec(`CREATE TABLE schema_migrations(
      filename text PRIMARY KEY,sha256 text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    const grantSource = await readFile(
      new URL("../database/admin/apply-app-grants.sql", import.meta.url),
      "utf8",
    );
    await db.exec(grantSource
      .split("\n")
      .filter((line) => (
        !line.trimStart().startsWith("\\")
        && !line.startsWith("SELECT format('GRANT CONNECT ON DATABASE")
      ))
      .join("\n"));
  }, 30_000);

  afterAll(async () => db.close());

  it("exposes only the metadata-bound SECURITY DEFINER recorder", async () => {
    const result = await db.query<{
      securityDefiner: boolean;
      appExecute: boolean;
      publicExecute: boolean;
      appDirectInsert: boolean;
      configuration: string[] | null;
    }>(`
      SELECT
        procedure.prosecdef AS "securityDefiner",
        has_function_privilege('axora_app', procedure.oid, 'EXECUTE') AS "appExecute",
        has_function_privilege('public', procedure.oid, 'EXECUTE') AS "publicExecute",
        has_table_privilege('axora_app','email_delivery_attempts','INSERT') AS "appDirectInsert",
        procedure.proconfig AS configuration
      FROM pg_proc procedure
      WHERE procedure.oid=$1::regprocedure
    `, [signature]);

    expect(result.rows[0]).toMatchObject({
      securityDefiner: true,
      appExecute: true,
      publicExecute: false,
      appDirectInsert: false,
    });
    expect(result.rows[0].configuration).toContain(
      "search_path=pg_catalog, public, pg_temp",
    );
  });

  it("rejects attempt evidence that is not bound to an updated outbox row", async () => {
    await db.exec("SET ROLE axora_app");
    try {
      await expect(db.query(`
        SELECT axora_record_transactional_email_attempt(
          '10000000-0000-4000-8000-000000000001',
          'CONTACT_NOTIFICATION','new-lead-internal-alert',1,
          'resend','axora-platform',1,'sent',NULL,NULL,NULL,
          '10000000-0000-4000-8000-000000000002'
        )
      `)).rejects.toThrow(/does not match its delivery/i);
    } finally {
      await db.exec("RESET ROLE");
    }
  });
});
