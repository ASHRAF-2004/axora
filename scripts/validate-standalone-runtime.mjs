#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const allowedExternalScriptOrigins = new Set(["https://challenges.cloudflare.com"]);

export function directiveSources(policy, name) {
  const directive = policy.split(";").map((entry) => entry.trim()).find((entry) => entry.startsWith(`${name} `));
  if (!directive) throw new Error(`Production response is missing the ${name} CSP directive.`);
  return directive.split(/\s+/).slice(1);
}

export function validateProductionCsp(policy) {
  if (!policy) throw new Error("Production response is missing Content-Security-Policy.");
  const sources = directiveSources(policy, "script-src");
  if (sources.includes("'wasm-unsafe-eval'")) throw new Error("Production script-src retains an unused WebAssembly evaluation capability.");
  if (sources.includes("'unsafe-eval'")) throw new Error("Production script-src contains broad unsafe-eval.");
  if (sources.includes("*") || sources.some((source) => source.includes("*"))) throw new Error("Production script-src contains a wildcard source.");
  const unexpected = sources.filter((source) => /^https?:/.test(source) && !allowedExternalScriptOrigins.has(source));
  if (unexpected.length) throw new Error(`Production script-src contains unexpected remote executable origins: ${unexpected.join(", ")}`);
  if (sources.some((source) => /(?:unpkg|jsdelivr|gstatic|cdn\.)/i.test(source))) throw new Error("Production script-src contains an unexpected remote executable origin.");
  return sources;
}

async function inspectRoute(baseUrl, route) {
  const response = await fetch(new URL(route, baseUrl), { redirect: "manual" });
  await response.arrayBuffer();
  return { route, status: response.status, contentType: response.headers.get("content-type") ?? "", csp: response.headers.get("content-security-policy") ?? "" };
}

async function inspectResource(baseUrl, resourcePath) {
  const response = await fetch(new URL(resourcePath, baseUrl));
  const bytes = Buffer.from(await response.arrayBuffer()).byteLength;
  return { path: resourcePath, status: response.status, bytes, contentType: response.headers.get("content-type") ?? "" };
}

export async function validateStandaloneRuntime({ baseUrl = process.env.APP_BASE_URL ?? "http://127.0.0.1:3100" } = {}) {
  const routes = await Promise.all(["/en", "/login"].map((route) => inspectRoute(baseUrl, route)));
  const resources = await Promise.all([
    inspectResource(baseUrl, "/brand/axora-icon-192.png"),
    inspectResource(baseUrl, "/catalog/categories/office-supplies.avif"),
  ]);
  const failures = [];
  for (const route of routes) if (route.status !== 200) failures.push(`${route.route} returned HTTP ${route.status}`);
  for (const resource of resources) {
    if (resource.status !== 200) failures.push(`${resource.path} returned HTTP ${resource.status}`);
    if (resource.bytes === 0) failures.push(`${resource.path} returned an empty response`);
    if (/text\/html/i.test(resource.contentType)) failures.push(`${resource.path} unexpectedly returned HTML`);
  }
  let scriptSources = [];
  try {
    scriptSources = validateProductionCsp(routes.find((entry) => entry.route === "/en")?.csp ?? "");
  } catch (error) {
    failures.push(error instanceof Error ? error.message : String(error));
  }
  const report = {
    generatedAt: new Date().toISOString(),
    baseUrl,
    platform: process.platform,
    architecture: process.arch,
    nodeVersion: process.version,
    routes: routes.map(({ route, status, contentType }) => ({ route, status, contentType })),
    scriptSources,
    resources,
    failures,
  };
  const output = path.join(repositoryRoot, "output/reports/standalone-runtime.json");
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
  if (failures.length) throw new Error(`Standalone runtime validation failed: ${failures.join(", ")}`);
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = await validateStandaloneRuntime();
  process.stdout.write(`Validated ${report.routes.length} production routes and ${report.resources.length} self-hosted runtime resources.\n`);
}
