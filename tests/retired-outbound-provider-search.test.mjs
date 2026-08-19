import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const retiredProvider = ["zepto", "mail"].join("");
const allowed = [
  /^database\/migrations\//,
  /^database\/admin\/apply-app-grants\.sql$/,
];

function trackedFiles() {
  return execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
    .split("\0")
    .filter(Boolean);
}

function isText(bytes) {
  const sample = bytes.subarray(0, Math.min(bytes.length, 8192));
  return !sample.includes(0);
}

describe("retired outbound provider repository gate", () => {
  it("allows the retired provider name only in immutable migration/forward-compatibility evidence", () => {
    const matches = [];
    for (const path of trackedFiles()) {
      const bytes = readFileSync(path);
      if (!isText(bytes)) continue;
      if (!bytes.toString("utf8").toLowerCase().includes(retiredProvider)) continue;
      matches.push(path);
    }

    const unexpected = matches.filter((path) => (
      !allowed.some((pattern) => pattern.test(path))
    ));
    expect(unexpected).toEqual([]);
  });
});
