import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";
import { REQUIRED_REVIEW_EVIDENCE } from "../scripts/evidence-contract.mjs";
import { auditLighthouseReport } from "../scripts/validate-lighthouse-evidence.mjs";
import { stageStandalone } from "../scripts/prepare-standalone.mjs";
import { readPublicSceneModelInventory } from "../scripts/read-public-scene-inventory.mjs";
import { inspectEvidenceFile, readWebmDimensions } from "../scripts/validate-review-evidence.mjs";
import { validateProductionCsp } from "../scripts/validate-standalone-runtime.mjs";

const temporaryDirectories = [];
afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

function passingLighthouseReport() {
  return {
    categories: { performance: { score: 1 }, accessibility: { score: 1 }, "best-practices": { score: 1 }, seo: { score: 1 } },
    audits: {
      "errors-in-console": { score: 1, details: { items: [] } },
      "inspector-issues": { score: 1, details: { items: [] } },
      "network-requests": { score: 1, details: { items: [{ url: "http://127.0.0.1/en", statusCode: 200 }] } },
      "csp-xss": { score: 1 },
      "largest-contentful-paint": { numericValue: 500 },
      "cumulative-layout-shift": { numericValue: 0 },
      "total-blocking-time": { numericValue: 0 },
    },
  };
}

describe("production CSP and standalone evidence", () => {
  it("permits only the narrow self-hosted WebAssembly decoder capability", () => {
    const sources = validateProductionCsp("default-src 'self'; script-src 'self' 'nonce-test' 'strict-dynamic' 'wasm-unsafe-eval' https://challenges.cloudflare.com");
    expect(sources).toContain("'wasm-unsafe-eval'");
    for (const invalid of [
      "script-src 'self' 'wasm-unsafe-eval' 'unsafe-eval'",
      "script-src 'self' 'wasm-unsafe-eval' *",
      "script-src 'self' 'wasm-unsafe-eval' https://cdn.example.com",
    ]) expect(() => validateProductionCsp(`default-src 'self'; ${invalid}`)).toThrow();
  });

  it("rejects console errors, Inspector CSP issues, HTTP failures, and sub-perfect accessibility or SEO", () => {
    expect(auditLighthouseReport("desktop", passingLighthouseReport()).failures).toEqual([]);
    const consoleFailure = passingLighthouseReport();
    consoleFailure.audits["errors-in-console"] = { score: 0, details: { items: [{ description: "boom" }] } };
    expect(auditLighthouseReport("desktop", consoleFailure).failures.join(" ")).toContain("console error");
    const cspFailure = passingLighthouseReport();
    cspFailure.audits["inspector-issues"] = { score: 0, details: { items: [{ code: "ContentSecurityPolicyIssue" }] } };
    expect(auditLighthouseReport("desktop", cspFailure).failures.join(" ")).toContain("including CSP");
    const networkFailure = passingLighthouseReport();
    networkFailure.audits["network-requests"].details.items.push({ url: "http://127.0.0.1/api/failure?secret=redacted", statusCode: 503 });
    expect(auditLighthouseReport("desktop", networkFailure).failures.join(" ")).toContain("/api/failure returned HTTP 503");
    const categoryFailure = passingLighthouseReport();
    categoryFailure.categories.accessibility.score = 0.99;
    categoryFailure.categories.seo.score = 0.99;
    expect(auditLighthouseReport("desktop", categoryFailure).failures).toHaveLength(2);
  });

  it("stages the exact Docker standalone public/static overlay", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "axora-standalone-"));
    temporaryDirectories.push(root);
    await Promise.all([
      mkdir(path.join(root, ".next/standalone"), { recursive: true }),
      mkdir(path.join(root, ".next/static/chunks"), { recursive: true }),
      mkdir(path.join(root, "public/immersive"), { recursive: true }),
    ]);
    await Promise.all([
      writeFile(path.join(root, "package.json"), "{}"),
      writeFile(path.join(root, "package-lock.json"), "{}"),
      writeFile(path.join(root, ".next/standalone/server.js"), "server"),
      writeFile(path.join(root, ".next/static/chunks/app.js"), "chunk"),
      writeFile(path.join(root, "public/immersive/model.glb"), "model"),
    ]);
    const report = await stageStandalone({ repositoryRoot: root, target: path.join(root, "output/standalone"), installDependencies: false, copyRuntimeSupport: false });
    expect(report.staticFiles).toBe(1);
    expect(report.publicFiles).toBe(1);
    expect(await readFile(path.join(root, "output/standalone/.next/static/chunks/app.js"), "utf8")).toBe("chunk");
    expect(await readFile(path.join(root, "output/standalone/public/immersive/model.glb"), "utf8")).toBe("model");
  });

  it("content-inspects screenshots and reads actual WebM dimensions", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "axora-evidence-"));
    temporaryDirectories.push(root);
    const pixels = Buffer.alloc(64 * 64 * 3);
    for (let index = 0; index < pixels.length; index += 1) pixels[index] = index % 251;
    const imagePath = path.join(root, "evidence.png");
    await sharp(pixels, { raw: { width: 64, height: 64, channels: 3 } }).png().toFile(imagePath);
    const inspection = await inspectEvidenceFile(imagePath, { kind: "image", minBytes: 1, minWidth: 64, minHeight: 64, minEntropy: 0.1 });
    expect(inspection.dimensions).toEqual({ width: 64, height: 64 });
    const webm = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0xe0, 0x88, 0xb0, 0x82, 0x05, 0x00, 0xba, 0x82, 0x03, 0x20]);
    expect(readWebmDimensions(webm)).toEqual({ width: 1280, height: 800 });
  });

  it("derives route counts and requires deterministic evidence for every homepage stage", () => {
    const inventory = readPublicSceneModelInventory(process.cwd());
    expect(Object.fromEntries(Object.entries(inventory).map(([route, models]) => [route, models.length]))).toEqual({
      home: 8,
      "how-it-works": 7,
      "procurement-process": 7,
      "solutions-by-role": 3,
      "security-and-privacy": 3,
      about: 3,
    });
    const evidencePaths = new Set(REQUIRED_REVIEW_EVIDENCE.map((entry) => entry.path));
    for (const stage of inventory.home) expect(evidencePaths).toContain(`output/playwright/v2-home-stage-${stage}.png`);
  });
});
