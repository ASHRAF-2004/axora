import { createHash } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { applyMigrations } from "./helpers/pglite";

const migration = new URL(
  "../database/migrations/123_public_contact_enquiry_contract.sql",
  import.meta.url,
);
const digest = (value: string) => createHash("sha256").update(value).digest("hex");

function oldPayload(at: Date) {
  return {
    idempotencyKey: digest("historical-contact"), locale: "en",
    contactName: "Historical Contact", companyName: "Historical Company",
    companyLegalName: "Historical Company Sdn Bhd", city: "Cyberjaya",
    industry: "Business services", employeeRange: "11_50", branchRange: "2_5",
    spendRange: "UNDISCLOSED", contactMethod: "EMAIL",
    contactTimezone: "Asia/Kuala_Lumpur", subject: "Historical enquiry",
    message: "A historical lead-shaped enquiry that must remain unchanged.",
    privacyPolicyVersion: "public-enquiry-2026-08-08", sourcePage: "/en/contact",
    sourceMetadata: {}, networkRateKey: digest("old-network"),
    senderRateKey: digest("old-sender"), turnstileChallengeAt: at.toISOString(),
    turnstileHostname: "axora.management",
  };
}

function newPayload(at: Date, idempotency = "new-contact") {
  return {
    idempotencyKey: digest(idempotency), locale: "en",
    fullName: "Aisha Rahman", email: "aisha@example.test",
    phone: "+60123456789",
    message: "Please help us understand how Axora supports procurement workflows.",
    privacyPolicyVersion: "privacy-policy-2026-08-28", sourcePage: "/en/contact",
    sourceMetadata: { source: "website" }, networkRateKey: digest("new-network"),
    senderRateKey: digest("aisha@example.test"), turnstileChallengeAt: at.toISOString(),
    turnstileHostname: "axora.management",
  };
}

describe("public Contact enquiry database contract", () => {
  it("preserves historical submissions and stores no fabricated lead values for new enquiries", async () => {
    const db = new PGlite();
    try {
      await applyMigrations(db, { through: "122_cam_commercial_confidentiality_ceiling.sql" });
      const at = new Date();
      await db.query(
        "SELECT public.axora_record_public_contact_submission($1::jsonb,$2)",
        [oldPayload(at), at],
      );
      await db.exec(await readFile(migration, "utf8"));
      const first = await db.query<{ snapshot: { created: boolean; submissionId: string } }>(
        "SELECT public.axora_record_public_contact_submission($1::jsonb,$2) AS snapshot",
        [newPayload(at), at],
      );
      const replay = await db.query<{ snapshot: { created: boolean; submissionId: string } }>(
        "SELECT public.axora_record_public_contact_submission($1::jsonb,$2) AS snapshot",
        [newPayload(at), at],
      );
      expect(first.rows[0]?.snapshot.created).toBe(true);
      expect(replay.rows[0]?.snapshot).toEqual({
        created: false,
        submissionId: first.rows[0]?.snapshot.submissionId,
      });

      const rows = await db.query<{
        contactName: string; contactEmail: string | null; phone: string | null;
        companyName: string | null; legalName: string | null; city: string | null;
        industry: string | null; employeeRange: string | null; subject: string | null;
      }>(`SELECT contact_name AS "contactName",contact_email AS "contactEmail",phone,
        company_name AS "companyName",company_legal_name AS "legalName",city,industry,
        employee_count_range AS "employeeRange",subject
        FROM public_contact_submissions ORDER BY created_at,id`);
      expect(rows.rows).toHaveLength(2);
      const historical = rows.rows.find((row) => row.contactName === "Historical Contact");
      const enquiry = rows.rows.find((row) => row.contactName === "Aisha Rahman");
      expect(historical).toMatchObject({
        contactName: "Historical Contact", companyName: "Historical Company",
        legalName: "Historical Company Sdn Bhd", city: "Cyberjaya",
        industry: "Business services", employeeRange: "11_50",
        subject: "Historical enquiry",
      });
      expect(enquiry).toEqual({
        contactName: "Aisha Rahman", contactEmail: "aisha@example.test",
        phone: "+60123456789", companyName: null, legalName: null, city: null,
        industry: null, employeeRange: null, subject: null,
      });
    } finally {
      await db.close();
    }
  }, 30_000);

  it("fails closed for missing or invalid visitor-supplied identity fields", async () => {
    const db = new PGlite();
    try {
      await applyMigrations(db);
      const at = new Date();
      for (const payload of [
        { ...newPayload(at, "missing-name"), fullName: "" },
        { ...newPayload(at, "missing-email"), email: undefined },
        { ...newPayload(at, "invalid-email"), email: "not-an-email" },
        { ...newPayload(at, "missing-phone"), phone: undefined },
        { ...newPayload(at, "invalid-phone"), phone: "+60 +60 123" },
      ]) {
        await expect(db.query(
          "SELECT public.axora_record_public_contact_submission($1::jsonb,$2)",
          [payload, at],
        )).rejects.toThrow(/invalid/i);
      }
    } finally {
      await db.close();
    }
  }, 30_000);
});
