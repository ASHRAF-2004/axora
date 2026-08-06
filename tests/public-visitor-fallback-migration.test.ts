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

const migration034Url = new URL(
  "../database/migrations/034_public_visitor_network_fallback.sql",
  import.meta.url,
);
const hash = (character: string) => character.repeat(64);

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

describe("public visitor network-device fallback migration", () => {
  it("upgrades populated append-only Turnstile claims without rewriting them", async () => {
    const db = new PGlite();
    try {
      await applyMigrations(db, {
        through: "033_public_visitor_choice_counter.sql",
      });
      await db.query(`
        SELECT * FROM axora_claim_public_visitor(
          $1,$2,$3,$4,NULL,'EARLY_BIRD','en',now(),'axora.management'
        )
      `, [hash("a"), hash("b"), hash("c"), hash("d")]);

      await expect(db.exec(
        await readFile(migration034Url, "utf8"),
      )).resolves.not.toThrow();

      const preserved = await db.query<{
        visitorNumber: number;
        choice: string;
        method: string;
        hostname: string | null;
        action: string | null;
      }>(`
        SELECT
          visitor_number::int AS "visitorNumber",
          choice,
          verification_method AS method,
          turnstile_hostname AS hostname,
          turnstile_action AS action
        FROM public_visitor_claims
      `);
      expect(preserved.rows[0]).toEqual({
        visitorNumber: 1,
        choice: "EARLY_BIRD",
        method: "TURNSTILE",
        hostname: "axora.management",
        action: "visitor_choice",
      });
    } finally {
      await db.close();
    }
  }, 30_000);

  it("preserves Turnstile claims and records fallback evidence without raw identifiers", async () => {
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

      const alias = await fallbackClaim(db, {
        token: hash("e"),
        network: hash("b"),
        networkDevice: hash("c"),
        clientSignal: hash("f"),
        choice: "NIGHT_OWL",
      });
      expect(alias).toEqual({
        total: 1,
        early: 1,
        night: 0,
        visitorNumber: 1,
        choice: "EARLY_BIRD",
        claimedNew: false,
      });

      const sharedNetworkDifferentDevice = await fallbackClaim(db, {
        token: hash("1"),
        network: hash("b"),
        networkDevice: hash("2"),
        clientSignal: hash("3"),
        choice: "NIGHT_OWL",
      });
      expect(sharedNetworkDifferentDevice).toMatchObject({
        total: 2,
        early: 1,
        night: 1,
        visitorNumber: 2,
        choice: "NIGHT_OWL",
        claimedNew: true,
      });

      const turnstile = await db.query<ClaimResult>(`
        SELECT
          total_count::int AS total,
          early_bird_count::int AS early,
          night_owl_count::int AS night,
          visitor_number::int AS "visitorNumber",
          choice,
          claimed_new AS "claimedNew"
        FROM axora_claim_public_visitor(
          $1,$2,$3,$4,NULL,'EARLY_BIRD','ms',now(),'axora.management'
        )
      `, [hash("4"), hash("5"), hash("6"), hash("7")]);
      expect(turnstile.rows[0]).toMatchObject({
        total: 3,
        early: 2,
        night: 1,
        visitorNumber: 3,
        claimedNew: true,
      });

      const evidence = await db.query<{
        visitorNumber: number;
        method: string;
        challengeAt: Date | null;
        hostname: string | null;
        action: string | null;
      }>(`
        SELECT
          visitor_number::int AS "visitorNumber",
          verification_method AS method,
          turnstile_challenge_at AS "challengeAt",
          turnstile_hostname AS hostname,
          turnstile_action AS action
        FROM public_visitor_claims
        ORDER BY visitor_number
      `);
      expect(evidence.rows).toHaveLength(3);
      expect(evidence.rows[0]).toMatchObject({
        visitorNumber: 1,
        method: "NETWORK_DEVICE_FALLBACK",
        challengeAt: null,
        hostname: null,
        action: null,
      });
      expect(evidence.rows[1]).toMatchObject({
        visitorNumber: 2,
        method: "NETWORK_DEVICE_FALLBACK",
        challengeAt: null,
        hostname: null,
        action: null,
      });
      expect(evidence.rows[2]).toMatchObject({
        visitorNumber: 3,
        method: "TURNSTILE",
        hostname: "axora.management",
        action: "visitor_choice",
      });
      expect(evidence.rows[2]?.challengeAt).not.toBeNull();
    } finally {
      await db.close();
    }
  }, 30_000);

  it("requires complete irreversible fallback fingerprints and keeps claims append-only", async () => {
    const db = new PGlite();
    try {
      await applyMigrations(db);

      await expect(db.query(`
        SELECT * FROM axora_claim_public_visitor_fallback(
          $1,$2,$3,NULL,'EARLY_BIRD','en'
        )
      `, [hash("a"), hash("b"), hash("c")]))
        .rejects.toThrow(/client-signal fingerprint is invalid/i);

      await fallbackClaim(db, {
        token: hash("d"),
        network: hash("e"),
        networkDevice: hash("f"),
        clientSignal: hash("1"),
        choice: "EARLY_BIRD",
      });
      await expect(db.exec(
        "UPDATE public_visitor_claims SET verification_method='TURNSTILE'",
      )).rejects.toThrow(/append-only/i);
      await expect(db.exec(
        "DELETE FROM public_visitor_claims",
      )).rejects.toThrow(/append-only/i);
    } finally {
      await db.close();
    }
  }, 30_000);
});
