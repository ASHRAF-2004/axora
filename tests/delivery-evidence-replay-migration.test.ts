import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

import { applyMigrations } from "./helpers/pglite";

describe("delivery evidence command replay", () => {
  it("serializes an actor command and binds a replay to its original job and evidence type", async () => {
    const db = new PGlite();
    try {
      await db.exec("CREATE ROLE axora_app NOLOGIN");
      await applyMigrations(db, {
        through: "103_operating_model_company_and_location.sql",
      });

      const row = (await db.query<{ definition: string }>(`
        SELECT pg_get_functiondef(
          'public.axora_register_delivery_evidence(uuid,uuid,uuid,uuid,uuid,text,text,text,text,text,timestamptz,text,text,timestamptz,integer,integer,uuid,jsonb,timestamptz)'::regprocedure
        ) AS definition
      `)).rows[0];

      expect(row?.definition).toContain("delivery-evidence-command:");
      expect(row?.definition).toContain("pg_advisory_xact_lock");
      expect(row?.definition).toContain(
        "existing.delivery_job_id IS DISTINCT FROM p_delivery_job_id",
      );
      expect(row?.definition).toContain(
        "existing.evidence_type IS DISTINCT FROM p_evidence_type",
      );
      expect(row?.definition).toMatch(/'created',\s*false/);
      expect(row?.definition).toMatch(/'storagePath',\s*existing\.storage_path/);
    } finally {
      await db.close();
    }
  }, 45_000);
});
