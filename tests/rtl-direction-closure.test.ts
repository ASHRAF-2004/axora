import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("P0-12 global RTL and mixed-direction closure", () => {
  it("uses global logical direction rules and honors reduced motion", async () => {
    const css = await readFile(new URL("../src/app/globals.css", import.meta.url), "utf8");
    expect(css).toContain("unicode-bidi: isolate");
    expect(css).toContain("input[type=\"email\"]");
    expect(css).toContain(".lucide-arrow-right");
    expect(css).toContain("transform: scaleX(-1)");
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).toContain("padding-inline");
  });

  it("isolates user identities, request IDs, metrics and audit identifiers", async () => {
    const [shell, dashboard, metric, audit] = await Promise.all([
      readFile(new URL("../src/components/app-shell/AppShell.tsx", import.meta.url), "utf8"),
      readFile(new URL("../src/app/(portal)/dashboard/page.tsx", import.meta.url), "utf8"),
      readFile(new URL("../src/components/MetricCard.tsx", import.meta.url), "utf8"),
      readFile(new URL("../src/app/(portal)/audit/page.tsx", import.meta.url), "utf8"),
    ]);
    expect(shell).toContain('className="bidi-ltr" dir="ltr"');
    expect(dashboard).toContain('<bdi className="bidi-ltr" dir="ltr">{request.orderCode}</bdi>');
    expect(metric).toContain('<bdi dir="auto">{value}</bdi>');
    expect(audit).toContain('className="subtle bidi-ltr" dir="ltr"');
  });

  it("uses a logical offscreen position for the login trap field", async () => {
    const css = await readFile(new URL("../src/components/LoginForm.module.css", import.meta.url), "utf8");
    expect(css).toContain("inset-inline-start: -10000px");
    expect(css).not.toContain("left: -10000px");
  });
});
