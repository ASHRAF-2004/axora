import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { stageStandalone } from "../scripts/prepare-standalone.mjs";
import { validateProductionCsp } from "../scripts/validate-standalone-runtime.mjs";

const temporaryDirectories = [];
afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("production CSP and standalone staging", () => {
  it("boots the staged server before runtime validation and always terminates it", async () => {
    const packageJson = JSON.parse(await readFile(path.join(process.cwd(), "package.json"), "utf8"));
    const runner = await readFile(path.join(process.cwd(), "scripts/run-standalone-validation.mjs"), "utf8");
    expect(packageJson.scripts["standalone:validate"]).toBe("node scripts/run-standalone-validation.mjs");
    expect(runner).toContain('["output/standalone/server.js"]');
    expect(runner).toContain("await waitUntilReady()");
    expect(runner).toMatch(/finally \{\s+await stopServer\(\)/);
  });

  it("rejects retired WebAssembly and broad executable capabilities", () => {
    const sources = validateProductionCsp("default-src 'self'; script-src 'self' 'nonce-test' 'strict-dynamic' https://challenges.cloudflare.com");
    expect(sources).not.toContain("'wasm-unsafe-eval'");
    for (const invalid of [
      "script-src 'self' 'unsafe-eval'",
      "script-src 'self' 'wasm-unsafe-eval'",
      "script-src 'self' *",
      "script-src 'self' https://cdn.example.com",
    ]) expect(() => validateProductionCsp(`default-src 'self'; ${invalid}`)).toThrow();
  });

  it("stages the exact Docker standalone public/static overlay", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "axora-standalone-"));
    temporaryDirectories.push(root);
    await Promise.all([
      mkdir(path.join(root, ".next/standalone"), { recursive: true }),
      mkdir(path.join(root, ".next/static/chunks"), { recursive: true }),
      mkdir(path.join(root, "public/brand"), { recursive: true }),
    ]);
    await Promise.all([
      writeFile(path.join(root, "package.json"), "{}"),
      writeFile(path.join(root, "package-lock.json"), "{}"),
      writeFile(path.join(root, ".next/standalone/server.js"), "server"),
      writeFile(path.join(root, ".next/static/chunks/app.js"), "chunk"),
      writeFile(path.join(root, "public/brand/icon.png"), "image"),
    ]);
    const report = await stageStandalone({ repositoryRoot: root, target: path.join(root, "output/standalone"), installDependencies: false, copyRuntimeSupport: false });
    expect(report.staticFiles).toBe(1);
    expect(report.publicFiles).toBe(1);
    expect(await readFile(path.join(root, "output/standalone/.next/static/chunks/app.js"), "utf8")).toBe("chunk");
    expect(await readFile(path.join(root, "output/standalone/public/brand/icon.png"), "utf8")).toBe("image");
  });
});
