import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import { applyMigrations } from "./helpers/pglite";

interface SnapshotRow {
  total: number;
  early: number;
  night: number;
  visitorNumber: number | null;
  choice: string | null;
  claimedNew?: boolean;
}

const hash = (character: string) => character.repeat(64);

async function snapshot(
  db: PGlite,
  tokenHash: string | null,
  networkDeviceHash: string | null,
  turnstileDeviceHash: string | null,
) {
  const result = await db.query<SnapshotRow>(
    `SELECT
       total_count::int AS total,
       early_bird_count::int AS early,
       night_owl_count::int AS night,
       visitor_number::int AS "visitorNumber",
       choice
     FROM axora_public_visitor_snapshot($1,$2,$3)`,
    [tokenHash, networkDeviceHash, turnstileDeviceHash],
  );
  return result.rows[0];
}

async function claim(
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
  const result = await db.query<SnapshotRow>(
    `SELECT
       total_count::int AS total,
       early_bird_count::int AS early,
       night_owl_count::int AS night,
       visitor_number::int AS "visitorNumber",
       choice,
       claimed_new AS "claimedNew"
     FROM axora_claim_public_visitor(
       $1,$2,$3,$4,$5,$6,'en',now(),'axora.management'
     )`,
    [
      input.token,
      input.network,
      input.networkDevice,
      input.clientSignal,
      input.turnstileDevice ?? null,
      input.choice,
    ],
  );
  return result.rows[0];
}

describe("public visitor choice counter migration", () => {
  it("creates gap-free claims keyed by each signed anonymous cookie", async () => {
    const db = new PGlite();
    try {
      await applyMigrations(db);

      await expect(db.query(
        `INSERT INTO public_request_rate_buckets(
           action_key,scope_kind,scope_hash,bucket_started_at
         ) VALUES (
           'VISITOR_CHOICE','NETWORK',$1,date_trunc('hour',now())
         )`,
        [hash("0")],
      )).resolves.not.toThrow();

      await expect(
        snapshot(db, null, null, null),
      ).resolves.toEqual({
        total: 0,
        early: 0,
        night: 0,
        visitorNumber: null,
        choice: null,
      });

      const first = await claim(db, {
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

      const repeatedFromAnotherBrowser = await claim(db, {
        token: hash("e"),
        network: hash("b"),
        networkDevice: hash("c"),
        clientSignal: hash("f"),
        choice: "NIGHT_OWL",
      });
      expect(repeatedFromAnotherBrowser).toEqual({
        total: 2,
        early: 1,
        night: 1,
        visitorNumber: 2,
        choice: "NIGHT_OWL",
        claimedNew: true,
      });

      await expect(
        snapshot(db, hash("e"), null, null),
      ).resolves.toEqual({
        total: 2,
        early: 1,
        night: 1,
        visitorNumber: 2,
        choice: "NIGHT_OWL",
      });

      const second = await claim(db, {
        token: hash("1"),
        network: hash("2"),
        networkDevice: hash("3"),
        clientSignal: hash("4"),
        turnstileDevice: hash("5"),
        choice: "NIGHT_OWL",
      });
      expect(second).toEqual({
        total: 3,
        early: 1,
        night: 2,
        visitorNumber: 3,
        choice: "NIGHT_OWL",
        claimedNew: true,
      });

      const state = await db.query<{
        total: number;
        claims: number;
        aliases: number;
      }>(`
        SELECT
          (SELECT total_count::int
             FROM public_visitor_counter_state
            WHERE singleton=true) AS total,
          (SELECT count(*)::int FROM public_visitor_claims) AS claims,
          (SELECT count(*)::int FROM public_visitor_claim_tokens) AS aliases
      `);
      expect(state.rows[0]).toEqual({
        total: 3,
        claims: 3,
        aliases: 3,
      });
    } finally {
      await db.close();
    }
  }, 30_000);

  it("keeps claims append-only and rejects malformed fingerprints", async () => {
    const db = new PGlite();
    try {
      await applyMigrations(db);
      await claim(db, {
        token: hash("a"),
        network: hash("b"),
        networkDevice: hash("c"),
        clientSignal: hash("d"),
        choice: "EARLY_BIRD",
      });

      await expect(db.exec(
        "UPDATE public_visitor_claims SET choice='NIGHT_OWL'",
      )).rejects.toThrow(/append-only/i);
      await expect(db.exec(
        "DELETE FROM public_visitor_claims",
      )).rejects.toThrow(/append-only/i);
      await expect(db.query(
        `SELECT * FROM axora_claim_public_visitor(
           $1,$2,$3,$4,NULL,'EARLY_BIRD','en',now(),'axora.management'
         )`,
        ["not-a-hash", hash("b"), hash("c"), hash("d")],
      )).rejects.toThrow(/fingerprint is invalid/i);
    } finally {
      await db.close();
    }
  }, 30_000);
});
