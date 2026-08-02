import { PGlite } from "@electric-sql/pglite";
import { access, readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrations } from "./helpers/pglite";

const migrationUrl = new URL(
  "../database/migrations/015_remove_trusted_interactions.sql",
  import.meta.url,
);
const historicalRecordId = "15000000-0000-4000-8000-000000000001";

const retiredRuntimePaths = [
  "../src/app/(portal)/settings/interactions/page.tsx",
  "../src/app/(portal)/settings/interactions/actions.ts",
  "../src/components/interactions/TrustedInteractionRenderer.tsx",
  "../src/components/interactions/InteractionEditor.tsx",
  "../src/components/interactions/AxoraBuddy.tsx",
  "../src/lib/interactions/index.ts",
  "../public/interactions/axora-buddy-static.svg",
] as const;

const activeAccessSurfaces = [
  "../src/lib/permissions.ts",
  "../src/lib/portal-navigation.ts",
  "../src/components/app-shell/AppShell.tsx",
  "../src/app/(portal)/settings/page.tsx",
] as const;

describe("rejected feature cleanup migration", () => {
  let db: PGlite;

  beforeAll(async () => {
    db = new PGlite();
    await applyMigrations(db, { through: "014_account_setup_invitations.sql" });
    await db.query(
      `INSERT INTO audit_logs(entity_type,record_id,action,reason)
       VALUES ('company_interaction_profiles',$1,'UPDATE','Historical feature decision')`,
      [historicalRecordId],
    );
    await db.exec(await readFile(migrationUrl, "utf8"));
    // The cleanup must be safe for recovered or partially replayed databases.
    await db.exec(await readFile(migrationUrl, "utf8"));
  }, 30_000);

  afterAll(async () => {
    await db.close();
  });

  it("drops only the rejected feature schema and preserves general audit history", async () => {
    const objects = await db.query<{
      profiles: string | null;
      revisions: string | null;
      assets: string | null;
      protection_function: string | null;
      feature_audit_function: string | null;
      audit_logs: string | null;
      general_audit_function: string | null;
      invitations: string | null;
    }>(`
      SELECT
        to_regclass('public.company_interaction_profiles')::text AS profiles,
        to_regclass('public.interaction_revisions')::text AS revisions,
        to_regclass('public.interaction_assets')::text AS assets,
        to_regprocedure('public.protect_interaction_revision()')::text AS protection_function,
        to_regprocedure('public.audit_company_interaction_change()')::text AS feature_audit_function,
        to_regclass('public.audit_logs')::text AS audit_logs,
        to_regprocedure('public.audit_change()')::text AS general_audit_function,
        to_regclass('public.account_setup_invitations')::text AS invitations
    `);
    const history = await db.query<{
      entity_type: string;
      reason: string;
    }>(
      `SELECT entity_type,reason FROM audit_logs WHERE record_id=$1`,
      [historicalRecordId],
    );

    expect(objects.rows[0]).toEqual({
      profiles: null,
      revisions: null,
      assets: null,
      protection_function: null,
      feature_audit_function: null,
      audit_logs: "audit_logs",
      general_audit_function: "audit_change()",
      invitations: "account_setup_invitations",
    });
    expect(history.rows).toEqual([
      {
        entity_type: "company_interaction_profiles",
        reason: "Historical feature decision",
      },
    ]);
  });

  it("keeps the rejected feature out of runtime routes, access control, and assets", async () => {
    for (const retiredPath of retiredRuntimePaths) {
      await expect(access(new URL(retiredPath, import.meta.url))).rejects.toThrow();
    }

    const accessSource = (
      await Promise.all(
        activeAccessSurfaces.map((path) => readFile(new URL(path, import.meta.url), "utf8")),
      )
    ).join("\n");

    expect(accessSource).not.toMatch(
      /company_interaction|trusted_interaction|interactive_experience|AxoraBuddy|settings\/interactions/i,
    );
  });
});
