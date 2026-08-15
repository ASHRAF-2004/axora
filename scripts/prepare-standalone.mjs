#!/usr/bin/env node

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, lstat, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const defaultRepositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultDestination = process.env.AXORA_STANDALONE_OUTPUT
  ? path.resolve(process.env.AXORA_STANDALONE_OUTPUT)
  : path.join(defaultRepositoryRoot, "output/standalone");

async function sha256(file) {
  return createHash("sha256").update(await readFile(file)).digest("hex");
}

async function treeSummary(root) {
  let bytes = 0;
  let files = 0;
  let symlinks = 0;
  const visit = async (directory) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      const info = await lstat(absolute);
      if (info.isSymbolicLink()) {
        symlinks += 1;
      } else if (info.isDirectory()) {
        await visit(absolute);
      } else if (info.isFile()) {
        files += 1;
        bytes += info.size;
      }
    }
  };
  await visit(root);
  return { bytes, files, symlinks };
}

export async function stageStandalone({
  repositoryRoot = defaultRepositoryRoot,
  target = repositoryRoot === defaultRepositoryRoot
    ? defaultDestination
    : path.join(repositoryRoot, "output/standalone"),
  installDependencies = true,
  copyRuntimeSupport = true,
} = {}) {
  const source = path.join(repositoryRoot, ".next/standalone");
  const serverSource = path.join(source, "server.js");
  if (!(await stat(serverSource).catch(() => null))?.isFile()) {
    throw new Error("The Next.js standalone build is missing. Run npm run build first.");
  }

  await rm(target, { recursive: true, force: true });
  await mkdir(target, { recursive: true });
  if (copyRuntimeSupport) {
    for (const name of ["package.json", "package-lock.json"]) {
      await cp(path.join(repositoryRoot, name), path.join(target, name));
    }
  }

  // Match the Docker runner layer: install production dependencies first,
  // then overlay Next's traced standalone tree without dereferencing its
  // relative native-module symlinks.
  if (installDependencies) {
    if (!copyRuntimeSupport) {
      throw new Error("Dependency installation requires the runtime package manifests.");
    }
    await execFileAsync("npm", ["ci", "--omit=dev", "--no-audit", "--no-fund"], {
      cwd: target,
      env: { ...process.env, NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1" },
      maxBuffer: 16 * 1024 * 1024,
    });
  }
  await cp(source, target, {
    recursive: true,
    force: true,
    verbatimSymlinks: true,
  });
  await mkdir(path.join(target, ".next"), { recursive: true });
  await cp(path.join(repositoryRoot, ".next/static"), path.join(target, ".next/static"), {
    recursive: true,
    force: true,
    verbatimSymlinks: true,
  });
  await cp(path.join(repositoryRoot, "public"), path.join(target, "public"), {
    recursive: true,
    force: true,
    verbatimSymlinks: true,
  });

  const server = path.join(target, "server.js");
  const buildIdPath = path.join(target, ".next/BUILD_ID");
  const buildId = (await readFile(buildIdPath, "utf8").catch(() => "")).trim() || null;
  const staticSummary = await treeSummary(path.join(target, ".next/static"));
  const publicSummary = await treeSummary(path.join(target, "public"));
  const report = {
    generatedAt: new Date().toISOString(),
    outputPath: path.relative(repositoryRoot, target) || ".",
    buildId,
    serverSha256: await sha256(server),
    ...(await treeSummary(target)),
    staticFiles: staticSummary.files,
    publicFiles: publicSummary.files,
    productionDependenciesInstalled: installDependencies,
    verbatimSymlinks: true,
  };
  return report;
}

export async function prepareStandalone(options = {}) {
  const report = await stageStandalone(options);
  const reportPath = path.join(defaultRepositoryRoot, "output/reports/standalone-stage.json");
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = await prepareStandalone();
  process.stdout.write(`Staged production standalone output (${report.files} files, ${report.symlinks} preserved symlinks).\n`);
}
