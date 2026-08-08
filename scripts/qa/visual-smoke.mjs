import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";

const projectDir = path.resolve(import.meta.dirname, "../..");
const outputDir = path.join(projectDir, "reports", "screenshots");
const baseUrl = process.env.AXORA_QA_URL || "http://127.0.0.1:3010";

function parseEnvironment(text) {
  return Object.fromEntries(text.split(/\r?\n/).filter((line) => line && !line.startsWith("#") && line.includes("="))
    .map((line) => { const index = line.indexOf("="); return [line.slice(0, index), line.slice(index + 1)]; }));
}

const envCandidates = [".env.local", ".env"];
let environment = process.env.DEMO_EMAIL && process.env.DEMO_PASSWORD
  ? {
      DEMO_EMAIL: process.env.DEMO_EMAIL,
      DEMO_PASSWORD: process.env.DEMO_PASSWORD,
    }
  : null;

if (!environment) {
  for (const envFile of envCandidates) {
    const envPath = path.join(projectDir, envFile);
    try {
      await access(envPath, fsConstants.R_OK);
      environment = parseEnvironment(await readFile(envPath, "utf8"));
      break;
    } catch {
      continue;
    }
  }
}

if (!environment) environment = {};
if (!environment.DEMO_EMAIL || !environment.DEMO_PASSWORD) throw new Error("DEMO_EMAIL and DEMO_PASSWORD are required in .env, .env.local, or environment variables.");
await mkdir(outputDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: "light" });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
page.on("console", (message) => { if (message.type() === "error") errors.push(`console: ${message.text()}`); });

const checks = [];
async function inspect(name, route, heading) {
  await page.goto(`${baseUrl}${route}`, { waitUntil: "domcontentloaded" });
  const title = typeof heading === "string"
    ? page.getByRole("heading", { name: heading, exact: true })
    : page.getByRole("heading", { name: heading });
  await title.waitFor({ state: "visible" });
  await page.waitForTimeout(250);
  await page.waitForFunction(
    () => [...document.images].every((image) => image.complete),
    undefined,
    { timeout: 5_000 },
  );
  const layout = await page.evaluate(() => ({
    title: document.title,
    horizontalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    mainCount: document.querySelectorAll("main").length,
    emptyImages: [...document.images].filter((image) => !image.complete || image.naturalWidth === 0).length,
  }));
  if (layout.horizontalOverflow > 2) throw new Error(`${name} has ${layout.horizontalOverflow}px horizontal overflow.`);
  if (layout.mainCount !== 1) throw new Error(`${name} should contain exactly one main region.`);
  if (layout.emptyImages) throw new Error(`${name} has ${layout.emptyImages} failed image(s).`);
  const screenshot = path.join(outputDir, `${name}.png`);
  await page.screenshot({ path: screenshot, fullPage: false });
  checks.push({ name, route, heading, screenshot, ...layout });
}

try {
  await page.goto(`${baseUrl}/login`, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "Sign in to Axora" }).waitFor();
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(outputDir, "login.png"), fullPage: false });
  await page.getByLabel("Email", { exact: true }).fill(environment.DEMO_EMAIL);
  await page.getByLabel("Password", { exact: true }).fill(environment.DEMO_PASSWORD);
  await Promise.all([page.waitForURL("**/dashboard"), page.getByRole("button", { name: "Sign in" }).click()]);

  await inspect("dashboard", "/dashboard", /^(Good morning|Good afternoon|Good evening),\s+\S/u);
  await inspect("requests", "/requests", "Purchase requests");
  const requestLink = page.locator('.data-table a[href^="/requests/"]').first();
  const requestHref = await requestLink.getAttribute("href");
  const requestHeading = (await requestLink.textContent())?.trim();
  if (!requestHref) throw new Error("No request detail link was found.");
  if (!requestHeading) throw new Error("The first request link has no label.");
  await inspect("request-detail", requestHref, requestHeading);
  await inspect("sourcing", "/sourcing", "Sourcing and quotations");
  await inspect("deliveries", "/deliveries", "Deliveries");
  await inspect("finance", "/finance", "Invoices and COD payments");
  await inspect("users", "/users", "Create named accounts");
  await inspect("settings", "/settings", "Settings and security");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${baseUrl}/dashboard`, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: /^(Good morning|Good afternoon|Good evening),\s+\S/u }).waitFor();
  const mobileOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (mobileOverflow > 2) throw new Error(`Mobile dashboard has ${mobileOverflow}px horizontal overflow.`);
  await page.screenshot({ path: path.join(outputDir, "dashboard-mobile.png"), fullPage: false });
  checks.push({ name: "dashboard-mobile", route: "/dashboard", horizontalOverflow: mobileOverflow });

  const allowedErrors = errors.filter((message) => !message.includes("favicon"));
  if (allowedErrors.length) throw new Error(`Browser errors detected:\n${allowedErrors.join("\n")}`);
  await writeFile(path.join(outputDir, "visual-smoke-report.json"), JSON.stringify({ passed: true, checkedAt: new Date().toISOString(), checks }, null, 2));
  console.log(`Visual smoke test passed: ${checks.length} screens checked.`);
} catch (error) {
  await page.screenshot({ path: path.join(outputDir, "failure.png"), fullPage: false }).catch(() => undefined);
  await writeFile(path.join(outputDir, "visual-smoke-report.json"), JSON.stringify({ passed: false, checkedAt: new Date().toISOString(), checks, errors, failure: error instanceof Error ? error.message : String(error) }, null, 2));
  throw error;
} finally {
  await browser.close();
}
