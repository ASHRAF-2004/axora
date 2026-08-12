import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Resend provider migration", () => {
  it("adds one narrow write capability without broad runtime table grants", async () => {
    const migration = await readFile(new URL(
      "../database/migrations/075_resend_transactional_email.sql",
      import.meta.url,
    ), "utf8");
    expect(migration).toContain("axora_record_resend_email_event");
    expect(migration).toContain("'RESEND'");
    expect(migration).toContain("MESSAGE_SUPPRESSED");
    expect(migration).toContain("provider_suppression_count");
    expect(migration).toContain("FROM axora_app");
    expect(migration).not.toMatch(/GRANT\s+(SELECT|INSERT|UPDATE|DELETE)\s+ON\s+(TABLE\s+)?public\.email_/i);
    expect(migration).not.toMatch(/DISABLE\s+ROW\s+LEVEL\s+SECURITY/i);
  });
});
