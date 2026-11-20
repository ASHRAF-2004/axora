import { chromium } from "playwright-core"; import { pathToFileURL } from "node:url"; import { resolve } from "node:path";
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH });
const p = await b.newPage({ deviceScaleFactor: 2, viewport: { width: 860, height: 900 } });
await p.goto(pathToFileURL(resolve("mockups.html")).href, { waitUntil: "networkidle" });
for (const id of ["w1","w2","w3","w4","w5","m1","m2","m3","t1"]) await p.locator("#" + id).screenshot({ path: `img-${id}.png` });
await b.close(); console.log("ok");
