import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  new URL("../database/migrations/022_authentication_rate_limits.sql", import.meta.url),
  "utf8",
);

describe("authentication rate-limit migration", () => {
  it("adds LOGIN without storing raw identifiers", () => {
    expect(sql).toContain("'LOGIN'");
    expect(sql).toContain("public_request_rate_buckets");
    expect(sql).not.toMatch(/ip_address|email_address/i);
  });
});
