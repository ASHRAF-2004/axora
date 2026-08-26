import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith(".tsx") ? [path] : [];
  });
}

describe("authenticated portal main landmark", () => {
  it("leaves the single main landmark to AppShell", () => {
    const portal = join(process.cwd(), "src/app/(portal)");
    const nestedMainSources = sourceFiles(portal)
      .filter((path) => /(?:page|error)\.tsx$/.test(path))
      .filter((path) => /<main(?:\s|>)/.test(readFileSync(path, "utf8")));

    expect(nestedMainSources).toEqual([]);
  });
});
