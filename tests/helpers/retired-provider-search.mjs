import {
  lstatSync,
  readFileSync,
  readdirSync,
} from "node:fs";
import {
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";

export const RETIRED_PROVIDER_TOKEN = ["zep", "to"].join("");
export const RETIRED_PROVIDER_ALLOWED_PATHS = Object.freeze([
  /^database\/migrations\//,
  /^database\/admin\/apply-app-grants\.sql$/,
]);
export const DEFAULT_EXCLUDED_SOURCE_DIRECTORIES = Object.freeze([
  ".git",
  "node_modules",
  ".next",
  ".open-next",
  "out",
  "coverage",
  "output",
  "tmp",
  ".cache",
  ".turbo",
  ".parcel-cache",
  ".playwright-cli",
  ".wrangler",
  ".venv",
  "venv",
  ".pytest_cache",
  ".mypy_cache",
  ".ruff_cache",
  "playwright-report",
  "test-results",
  "__pycache__",
  "backups",
  "secrets",
  "data",
  "assets",
  "logs",
]);

function compareEntryNames(left, right) {
  if (left.name < right.name) return -1;
  if (left.name > right.name) return 1;
  return 0;
}

function normalizeRelativePath(root, absolutePath) {
  const candidate = relative(root, absolutePath);
  if (!candidate || candidate === ".." || candidate.startsWith(`..${sep}`)
    || isAbsolute(candidate)) {
    throw new Error("Source-tree traversal escaped the repository root.");
  }
  return candidate.split(sep).join("/");
}

export function enumerateSourceTreeFiles(
  rootDirectory,
  { excludedDirectoryNames = DEFAULT_EXCLUDED_SOURCE_DIRECTORIES } = {},
) {
  const root = resolve(rootDirectory);
  const rootStat = lstatSync(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error("Source-tree root must be a real directory.");
  }

  const excluded = new Set(excludedDirectoryNames);
  const files = [];

  function walk(directory) {
    const entries = readdirSync(directory, { withFileTypes: true })
      .sort(compareEntryNames);
    for (const entry of entries) {
      const absolutePath = join(directory, entry.name);
      const stat = lstatSync(absolutePath);
      if (stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) {
        if (!excluded.has(entry.name)) walk(absolutePath);
        continue;
      }
      if (!stat.isFile()) continue;
      files.push(normalizeRelativePath(root, absolutePath));
    }
  }

  walk(root);
  return files;
}

export function readUtf8TextFileIfSafe(path) {
  const bytes = readFileSync(path);
  const sample = bytes.subarray(0, Math.min(bytes.length, 8192));
  if (sample.includes(0)) return undefined;
  return bytes.toString("utf8");
}

export function findRetiredProviderMatches(rootDirectory) {
  const root = resolve(rootDirectory);
  const matches = [];
  for (const relativePath of enumerateSourceTreeFiles(root)) {
    const text = readUtf8TextFileIfSafe(join(root, ...relativePath.split("/")));
    if (text?.toLowerCase().includes(RETIRED_PROVIDER_TOKEN)) {
      matches.push(relativePath);
    }
  }
  return matches;
}

export function findUnexpectedRetiredProviderReferences(rootDirectory) {
  return findRetiredProviderMatches(rootDirectory).filter((path) => (
    !RETIRED_PROVIDER_ALLOWED_PATHS.some((pattern) => pattern.test(path))
  ));
}
