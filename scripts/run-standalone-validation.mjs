#!/usr/bin/env node

import { once } from "node:events";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateStandaloneRuntime } from "./validate-standalone-runtime.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const host = "127.0.0.1";
const port = process.env.PORT ?? "3100";
const baseUrl = `http://${host}:${port}`;
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const server = spawn(process.execPath, ["output/standalone/server.js"], {
  cwd: repositoryRoot,
  env: {
    ...process.env,
    APP_BASE_URL: baseUrl,
    DEMO_EMAIL: "owner@axora.e2e",
    DEMO_MODE: "true",
    DEMO_PASSWORD: "public-e2e-fixture-password",
    HOSTNAME: host,
    NEXT_TELEMETRY_DISABLED: "1",
    NODE_ENV: "production",
    PORT: port,
    SESSION_SECRET: "public-e2e-session-key-not-for-production-0001",
    TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
  },
  stdio: ["ignore", "inherit", "inherit"],
});

async function waitUntilReady() {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`Standalone server exited before validation with code ${server.exitCode}.`);
    try {
      const response = await fetch(`${baseUrl}/api/health/live`);
      if (response.ok) return;
    } catch {
      // The server is still starting.
    }
    await delay(250);
  }
  throw new Error("Standalone server did not become ready within 120 seconds.");
}

async function stopServer() {
  if (server.exitCode !== null) return;
  server.kill("SIGTERM");
  const stopped = await Promise.race([once(server, "exit").then(() => true), delay(5_000).then(() => false)]);
  if (!stopped && server.exitCode === null) {
    server.kill("SIGKILL");
    await once(server, "exit");
  }
}

try {
  await waitUntilReady();
  const report = await validateStandaloneRuntime({ baseUrl });
  process.stdout.write(`Validated ${report.routes.length} production routes and ${report.resources.length} self-hosted runtime resources.\n`);
} finally {
  await stopServer();
}
