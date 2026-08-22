#!/usr/bin/env node

import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const requiredSections = [
  "Self-hosted public and map assets",
  "MapLibre GL JS",
  "Owner-supplied Axora artwork and email illustration",
  "Lucide icon assets and React library",
  "Noto fonts used by map glyph assets",
  "axe-core Playwright accessibility checks",
  "Tailscale client",
  "PDFKit document generator",
  "DejaVu fonts embedded in generated documents",
];
const requiredLicenceRecords = new Set([
  "licenses/DEJAVU-FONTS.txt",
  "licenses/LUCIDE-ISC.txt",
  "licenses/MAPLIBRE-GL-JS-BSD-3-CLAUSE.txt",
  "licenses/PDFKIT-MIT.txt",
  "licenses/TAILSCALE-BSD-3-CLAUSE.txt",
  "third_party/licenses/CC0-1.0.txt",
  "third_party/licenses/NATURAL_EARTH_PUBLIC_DOMAIN.md",
  "third_party/licenses/ODbL-1.0.txt",
  "third_party/licenses/OFL-1.1.txt",
]);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

export async function validateThirdPartyNotices() {
  const [notices, assets, packageJson, packageLock] = await Promise.all([
    readFile(path.join(repositoryRoot, "THIRD_PARTY_NOTICES.md"), "utf8"),
    readFile(path.join(repositoryRoot, "THIRD_PARTY_ASSETS.md"), "utf8"),
    readFile(path.join(repositoryRoot, "package.json"), "utf8").then(JSON.parse),
    readFile(path.join(repositoryRoot, "package-lock.json"), "utf8").then(JSON.parse),
  ]);
  for (const section of requiredSections) assert(notices.includes(`## ${section}`), `Missing third-party notice section: ${section}`);
  const versions = {
    MapLibre: packageJson.dependencies["maplibre-gl"],
    Lucide: packageLock.packages["node_modules/lucide-react"].version,
    PDFKit: packageJson.dependencies.pdfkit,
    "axe-core": packageJson.devDependencies["@axe-core/playwright"],
  };
  for (const [name, version] of Object.entries(versions)) assert(notices.includes(String(version)), `${name} notice does not match installed version ${version}.`);
  assert(assets.includes("third-party-assets.json"), "Asset summary does not point to the authoritative manifest.");

  const localLicenceReferences = [...notices.matchAll(/`((?:licenses|third_party\/licenses)\/[^`]+)`/g)].map((match) => match[1]);
  assert(
    JSON.stringify([...new Set(localLicenceReferences)].sort()) === JSON.stringify([...requiredLicenceRecords].sort()),
    "Third-party notices do not reference the exact required local licence records.",
  );
  for (const licencePath of new Set(localLicenceReferences)) {
    assert(!path.isAbsolute(licencePath) && !licencePath.includes(".."), `Unsafe licence path in notices: ${licencePath}`);
    const info = await stat(path.join(repositoryRoot, licencePath));
    assert(info.isFile() && info.size > 100, `Missing or incomplete licence text: ${licencePath}`);
  }
  return { sections: requiredSections.length, licenceRecords: new Set(localLicenceReferences).size };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await validateThirdPartyNotices();
  process.stdout.write(`Validated ${result.sections} third-party notice sections and ${result.licenceRecords} local licence records.\n`);
}
