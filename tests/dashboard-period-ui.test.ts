import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("P1-15 dashboard period UI", () => {
  it("uses a bookmarkable current-period GET form with export and accessible status", async () => {
    const source = await readFile(
      new URL("../src/components/DashboardPeriodControls.tsx", import.meta.url),
      "utf8",
    );
    expect(source).toContain('method="get"');
    expect(source).toContain('action="/dashboard"');
    expect(source).toContain('name="preset"');
    expect(source).toContain('name="start"');
    expect(source).toContain('name="end"');
    expect(source).not.toContain('name="compare"');
    expect(source).toContain('name="branch"');
    expect(source).toContain('aria-live="polite"');
    expect(source).toContain('role="alert"');
    expect(source).toContain("/api/export/dashboard?");
  });

  it("uses logical responsive styling without adding motion", async () => {
    const css = await readFile(
      new URL("../src/app/globals.css", import.meta.url),
      "utf8",
    );
    const start = css.indexOf(".dashboard-period-panel");
    const end = css.indexOf("@media (max-width: 1250px)", start);
    const styles = css.slice(start, end);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(styles).toContain("border-inline-start");
    expect(styles).toContain("padding-inline");
    expect(styles).toContain("@media (max-width: 560px)");
    expect(styles).not.toMatch(/animation:|transition:/);
  });

  it("refreshes the current route when the recovery boundary retries", async () => {
    const source = await readFile(
      new URL("../src/app/(portal)/error.tsx", import.meta.url),
      "utf8",
    );
    const retryStart = source.indexOf("const retryPage");
    const retry = source.slice(
      retryStart,
      source.indexOf("return (", retryStart),
    );
    expect(source).toContain('import { useRouter } from "next/navigation"');
    expect(source).toContain("onClick={retryPage}");
    expect(retry).toContain("reset();");
    expect(retry).toContain("router.refresh();");
    expect(retry.indexOf("reset();")).toBeLessThan(
      retry.indexOf("router.refresh();"),
    );
  });
});
