import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const sourceRoot = path.resolve(process.cwd(), "src");

async function sourceFiles() {
  const entries = await readdir(sourceRoot, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && /\.tsx?$/.test(entry.name))
    .map((entry) => path.join(entry.parentPath, entry.name));
}

function repositoryPath(file: string) {
  return path.relative(process.cwd(), file).split(path.sep).join("/");
}

describe("pre-onboarding route allowlist", () => {
  it("keeps the incomplete-session accessor on an explicit narrow allowlist", async () => {
    const imports: string[] = [];
    for (const file of await sourceFiles()) {
      if (file.endsWith("/lib/auth.ts")) continue;
      const source = await readFile(file, "utf8");
      if (/\b(?:get|require)AccountLifecycleSession\b/.test(source)) {
        imports.push(repositoryPath(file));
      }
    }

    expect(imports.sort()).toEqual([
      "src/app/(portal)/account/actions.ts",
      "src/app/(portal)/account/page.tsx",
      "src/app/(portal)/help/actions.ts",
      "src/app/(portal)/help/page.tsx",
      "src/app/(portal)/layout.tsx",
      "src/app/(portal)/profile/actions.ts",
      "src/app/(portal)/profile/language-action.ts",
      "src/app/(portal)/profile/page.tsx",
      "src/app/[locale]/page.tsx",
      "src/app/api/company-brand/[companyId]/logo/route.ts",
      "src/app/api/profile/avatar/route.ts",
      "src/app/api/public/visitor-choice/route.ts",
      "src/app/api/public/visitor-choice/stream/route.ts",
      "src/app/login/page.tsx",
    ]);
  });

  it("keeps every procurement and operational API on the fully-onboarded session accessor", async () => {
    const protectedApiRoutes = [
      "src/app/api/attachments/[id]/route.ts",
      "src/app/api/catalog/cart/route.ts",
      "src/app/api/catalog/route.ts",
      "src/app/api/driver/events/route.ts",
      "src/app/api/driver/evidence/route.ts",
      "src/app/api/export/requests/route.ts",
      "src/app/api/products/[id]/image/route.ts",
      "src/app/api/products/[id]/images/[imageId]/route.ts",
      "src/app/api/products/[id]/images/route.ts",
    ];

    for (const route of protectedApiRoutes) {
      const source = await readFile(path.resolve(process.cwd(), route), "utf8");
      expect(source, route).toMatch(/\bgetSession\(\)/);
      expect(source, route).not.toMatch(/AccountLifecycleSession/);
    }
  });

  it("keeps ordinary portal actions on the gated authorization primitives", async () => {
    const allowed = new Set([
      "src/app/(portal)/account/actions.ts",
      "src/app/(portal)/help/actions.ts",
      "src/app/(portal)/profile/actions.ts",
    ]);
    const actionFiles = (await sourceFiles())
      .map(repositoryPath)
      .filter((file) => file.startsWith("src/app/(portal)/") && file.endsWith("/actions.ts"));

    for (const file of actionFiles) {
      if (allowed.has(file)) continue;
      const source = await readFile(path.resolve(process.cwd(), file), "utf8");
      expect(source, file).toMatch(/\brequire(?:Session|Permission|Role)\(/);
      expect(source, file).not.toMatch(/AccountLifecycleSession/);
    }
  });
});
