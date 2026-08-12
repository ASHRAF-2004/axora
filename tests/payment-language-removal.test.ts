import { readFile, readdir } from "node:fs/promises";
import { extname, join } from "node:path";
import { describe, expect, it } from "vitest";

const textExtensions = new Set([
  ".css", ".example", ".html", ".js", ".json", ".md", ".mjs", ".sh",
  ".sql", ".ts", ".tsx", ".yaml", ".yml",
]);
const excluded = new Set([
  ".git", ".next", "database/migrations", "node_modules", "output", "public",
  "tests",
]);

async function supportedProductFiles(directory = "."): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(directory, entry.name).replace(/^\.\//, "");
    if (entry.isDirectory()) {
      if (!excluded.has(path) && !excluded.has(entry.name)) {
        files.push(...await supportedProductFiles(path));
      }
    } else if (textExtensions.has(extname(entry.name))) {
      files.push(path);
    }
  }
  return files;
}

describe("customer payment language", () => {
  it("contains no supported legacy delivery-payment identifiers or copy", async () => {
    const files = await supportedProductFiles();
    const violations: string[] = [];
    const legacy = /\bcash[\s_-]*on[\s_-]*delivery\b|\bMVP_COD\b|\bCOD_PAYMENT_METHOD\b|["']COD["']|cod-evidence|payment payments|non-payment payments|status payment|الدفع\s+عند\s+الاستلام|دفعة\s+عند\s+الاستلام|مدفوعات\s+الاستلام|(?:bayaran|tunai).{0,40}(?:semasa|ketika)\s+penghantaran/i;
    for (const file of files) {
      if (file !== "README.md" && legacy.test(await readFile(file, "utf8"))) violations.push(file);
    }
    expect(violations).toEqual([]);
  });

  it("shows Pay without exposing the internal strategy in checkout artifacts", async () => {
    const paths = [
      "src/app/(portal)/requests/[id]/page.tsx",
      "src/lib/request-detail-i18n.ts",
      "server-tools/email-template-catalogue.mjs",
      "server-tools/document-renderer.mjs",
    ];
    const source = (await Promise.all(paths.map((path) => readFile(path, "utf8")))).join("\n");
    expect(source).toMatch(/\bPay\b/);
    expect(source).not.toMatch(/payment method|offline payment|manual payment|TEST_OFFLINE|["']OFFLINE["']/i);
  });

  it("documents removal as history rather than an active payment flow", async () => {
    const documentation = await readFile("README.md", "utf8");
    expect(documentation).toMatch(/does not use cash on delivery/i);
    expect(documentation).not.toMatch(/pay on delivery|payment due at delivery/i);
  });
});
