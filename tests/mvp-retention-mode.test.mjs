import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

import { assertRetentionMode, MVP_RETENTION_MODE } from "../scripts/production/check-retention-mode.mjs";

describe("controlled MVP retention readiness", () => {
  it("accepts only the explicit conservative pilot mode", () => {
    expect(assertRetentionMode({ AXORA_RETENTION_MODE: MVP_RETENTION_MODE })).toBe("mvp-conservative");
    expect(() => assertRetentionMode({})).toThrow(/mvp-conservative/);
    expect(() => assertRetentionMode({ AXORA_RETENTION_MODE: "purge" })).toThrow(/mvp-conservative/);
  });

  it("documents the temporary three-company decision without claiming GA compliance", async () => {
    const policy = await readFile(new URL("../docs/mvp-data-retention-policy.md", import.meta.url), "utf8");
    expect(policy).toContain("three customer companies");
    expect(policy).toContain("2026-08-16");
    expect(policy).toContain("No automatic purge");
    expect(policy).toMatch(/not a representation of complete statutory or regulatory\s+compliance/);
  });
});
