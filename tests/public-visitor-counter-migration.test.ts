import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import { applyMigrations } from "./helpers/pglite";

interface SnapshotRow {
  version: number;
  total: number;
  early: number;
  night: number;
  visitorNumber: number | null;
  choice: string | null;
  claimedNew?: boolean;
}

const hash = (character: string) => character.repeat(64);

async function snapshot(db: PGlite, tokenHash: string | null) {
  const result = await db.query<SnapshotRow>(
    `SELECT
       snapshot_version::int AS version,
       total_count::int AS total,
       early_bird_count::int AS early,
       night_owl_count::int AS night,
       visitor_number::int AS "visitorNumber",
       choice
     FROM axora_public_visitor_snapshot_v3($1)`,
    [tokenHash],
  );
  return result.rows[0];
}

async function claim(
  db: PGlite,
  token: string,
  choice: "EARLY_BIRD" | "NIGHT_OWL",
) {
  const result = await db.query<SnapshotRow>(
    `SELECT
       snapshot_version::int AS version,
       total_count::int AS total,
       early_bird_count::int AS early,
       night_owl_count::int AS night,
       visitor_number::int AS "visitorNumber",
       choice,
       claimed_new AS "claimedNew"
     FROM axora_claim_public_visitor_v3($1,$2,'en',now(),'axora.management')`,
    [token, choice],
  );
  return result.rows[0];
}

describe("public visitor cookie-only migration", () => {
  it("creates gap-free independent claims and idempotently replays one cookie", async () => {
    const db = new PGlite();
    try {
      await applyMigrations(db);
      await expect(snapshot(db, null)).resolves.toEqual({
        version: 0,
        total: 0,
        early: 0,
        night: 0,
        visitorNumber: null,
        choice: null,
      });

      await expect(claim(db, hash("a"), "EARLY_BIRD")).resolves.toEqual({
        version: 1,
        total: 1,
        early: 1,
        night: 0,
        visitorNumber: 1,
        choice: "EARLY_BIRD",
        claimedNew: true,
      });
      await expect(claim(db, hash("b"), "NIGHT_OWL")).resolves.toEqual({
        version: 2,
        total: 2,
        early: 1,
        night: 1,
        visitorNumber: 2,
        choice: "NIGHT_OWL",
        claimedNew: true,
      });
      await expect(claim(db, hash("b"), "EARLY_BIRD")).resolves.toEqual({
        version: 2,
        total: 2,
        early: 1,
        night: 1,
        visitorNumber: 2,
        choice: "NIGHT_OWL",
        claimedNew: false,
      });
      await expect(snapshot(db, hash("b"))).resolves.toEqual({
        version: 2,
        total: 2,
        early: 1,
        night: 1,
        visitorNumber: 2,
        choice: "NIGHT_OWL",
      });
    } finally {
      await db.close();
    }
  }, 30_000);

  it("keeps claims append-only and rejects malformed cookie fingerprints", async () => {
    const db = new PGlite();
    try {
      await applyMigrations(db);
      await claim(db, hash("a"), "EARLY_BIRD");
      await expect(db.exec("UPDATE public_visitor_claims SET choice='NIGHT_OWL'"))
        .rejects.toThrow(/append-only/i);
      await expect(db.exec("DELETE FROM public_visitor_claims"))
        .rejects.toThrow(/append-only/i);
      await expect(db.query(
        "SELECT * FROM axora_claim_public_visitor_v3($1,'EARLY_BIRD','en',now(),'axora.management')",
        ["not-a-hash"],
      )).rejects.toThrow(/token fingerprint is invalid/i);
    } finally {
      await db.close();
    }
  }, 30_000);
});
