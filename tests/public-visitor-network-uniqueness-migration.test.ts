import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { applyMigrations } from "./helpers/pglite";

const hash = (character: string) => character.repeat(64);
const migration087Url = new URL(
  "../database/migrations/087_visitor_cookie_primary_identity.sql",
  import.meta.url,
);
const migration092Url = new URL(
  "../database/migrations/092_visitor_cookie_privacy_and_rate_limits.sql",
  import.meta.url,
);
const migration093Url = new URL(
  "../database/migrations/093_public_visitor_counter_state_and_compatibility.sql",
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
      await db.exec(await readFile(migration092Url, "utf8"));

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

  it("grants required v3 and compatibility v2 visitor capabilities", async () => {
    const db = new PGlite();
    try {
      await db.exec("CREATE ROLE axora_app NOLOGIN");
      await applyMigrations(db);
      const boundary = await db.query<{
        appSnapshotV3: boolean;
        appClaimV3: boolean;
        appSnapshotV2: boolean;
        appClaimV2: boolean;
        appClaimsSelect: boolean;
        legacySnapshotExists: boolean;
        legacyClaimExists: boolean;
        fallbackGone: boolean;
        networkTableGone: boolean;
      }>(`
        SELECT
          has_function_privilege('axora_app','axora_public_visitor_snapshot_v3(text)','EXECUTE') AS "appSnapshotV3",
          has_function_privilege('axora_app','axora_claim_public_visitor_v3(text,text,text,timestamptz,text)','EXECUTE') AS "appClaimV3",
          has_function_privilege('axora_app','axora_public_visitor_snapshot_v2(text,text,text,text)','EXECUTE') AS "appSnapshotV2",
        has_function_privilege('axora_app','axora_claim_public_visitor(text,text,text,text,text,text,text,timestamptz,text)','EXECUTE') AS "appClaimV2",
          has_table_privilege('axora_app','public_visitor_claims','SELECT') AS "appClaimsSelect",
          to_regprocedure('public.axora_public_visitor_snapshot_v2(text,text,text,text)')::text IS NOT NULL AS "legacySnapshotExists",
          to_regprocedure('public.axora_claim_public_visitor(text,text,text,text,text,text,text,timestamptz,text)')::text IS NOT NULL AS "legacyClaimExists",
          NOT EXISTS (
            SELECT 1 FROM pg_proc proc
            JOIN pg_namespace ns ON ns.oid=proc.pronamespace
            WHERE ns.nspname='public'
              AND proc.proname='axora_claim_public_visitor_fallback'
              AND pg_get_function_identity_arguments(proc.oid)='text, text, text, text, text, text'
          ) AS "fallbackGone",
          to_regclass('public.public_visitor_network_claims') IS NULL AS "networkTableGone"
      `);
      expect(boundary.rows[0]).toEqual({
        appSnapshotV3: true,
        appClaimV3: true,
        appSnapshotV2: true,
        appClaimV2: true,
        appClaimsSelect: false,
        legacySnapshotExists: true,
        legacyClaimExists: true,
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

  it("rebuilds missing singleton state from canonical claims", async () => {
      const db = new PGlite();
    try {
      await applyMigrations(db, { through: "092_visitor_cookie_privacy_and_rate_limits.sql" });

      await db.query("DELETE FROM public.public_visitor_counter_state");
      const seededClaim = await db.query<{ id: string }>(`
        INSERT INTO public_visitor_claims(
          visitor_number,
          choice,
          locale,
          turnstile_challenge_at,
          turnstile_hostname,
          turnstile_action,
          verification_method
        ) VALUES (
          1,
          'EARLY_BIRD',
          'en',
          now(),
          'axora.management',
          'visitor_choice',
          'TURNSTILE'
        )
        RETURNING id
      `);
      await db.query("INSERT INTO public_visitor_claim_tokens(token_hash,claim_id) VALUES ($1,$2)", [hash("a"), seededClaim.rows[0].id]);

      const missingState = await db.query<{ total: number }>("SELECT total_count::int AS total FROM public.public_visitor_counter_state");
      expect(missingState.rows).toEqual([]);

      await db.exec(await readFile(migration093Url, "utf8"));

      const repaired = await db.query<{
        total: number;
        early: number;
        night: number;
      }>(`SELECT
          total_count::int AS total,
          early_bird_count::int AS early,
          night_owl_count::int AS night
        FROM public.public_visitor_counter_state
        WHERE singleton=true
      `);
      expect(repaired.rows[0]).toEqual({ total: 1, early: 1, night: 0 });

      const snapshot = await db.query<{
        version: number;
        total: number;
        early: number;
        night: number;
        visitorNumber: number | null;
      }>(`
        SELECT
          snapshot_version::int AS version,
          total_count::int AS total,
          early_bird_count::int AS early,
          night_owl_count::int AS night,
          visitor_number::int AS "visitorNumber"
        FROM public.axora_public_visitor_snapshot_v3($1)
      `, [null]);
      expect(snapshot.rows[0]).toEqual({
        version: 1,
        total: 1,
        early: 1,
        night: 0,
        visitorNumber: null,
      });
    } finally {
      await db.close();
    }
  }, 30_000);

  it("provides an old v2 API surface with legacy arguments ignored for claim state", async () => {
    const db = new PGlite();
    try {
      await applyMigrations(db);

      await db.exec(await readFile(migration093Url, "utf8"));

      const first = await db.query<{
        total: number;
        visitor: number;
        choice: string;
      }>(`
        SELECT
          total_count::int AS total,
          visitor_number::int AS visitor,
          choice
        FROM public.axora_claim_public_visitor(
          $1,$2,$3,$4,$5,$6,$7,$8,$9
        )
      `, [
        hash("a"),
        null,
        null,
        null,
        null,
        "NIGHT_OWL",
        "ms",
        new Date().toISOString(),
        "axora.management",
      ]);
      expect(first.rows[0]).toEqual({ total: 1, visitor: 1, choice: "NIGHT_OWL" });

      const second = await db.query<{
        total: number;
        visitor: number;
        choice: string;
        claimedNew: boolean;
      }>(`
        SELECT
          total_count::int AS total,
          visitor_number::int AS visitor,
          choice,
          claimed_new AS "claimedNew"
        FROM public.axora_claim_public_visitor(
          $1,$2,$3,$4,$5,$6,$7,$8,$9
        )
      `, [
        hash("a"),
        hash("f"),
        hash("0"),
        hash("1"),
        hash("b"),
        "EARLY_BIRD",
        "en",
        new Date().toISOString(),
        "axora.management",
      ]);
      expect(second.rows[0]).toMatchObject({
        total: 1,
        visitor: 1,
        choice: "NIGHT_OWL",
        claimedNew: false,
      });

      const sameNetworkDifferentCookie = await db.query<{
        total: number;
        visitor: number;
        claimedNew: boolean;
      }>(`
        SELECT
          total_count::int AS total,
          visitor_number::int AS visitor,
          claimed_new AS "claimedNew"
        FROM public.axora_claim_public_visitor(
          $1,$2,$3,$4,$5,$6,$7,$8,$9
        )
      `, [
        hash("b"),
        hash("f"),
        hash("c"),
        hash("d"),
        hash("e"),
        "EARLY_BIRD",
        "en",
        new Date().toISOString(),
        "axora.management",
      ]);
      expect(sameNetworkDifferentCookie.rows[0]).toMatchObject({ total: 2, visitor: 2, claimedNew: true });

      const sameCookieConcurrent = await Promise.all([
        db.query<{
          total: number;
          visitor: number;
          claimedNew: boolean;
        }>(`
          SELECT
            total_count::int AS total,
            visitor_number::int AS visitor,
            claimed_new AS "claimedNew"
          FROM public.axora_claim_public_visitor(
            $1,$2,$3,$4,$5,$6,$7,$8,$9
          )`, [
            hash("c"),
            hash("c"),
            hash("a"),
            hash("b"),
            hash("d"),
            "NIGHT_OWL",
            "en",
            new Date().toISOString(),
            "axora.management",
          ]),
        db.query<{
          total: number;
          visitor: number;
          claimedNew: boolean;
        }>(`
          SELECT
            total_count::int AS total,
            visitor_number::int AS visitor,
            claimed_new AS "claimedNew"
          FROM public.axora_claim_public_visitor(
            $1,$2,$3,$4,$5,$6,$7,$8,$9
          )`, [
            hash("c"),
            hash("e"),
            hash("f"),
            hash("a"),
            hash("b"),
            "NIGHT_OWL",
            "en",
            new Date().toISOString(),
            "axora.management",
          ]),
      ]);

      const concurrentTotals = sameCookieConcurrent.map((result) => result.rows[0]?.total);
      const concurrentVisitors = sameCookieConcurrent.map((result) => result.rows[0]?.visitor);
      const concurrentClaimed = sameCookieConcurrent.map((result) => result.rows[0]?.claimedNew);
      expect(new Set(concurrentTotals)).toEqual(new Set([3]));
      expect(new Set(concurrentVisitors)).toEqual(new Set([3]));
      expect(concurrentClaimed.filter(Boolean)).toHaveLength(1);
    } finally {
      await db.close();
    }
  }, 30_000);
});
