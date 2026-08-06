import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { applyMigrations } from "./helpers/pglite";

interface ClaimResult {
  total: number;
  early: number;
  night: number;
  visitorNumber: number;
  choice: string;
  claimedNew: boolean;
}

interface SnapshotResult {
  total: number;
  early: number;
  night: number;
  visitorNumber: number | null;
  choice: string | null;
}

const hash = (character: string) => character.repeat(64);
const migration035Url = new URL(
  "../database/migrations/035_public_visitor_network_uniqueness.sql",
  import.meta.url,
);

async function fallbackClaim(
  db: PGlite,
  input: {
    token: string;
    network: string;
    networkDevice: string;
    clientSignal: string;
    choice: "EARLY_BIRD" | "NIGHT_OWL";
  },
) {
  const result = await db.query<ClaimResult>(`
    SELECT
      total_count::int AS total,
      early_bird_count::int AS early,
      night_owl_count::int AS night,
      visitor_number::int AS "visitorNumber",
      choice,
      claimed_new AS "claimedNew"
    FROM axora_claim_public_visitor_fallback(
      $1,$2,$3,$4,$5,'en'
    )
  `, [
    input.token,
    input.network,
    input.networkDevice,
    input.clientSignal,
    input.choice,
  ]);
  return result.rows[0];
}

async function turnstileClaim(
  db: PGlite,
  input: {
    token: string;
    network: string;
    networkDevice: string;
    clientSignal: string;
    turnstileDevice?: string;
    choice: "EARLY_BIRD" | "NIGHT_OWL";
  },
) {
  const result = await db.query<ClaimResult>(`
    SELECT
      total_count::int AS total,
      early_bird_count::int AS early,
      night_owl_count::int AS night,
      visitor_number::int AS "visitorNumber",
      choice,
      claimed_new AS "claimedNew"
    FROM axora_claim_public_visitor(
      $1,$2,$3,$4,$5,$6,'en',now(),'axora.management'
    )
  `, [
    input.token,
    input.network,
    input.networkDevice,
    input.clientSignal,
    input.turnstileDevice ?? null,
    input.choice,
  ]);
  return result.rows[0];
}

async function snapshot(
  db: PGlite,
  input: {
    token?: string;
    network?: string;
    networkDevice?: string;
    turnstileDevice?: string;
  },
) {
  const result = await db.query<SnapshotResult>(`
    SELECT
      total_count::int AS total,
      early_bird_count::int AS early,
      night_owl_count::int AS night,
      visitor_number::int AS "visitorNumber",
      choice
    FROM axora_public_visitor_snapshot_v2($1,$2,$3,$4)
  `, [
    input.token ?? null,
    input.network ?? null,
    input.networkDevice ?? null,
    input.turnstileDevice ?? null,
  ]);
  return result.rows[0];
}

