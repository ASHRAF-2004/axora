import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import { applyMigrations } from "./helpers/pglite";

const retiredProvider = ["zep", "to", "mail"].join("");
const retiredRecorder = `public.axora_record_${retiredProvider}_email_event(uuid,text,text,text,text,boolean,timestamptz,integer)`;
const cloudflareRecorder = "public.axora_record_cloudflare_email_event(uuid,text,text,text,text,boolean,timestamptz,integer)";
const resendRecorder = "public.axora_record_resend_email_event(uuid,text,text,text,text,boolean,timestamptz,integer)";
const genericRecorder = "public.axora_record_email_provider_event(text,uuid,text,text,text,text,boolean,timestamptz,integer)";

describe("current outbound provider database contract", () => {
  it("retains historical functions but exposes only the Resend event capability to axora_app", async () => {
    const db = new PGlite();
    try {
      await db.exec("CREATE ROLE axora_app NOLOGIN");
      const applied = await applyMigrations(db);
      expect(applied).toContain("100_role_scoped_user_creation_resend_consolidation.sql");
      expect(applied.at(-1)).toBe("101_existing_user_access_management.sql");

      const privileges = await db.query<{
        resend: boolean;
        retired: boolean;
        cloudflare: boolean;
        generic: boolean;
      }>(`
        SELECT
          has_function_privilege('axora_app',$1,'EXECUTE') AS resend,
          has_function_privilege('axora_app',$2,'EXECUTE') AS retired,
          has_function_privilege('axora_app',$3,'EXECUTE') AS cloudflare,
          has_function_privilege('axora_app',$4,'EXECUTE') AS generic
      `, [resendRecorder, retiredRecorder, cloudflareRecorder, genericRecorder]);
      expect(privileges.rows[0]).toEqual({
        resend: true,
        retired: false,
        cloudflare: false,
        generic: false,
      });
    } finally {
      await db.close();
    }
  }, 45_000);

  it("accepts only Resend for new webhook-health writes while preserving historical schema rows", async () => {
    const db = new PGlite();
    try {
      await applyMigrations(db);
      await expect(db.query(
        "SELECT axora_record_email_webhook_failure('resend','processing_failed')",
      )).resolves.not.toThrow();
      await expect(db.query(
        "SELECT axora_record_email_webhook_failure($1,'processing_failed')",
        [retiredProvider],
      )).rejects.toThrow(/invalid/i);
      await expect(db.query(
        "SELECT axora_record_email_webhook_failure('cloudflare-email-service','processing_failed')",
      )).rejects.toThrow(/invalid/i);
    } finally {
      await db.close();
    }
  }, 45_000);
});
