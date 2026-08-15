import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { applyMigrations } from "./helpers/pglite";

const hash = (character: string) => character.repeat(64);
const migration087Url = new URL(
  "../database/migrations/087_visitor_cookie_primary_identity.sql",
  import.meta.url,
);
const migration090Url = new URL(
  "../database/migrations/092_visitor_cookie_privacy_and_rate_limits.sql",
  import.meta.url,
);

describe("visitor network-identity retirement", () => {
  it("removes historical durable identifiers while preserving claims and totals", async () => {
    const db = new PGlite();
    try {
      await applyMigrations(db, { through: "086_customer_catalog_public_references.sql" });
      await db.query(
        `SELECT * FROM axora_claim_public_visitor(
           $1,$2,$3,$4,$5,'EARLY_BIRD','en',now(),'axora.management'
         )`,
        [hash("a"), hash("b"), hash("c"), hash("d"), hash("e")],
      );
      const before = await db.query<{ claims: number; networks: number; durable: number }>(`
        SELECT
          (SELECT count(*)::int FROM public_visitor_claims) AS claims,
          (SELECT count(*)::int FROM public_visitor_network_claims) AS networks,
          (SELECT count(*)::int FROM public_visitor_claims
            WHERE network_hash IS NOT NULL OR network_device_hash IS NOT NULL
              OR client_signal_hash IS NOT NULL OR turnstile_device_hash IS NOT NULL) AS durable
      `);
      expect(before.rows[0]).toEqual({ claims: 1, networks: 1, durable: 1 });

      await db.exec(await readFile(migration087Url, "utf8"));
      await db.exec(await readFile(migration090Url, "utf8"));

      const after = await db.query<{
        claims: number;
        total: number;
        networkTable: string | null;
        legacyColumns: number;
      }>(`
        SELECT
          (SELECT count(*)::int FROM public_visitor_claims) AS claims,
          (SELECT total_count::int FROM public_visitor_counter_state WHERE singleton=true) AS total,
          to_regclass('public.public_visitor_network_claims')::text AS "networkTable",
          (SELECT count(*)::int FROM information_schema.columns
            WHERE table_schema='public' AND table_name='public_visitor_claims'
              AND column_name IN ('network_hash','network_device_hash','client_signal_hash','turnstile_device_hash')) AS "legacyColumns"
      `);
      expect(after.rows[0]).toEqual({
        claims: 1,
        total: 1,
        networkTable: null,
        legacyColumns: 0,
      });
      const preserved = await db.query<{ number: number; choice: string }>(`
        SELECT visitor_number::int AS number,choice
        FROM axora_public_visitor_snapshot_v3($1)
      `, [hash("a")]);
      expect(preserved.rows[0]).toEqual({ number: 1, choice: "EARLY_BIRD" });
    } finally {
      await db.close();
    }
  }, 30_000);

  it("grants only cookie capabilities and keeps direct tables inaccessible", async () => {
    const db = new PGlite();
    try {
      await db.exec("CREATE ROLE axora_app NOLOGIN");
      await applyMigrations(db);
      const boundary = await db.query<{
        appSnapshot: boolean;
        appClaim: boolean;
        appClaimsSelect: boolean;
        legacySnapshotGone: boolean;
        legacyClaimGone: boolean;
        fallbackGone: boolean;
        networkTableGone: boolean;
      }>(`
        SELECT
          has_function_privilege('axora_app','axora_public_visitor_snapshot_v3(text)','EXECUTE') AS "appSnapshot",
          has_function_privilege('axora_app','axora_claim_public_visitor_v3(text,text,text,timestamptz,text)','EXECUTE') AS "appClaim",
          has_table_privilege('axora_app','public_visitor_claims','SELECT') AS "appClaimsSelect",
          to_regprocedure('public.axora_public_visitor_snapshot_v2(text,text,text,text)') IS NULL AS "legacySnapshotGone",
          to_regprocedure('public.axora_claim_public_visitor(text,text,text,text,text,text,text,timestamptz,text)') IS NULL AS "legacyClaimGone",
          to_regprocedure('public.axora_claim_public_visitor_fallback(text,text,text,text,text,text)') IS NULL AS "fallbackGone",
          to_regclass('public.public_visitor_network_claims') IS NULL AS "networkTableGone"
      `);
      expect(boundary.rows[0]).toEqual({
        appSnapshot: true,
        appClaim: true,
        appClaimsSelect: false,
        legacySnapshotGone: true,
        legacyClaimGone: true,
        fallbackGone: true,
        networkTableGone: true,
      });
    } finally {
      await db.close();
    }
  }, 30_000);

  it("retains only current short-lived visitor rate buckets", async () => {
    const db = new PGlite();
    try {
      await applyMigrations(db);
      await db.query(
        `INSERT INTO public_request_rate_buckets(
           action_key,scope_kind,scope_hash,bucket_started_at,request_count
         ) VALUES
           ('VISITOR_CHOICE','NETWORK',$1,date_trunc('hour',now())-interval '3 hours',1),
           ('VISITOR_CHOICE','NETWORK',$2,date_trunc('hour',now()),1)`,
        [hash("a"), hash("b")],
      );
      await db.exec("SELECT axora_prune_public_visitor_rate_buckets()");
      const rows = await db.query<{ count: number }>(
        "SELECT count(*)::int AS count FROM public_request_rate_buckets WHERE action_key='VISITOR_CHOICE'",
      );
      expect(rows.rows[0]?.count).toBe(1);
      await expect(db.query(
        `INSERT INTO public_request_rate_buckets(
           action_key,scope_kind,scope_hash,bucket_started_at,request_count
         ) VALUES ('VISITOR_CHOICE_STREAM','NETWORK',$1,date_trunc('hour',now()),1)`,
        [hash("c")],
      )).rejects.toThrow(/check constraint/i);
    } finally {
      await db.close();
    }
  }, 30_000);
});
