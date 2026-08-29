import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { applyDemoSeed, applyMigrations } from "./helpers/pglite";

describe("migration 131 durable webhook credential delivery", () => {
  it("adds only the isolated disclosure policy with a safe existing-row default", async () => {
    const db=new PGlite();
    try{
      await applyMigrations(db,{through:"130_cleanup_worker_grant_reconciliation.sql"});
      await applyDemoSeed(db);
      const protectedSnapshot=async()=>(await db.query(`
        SELECT
          (SELECT count(*)::int FROM users) AS users,
          (SELECT count(*)::int FROM role_assignments) AS assignments,
          (SELECT count(*)::int FROM requests) AS requests,
          (SELECT count(*)::int FROM invoices) AS invoices,
          (SELECT count(*)::int FROM delivery_jobs) AS deliveries,
          (SELECT count(*)::int FROM payments) AS payments,
          (SELECT count(*)::int FROM company_wallet_ledger_entries) AS wallet,
          (SELECT count(*)::int FROM budget_ledger_entries) AS budgets,
          (SELECT count(*)::int FROM transactional_email_outbox) AS email,
          (SELECT count(*)::int FROM workflow_email_outbox) AS workflow_email
      `)).rows[0];
      const before=await protectedSnapshot();
      await db.exec(await readFile(new URL(
        "../database/migrations/131_integration_webhook_credential_delivery.sql",
        import.meta.url,
      ),"utf8"));
      expect(await protectedSnapshot()).toEqual(before);

      const column=await db.query<{
        nullable:string;defaultValue:string;constraintDefinition:string;
      }>(`
        SELECT column_record.is_nullable AS nullable,
          column_record.column_default AS "defaultValue",
          pg_get_constraintdef(constraint_record.oid) AS "constraintDefinition"
        FROM information_schema.columns column_record
        JOIN pg_constraint constraint_record
          ON constraint_record.conrelid=
            'public.integration_webhook_subscriptions'::regclass
         AND constraint_record.conname=
            'integration_webhook_subscriptions_credential_delivery_check'
        WHERE column_record.table_schema='public'
          AND column_record.table_name='integration_webhook_subscriptions'
          AND column_record.column_name='credential_delivery'
      `);
      expect(column.rows[0]).toMatchObject({
        nullable:"NO",
        defaultValue:"'ONE_TIME'::text",
      });
      expect(column.rows[0]?.constraintDefinition).toContain("'ONE_TIME'::text");
      expect(column.rows[0]?.constraintDefinition).toContain("'NONE'::text");
    }finally{
      await db.close();
    }
  },60_000);
});