describe("permanent public-network visitor uniqueness", () => {
  it("reuses one claim across normal and private contexts on the same public IP hash", async () => {
    const db = new PGlite();
    try {
      await applyMigrations(db);

      const first = await fallbackClaim(db, {
        token: hash("a"),
        network: hash("b"),
        networkDevice: hash("c"),
        clientSignal: hash("d"),
        choice: "EARLY_BIRD",
      });
      expect(first).toEqual({
        total: 1,
        early: 1,
        night: 0,
        visitorNumber: 1,
        choice: "EARLY_BIRD",
        claimedNew: true,
      });

      const privateWindow = await fallbackClaim(db, {
        token: hash("e"),
        network: hash("b"),
        networkDevice: hash("f"),
        clientSignal: hash("1"),
        choice: "NIGHT_OWL",
      });
      expect(privateWindow).toEqual({
        total: 1,
        early: 1,
        night: 0,
        visitorNumber: 1,
        choice: "EARLY_BIRD",
        claimedNew: false,
      });

      const verifiedPrivateWindow = await turnstileClaim(db, {
        token: hash("2"),
        network: hash("b"),
        networkDevice: hash("3"),
        clientSignal: hash("4"),
        turnstileDevice: hash("5"),
        choice: "NIGHT_OWL",
      });
      expect(verifiedPrivateWindow).toEqual(privateWindow);

      await expect(snapshot(db, {
        network: hash("b"),
        networkDevice: hash("6"),
      })).resolves.toEqual({
        total: 1,
        early: 1,
        night: 0,
        visitorNumber: 1,
        choice: "EARLY_BIRD",
      });

      const otherNetwork = await fallbackClaim(db, {
        token: hash("7"),
        network: hash("8"),
        networkDevice: hash("9"),
        clientSignal: hash("0"),
        choice: "NIGHT_OWL",
      });
      expect(otherNetwork).toEqual({
        total: 2,
        early: 1,
        night: 1,
        visitorNumber: 2,
        choice: "NIGHT_OWL",
        claimedNew: true,
      });

      const aliases = await db.query<{ networks: number; claims: number }>(`
        SELECT
          (SELECT count(*)::int FROM public_visitor_network_claims)
            AS networks,
          (SELECT count(*)::int FROM public_visitor_claims) AS claims
      `);
      expect(aliases.rows[0]).toEqual({ networks: 2, claims: 2 });
    } finally {
      await db.close();
    }
  }, 30_000);

  it("backfills the earliest existing claim as canonical without deleting append-only history", async () => {
    const db = new PGlite();
    try {
      await applyMigrations(db, {
        through: "034_public_visitor_network_fallback.sql",
      });

      const first = await fallbackClaim(db, {
        token: hash("a"),
        network: hash("b"),
        networkDevice: hash("c"),
        clientSignal: hash("d"),
        choice: "EARLY_BIRD",
      });
      const duplicateBeforeFix = await fallbackClaim(db, {
        token: hash("e"),
        network: hash("b"),
        networkDevice: hash("f"),
        clientSignal: hash("1"),
        choice: "NIGHT_OWL",
      });
      expect(first.visitorNumber).toBe(1);
      expect(duplicateBeforeFix).toMatchObject({
        total: 2,
        visitorNumber: 2,
        choice: "NIGHT_OWL",
        claimedNew: true,
      });

      await db.exec(await readFile(migration035Url, "utf8"));

      const afterFix = await fallbackClaim(db, {
        token: hash("2"),
        network: hash("b"),
        networkDevice: hash("3"),
        clientSignal: hash("4"),
        choice: "NIGHT_OWL",
      });
      expect(afterFix).toEqual({
        total: 2,
        early: 1,
        night: 1,
        visitorNumber: 1,
        choice: "EARLY_BIRD",
        claimedNew: false,
      });

      const canonical = await db.query<{
        visitorNumber: number;
        networkRows: number;
        preservedClaims: number;
      }>(`
        SELECT
          claim.visitor_number::int AS "visitorNumber",
          (SELECT count(*)::int FROM public_visitor_network_claims)
            AS "networkRows",
          (SELECT count(*)::int FROM public_visitor_claims)
            AS "preservedClaims"
        FROM public_visitor_network_claims network
        JOIN public_visitor_claims claim ON claim.id=network.claim_id
        WHERE network.network_hash=$1
      `, [hash("b")]);
      expect(canonical.rows[0]).toEqual({
        visitorNumber: 1,
        networkRows: 1,
        preservedClaims: 2,
      });
    } finally {
      await db.close();
    }
  }, 30_000);

  it("keeps raw network data inaccessible and grants only narrow functions", async () => {
    const db = new PGlite();
    try {
      await applyMigrations(db);
      const boundary = await db.query<{
        appSnapshot: boolean;
        appTurnstileClaim: boolean;
        appFallbackClaim: boolean;
        appTableSelect: boolean;
        publicSnapshot: boolean;
        triggerCount: number;
      }>(`
        SELECT
          has_function_privilege(
            'axora_app',
            'axora_public_visitor_snapshot_v2(text,text,text,text)',
            'EXECUTE'
          ) AS "appSnapshot",
          has_function_privilege(
            'axora_app',
            'axora_claim_public_visitor(text,text,text,text,text,text,text,timestamptz,text)',
            'EXECUTE'
          ) AS "appTurnstileClaim",
          has_function_privilege(
            'axora_app',
            'axora_claim_public_visitor_fallback(text,text,text,text,text,text)',
            'EXECUTE'
          ) AS "appFallbackClaim",
          has_table_privilege(
            'axora_app','public_visitor_network_claims','SELECT'
          ) AS "appTableSelect",
          has_function_privilege(
            'public',
            'axora_public_visitor_snapshot_v2(text,text,text,text)',
            'EXECUTE'
          ) AS "publicSnapshot",
          (SELECT count(*)::int FROM pg_trigger
           WHERE tgname='reject_public_visitor_network_claim_update'
             AND NOT tgisinternal) AS "triggerCount"
      `);
      expect(boundary.rows[0]).toEqual({
        appSnapshot: true,
        appTurnstileClaim: true,
        appFallbackClaim: true,
        appTableSelect: false,
        publicSnapshot: false,
        triggerCount: 1,
      });
    } finally {
      await db.close();
    }
  }, 30_000);
});
