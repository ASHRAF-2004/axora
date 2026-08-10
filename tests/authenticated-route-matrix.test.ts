import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import matrix from "../scripts/production/authenticated-route-matrix.json";

function files(root: string, name: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    return entry.isDirectory() ? files(path, name) : entry.name === name ? [path] : [];
  });
}

function applicationRoute(file: string, root: string, suffix: string) {
  return "/" + relative(root, file)
    .split(sep)
    .filter((part) => !part.startsWith("("))
    .join("/")
    .replace(suffix, "")
    .replace(/\/$/, "");
}

describe("authenticated production route matrix", () => {
  it("contains no credentials or personal account identifiers", () => {
    const source = readFileSync(join(
      process.cwd(),
      "scripts/production/authenticated-route-matrix.json",
    ), "utf8");
    expect(source).not.toMatch(/password|cookie|sessionId|@/i);
    expect(matrix.accountLabels).toEqual([
      "OWNER_1", "OWNER_2", "C100_ADMIN", "C101_ADMIN", "C102_ADMIN",
    ]);
  });

  it("covers every authenticated page and route handler derived from src/app", () => {
    const app = join(process.cwd(), "src/app");
    const pageRoutes = files(join(app, "(portal)"), "page.tsx")
      .map((file) => applicationRoute(file, app, "/page.tsx"));
    const handlerRoutes = files(app, "route.ts")
      .map((file) => applicationRoute(file, app, "/route.ts"));
    const representedPages = new Set(matrix.routes.map((entry) => entry.route));
    const representedHandlers = new Set(matrix.apiRoutes.map((entry) => entry.route));
    expect(pageRoutes.filter((route) => !representedPages.has(route))).toEqual([]);
    expect(handlerRoutes.filter((route) => !representedHandlers.has(route))).toEqual([]);
  });

  it("records access, denial, scope, mode, final URL and landmarks for pages", () => {
    expect(matrix.routes.length).toBeGreaterThan(30);
    for (const route of matrix.routes) {
      expect(route).toMatchObject({
        route: expect.stringMatching(/^\//),
        accountRole: expect.any(String),
        companyScope: expect.any(String),
        expectedAccess: expect.any(Array),
        expectedDenial: expect.any(Array),
        mode: expect.any(String),
        apis: expect.any(Array),
        expectedFinalUrl: expect.stringMatching(/^\//),
        landmark: expect.any(String),
      });
    }
  });
});
