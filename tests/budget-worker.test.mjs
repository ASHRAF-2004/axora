import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("budget refresh worker", () => {
  it("uses the leased database queue and bounded retry capabilities", async () => {
    const worker = await readFile(
      new URL("../server-tools/budget-worker.mjs", import.meta.url),
      "utf8",
    );

    expect(worker).toContain("axora_reconcile_budget_refresh_jobs");
    expect(worker).toContain("axora_claim_budget_refresh_jobs");
    expect(worker).toContain("axora_process_budget_refresh_job");
    expect(worker).toMatch(/SIGTERM|AbortSignal/);
    expect(worker).not.toMatch(/password\s*=\s*["'][^"']+["']/i);
  });
});
