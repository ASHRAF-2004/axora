// Usage: node render.mjs <input.html> <output.pdf> [footerLabel]
import { chromium } from "playwright-core";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const [input, output, label = "Axora handover · November 2026"] = process.argv.slice(2);
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH,
});
const page = await browser.newPage();
await page.goto(pathToFileURL(resolve(input)).href, { waitUntil: "networkidle" });
await page.evaluate(() => document.fonts.ready);
await page.pdf({
  path: output,
  format: "A4",
  printBackground: true,
  preferCSSPageSize: true,
  displayHeaderFooter: true,
  headerTemplate: "<span></span>",
  footerTemplate: `<div style="width:100%;font-size:7.5pt;color:#7a8696;padding:0 15mm;display:flex;justify-content:space-between;font-family:Segoe UI,sans-serif"><span>${label}</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`,
});
await browser.close();
console.log(`wrote ${output}`);
