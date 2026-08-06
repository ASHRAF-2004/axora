import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import { applyMigrations } from "./helpers/pglite";

interface ClaimResult {
  total: number;
  visitorNumber: number;
  choice: string;
  claimedNew: boolean;
}

const hash = (character: string) => character.repeat(64);

async function claim(
  db: PGlite,
  input: {
    token: string;
    networkDevice: string;
    clientSignal: string;
    choice: "EARLY_BIRD" | "NIGHT_OWL";
  },
) {
  const result = await db.query<ClaimResult>(`
    SELECT
      total_count::int AS total,
      visitor_number::int AS "visitorNumber",
      choice,
      claimed_new AS "claimedNew"
    FROM axora_claim_public_visitor_fallback(
      $1,$2,$3,$4,$5,'en'
    )
  `, [
    input.token,
    hash("n"),
    input.networkDevice,
    input.clientSignal,
    input.choice,
  ]);
  return result.rows[0];
}

describe("public visitor network claim concurrency", () => {
  it("serializes simultaneous private-window attempts into one visitor ordinal", async () => {
    const db = new PGlite();
    try {
      await applyMigrations(db);

      const results = await Promise.all([
        claim(db, {
          token: hash("a"),
          networkDevice: hash("b"),
          clientSignal: hash("c"),
          choice: "EARLY_BIRD",
        }),
        claim(db, {
          token: hash("d"),
          networkDevice: hash("e"),
          clientSignal: hash("f"),
          choice: "NIGHT_OWL",
        }),
      ]);

      expect(results).toHaveLength(2);
      expect(results.every((result) => result.total === 1)).toBe(true);
      expect(results.every((result) => result.visitorNumber === 1)).toBe(true);
      expect(results.filter((result) => result.claimedNew)).toHaveLength(1);
      expect(new Set(results.map((result) => result.choice))).toHaveLength(1);

      const state = await db.query<{
        total: number;
        claims: number;
        networks: number;
        aliases: number;
      }>(`
        SELECT
          (SELECT total_count::int
             FROM public_visitor_counter_state
            WHERE singleton=true) AS total,
          (SELECT count(*)::int FROM public_visitor_claims) AS claims,
          (SELECT count(*)::int FROM public_visitor_network_claims)
            AS networks,
          (SELECT count(*)::int FROM public_visitor_claim_tokens) AS aliases
      `);
      expect(state.rows[0]).toEqual({
        total: 1,
        claims: 1,
        networks: 1,
        aliases: 2,
      });
    } finally {
      await db.close();
    }
  }, 30_000);
});
