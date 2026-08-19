import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  RETIRED_PROVIDER_TOKEN,
  enumerateSourceTreeFiles,
  findRetiredProviderMatches,
  findUnexpectedRetiredProviderReferences,
  readUtf8TextFileIfSafe,
} from "./helpers/retired-provider-search.mjs";

const temporaryRoots = [];

function fixtureRoot(prefix = "axora-exported-tree-") {
  const root = mkdtempSync(join(tmpdir(), prefix));
  temporaryRoots.push(root);
  return root;
}

function writeFixture(root, relativePath, contents) {
  const target = join(root, ...relativePath.split("/"));
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, contents);
  return target;
}

afterEach(() => {
  while (temporaryRoots.length) {
    rmSync(temporaryRoots.pop(), { recursive: true, force: true });
  }
});

describe("deployment-safe retired-provider source-tree search", () => {
  it("scans an exported source tree with no .git directory", () => {
    const root = fixtureRoot();
    writeFixture(root, "src/current.mjs", "export const provider = 'resend';\n");
    expect(existsSync(join(root, ".git"))).toBe(false);
    expect(enumerateSourceTreeFiles(root)).toEqual(["src/current.mjs"]);
    expect(findUnexpectedRetiredProviderReferences(root)).toEqual([]);
  });

  it("allows historical migration evidence", () => {
    const root = fixtureRoot();
    writeFixture(
      root,
      "database/migrations/075_fixture.sql",
      `provider=${RETIRED_PROVIDER_TOKEN}`,
    );
    expect(findRetiredProviderMatches(root)).toEqual([
      "database/migrations/075_fixture.sql",
    ]);
    expect(findUnexpectedRetiredProviderReferences(root)).toEqual([]);
  });

  it("allows the current grant-reapplication compatibility path", () => {
    const root = fixtureRoot();
    writeFixture(
      root,
      "database/admin/apply-app-grants.sql",
      `retired-provider=${RETIRED_PROVIDER_TOKEN}`,
    );
    expect(findRetiredProviderMatches(root)).toEqual([
      "database/admin/apply-app-grants.sql",
    ]);
    expect(findUnexpectedRetiredProviderReferences(root)).toEqual([]);
  });

  it("detects a forbidden active source reference", () => {
    const root = fixtureRoot();
    writeFixture(
      root,
      "src/email/runtime-provider.mjs",
      `provider=${RETIRED_PROVIDER_TOKEN}`,
    );
    expect(findUnexpectedRetiredProviderReferences(root)).toEqual([
      "src/email/runtime-provider.mjs",
    ]);
  });

  it.each([
    "node_modules",
    ".next",
    "output",
    "data/uploads",
  ])("ignores generated or runtime directory %s", (directory) => {
    const root = fixtureRoot();
    writeFixture(
      root,
      `${directory}/ignored.txt`,
      `provider=${RETIRED_PROVIDER_TOKEN}`,
    );
    writeFixture(root, "src/current.mjs", "export const provider = 'resend';\n");
    expect(findRetiredProviderMatches(root)).toEqual([]);
  });

  it("ignores binary files without suppressing neighboring text files", () => {
    const root = fixtureRoot();
    const binary = writeFixture(
      root,
      "public/provider-proof.bin",
      Buffer.concat([Buffer.from([0]), Buffer.from(RETIRED_PROVIDER_TOKEN)]),
    );
    const text = writeFixture(root, "src/current.txt", "resend\n");
    expect(readUtf8TextFileIfSafe(binary)).toBeUndefined();
    expect(readUtf8TextFileIfSafe(text)).toBe("resend\n");
    expect(findRetiredProviderMatches(root)).toEqual([]);
  });

  it("returns deterministic lexical paths regardless of creation order", () => {
    const root = fixtureRoot();
    for (const relativePath of [
      "z-last.txt",
      "nested/z.txt",
      "nested/a.txt",
      "a-first.txt",
    ]) {
      writeFixture(root, relativePath, relativePath);
    }
    expect(enumerateSourceTreeFiles(root)).toEqual([
      "a-first.txt",
      "nested/a.txt",
      "nested/z.txt",
      "z-last.txt",
    ]);
  });

  it("does not follow symlinks outside the exported source tree", () => {
    const root = fixtureRoot();
    const outside = fixtureRoot("axora-source-outside-");
    const outsideFile = writeFixture(
      outside,
      "outside.txt",
      `provider=${RETIRED_PROVIDER_TOKEN}`,
    );
    mkdirSync(join(root, "src"), { recursive: true });
    symlinkSync(outsideFile, join(root, "src", "outside-link.txt"));
    writeFixture(root, "src/current.mjs", "export const provider = 'resend';\n");

    expect(enumerateSourceTreeFiles(root)).toEqual(["src/current.mjs"]);
    expect(findRetiredProviderMatches(root)).toEqual([]);
  });
});
