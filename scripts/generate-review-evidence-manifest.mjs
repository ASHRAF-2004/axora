#!/usr/bin/env node

import { execFile } from "node:child_process";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { evidenceSourceForPath, EVIDENCE_CONFIGURATION_PATHS } from "./evidence-contract.mjs";
import { inspectEvidenceFile, listEvidenceFiles, MANIFEST_PATH, sha256File, validateRequiredEvidence } from "./validate-review-evidence.mjs";

const execFileAsync = promisify(execFile);
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function kindFor(pathname) {
  if (pathname.endsWith(".png")) return "image";
  if (pathname.endsWith(".webm")) return "video";
  if (pathname.endsWith(".json")) return "json";
  if (pathname.endsWith(".html")) return "html";
  if (pathname.endsWith(".md") || pathname.endsWith(".log")) return "text";
  return "binary";
}

async function gitHead() {
  const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: repositoryRoot });
  return stdout.trim();
}

async function browserVersion() {
  const browser = await chromium.launch({ headless: true });
  try {
    return browser.version();
  } finally {
    await browser.close();
  }
}

async function inspectForManifest(relativePath) {
  const absolute = path.join(repositoryRoot, relativePath);
  const kind = kindFor(relativePath);
  const base = { path: relativePath, kind, minBytes: 1, minWidth: 1, minHeight: 1, minEntropy: 0 };
  const inspection = kind === "binary"
    ? { bytes: (await stat(absolute)).size, mediaType: "application/octet-stream", dimensions: null }
    : await inspectEvidenceFile(absolute, base);
  return {
    path: relativePath,
    bytes: inspection.bytes,
    sha256: await sha256File(absolute),
    mediaType: inspection.mediaType,
    dimensions: inspection.dimensions,
    testSource: evidenceSourceForPath(relativePath),
  };
}

export async function generateReviewEvidenceManifest() {
  await validateRequiredEvidence(repositoryRoot);
  const [head, chromiumVersion, packageLock] = await Promise.all([
    gitHead(),
    browserVersion(),
    readFile(path.join(repositoryRoot, "package-lock.json"), "utf8").then(JSON.parse),
  ]);
  const files = [];
  for (const relativePath of await listEvidenceFiles(repositoryRoot)) files.push(await inspectForManifest(relativePath));
  const configuration = [];
  for (const configPath of EVIDENCE_CONFIGURATION_PATHS) {
    const absolute = path.join(repositoryRoot, configPath);
    configuration.push({ path: configPath, bytes: (await stat(absolute)).size, sha256: await sha256File(absolute) });
  }
  const nextBuildId = (await readFile(path.join(repositoryRoot, ".next/BUILD_ID"), "utf8")).trim();
  const standaloneServer = path.join(repositoryRoot, "output/standalone/server.js");
  const runId = process.env.GITHUB_RUN_ID ?? "local";
  const runAttempt = process.env.GITHUB_RUN_ATTEMPT ?? "1";
  const repository = process.env.GITHUB_REPOSITORY ?? "ASHRAF-2004/axora";
  const manifest = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    source: {
      headSha: process.env.AXORA_EVIDENCE_HEAD_SHA ?? head,
      testedCommitSha: process.env.GITHUB_SHA ?? head,
      nextBuildId,
      standaloneServerSha256: await sha256File(standaloneServer),
    },
    run: {
      id: runId,
      attempt: runAttempt,
      repository,
      url: runId === "local" ? null : `${process.env.GITHUB_SERVER_URL ?? "https://github.com"}/${repository}/actions/runs/${runId}/attempts/${runAttempt}`,
      artifactRetentionDays: 14,
    },
    browser: {
      chromiumVersion,
      playwrightVersion: packageLock.packages?.["node_modules/@playwright/test"]?.version ?? packageLock.packages?.["node_modules/playwright"]?.version,
      lighthouseVersion: packageLock.packages?.["node_modules/lighthouse"]?.version,
    },
    environment: {
      ci: Boolean(process.env.CI),
      nodeVersion: process.version,
      platform: process.platform,
      architecture: process.arch,
      nodeEnv: "production",
      baseUrl: process.env.AXORA_EVIDENCE_BASE_URL ?? process.env.APP_BASE_URL ?? "http://127.0.0.1:3100",
      demoMode: process.env.DEMO_MODE === "true",
    },
    configuration,
    files,
  };
  const output = path.join(repositoryRoot, MANIFEST_PATH);
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`);
  return { manifest, manifestSha256: await sha256File(output) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await generateReviewEvidenceManifest();
  process.stdout.write(`Recorded ${result.manifest.files.length} evidence files; manifest SHA-256 ${result.manifestSha256}.\n`);
}
