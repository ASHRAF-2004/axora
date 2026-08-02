import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const validator = fileURLToPath(
  new URL("../scripts/bootstrap/validate_workbook.py", import.meta.url),
);
const fixtureBuilder = fileURLToPath(
  new URL("./helpers/build_xlsx_fixture.py", import.meta.url),
);
const temporaryDirectories = [];

async function temporaryDirectory() {
  const directory = await mkdtemp(join(tmpdir(), "axora-workbook-validator-"));
  temporaryDirectories.push(directory);
  return directory;
}

function python(args) {
  return spawnSync("python3", args, { encoding: "utf8" });
}

async function buildFixture(directory, mode, name = `${mode}.xlsx`) {
  const workbook = join(directory, name);
  const result = python([fixtureBuilder, mode, workbook]);
  expect(result.status, result.stderr).toBe(0);
  return workbook;
}

async function report(directory) {
  return JSON.parse(await readFile(join(directory, "import-report.json"), "utf8"));
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })
  ));
});

describe("review-only workbook bootstrap validator", () => {
  it("emits deterministic inventory and quarantine for an explicit complete schema", async () => {
    const directory = await temporaryDirectory();
    const workbook = await buildFixture(directory, "valid");
    const firstOutput = join(directory, "first-review");
    const secondOutput = join(directory, "second-review");

    const first = python([
      validator,
      "--workbook", workbook,
      "--output-dir", firstOutput,
    ]);
    const second = python([
      validator,
      "--workbook", workbook,
      "--output-dir", secondOutput,
    ]);

    expect(first.status, first.stderr).toBe(0);
    expect(second.status, second.stderr).toBe(0);
    const firstReportText = await readFile(join(firstOutput, "import-report.json"), "utf8");
    const secondReportText = await readFile(join(secondOutput, "import-report.json"), "utf8");
    expect(firstReportText).toBe(secondReportText);

    const parsed = JSON.parse(firstReportText);
    expect(parsed).toMatchObject({
      format: "axora.workbook-bootstrap-review.v1",
      mode: "review_only_no_import",
      verdict: "review_ready",
      outputs: { production_import_performed: false },
    });
    expect(parsed.issues).toEqual([]);
    expect(Object.values(parsed.entity_summary)).toEqual(
      Array.from({ length: 5 }, () => ({
        candidate_rows: 1,
        extracted_rows: 1,
        quarantined_rows: 0,
      })),
    );
    expect(parsed.inventory.sheets.map((sheet) => sheet.name)).toEqual([
      "Companies",
      "Branches",
      "Products",
      "Recurring Products",
      "Account Roles",
    ]);

    const reportMode = (await stat(join(firstOutput, "import-report.json"))).mode & 0o777;
    const outputMode = (await stat(firstOutput)).mode & 0o777;
    expect(reportMode).toBe(0o600);
    expect(outputMode).toBe(0o700);
  });

  it("blocks adversarial formulas, unknown roles, and plaintext credentials without echoing secrets", async () => {
    const directory = await temporaryDirectory();
    const workbook = await buildFixture(directory, "adversarial");
    const output = join(directory, "blocked-review");
    const result = python([
      validator,
      "--workbook", workbook,
      "--output-dir", output,
    ]);

    expect(result.status, result.stderr).toBe(1);
    const parsed = await report(output);
    expect(parsed.verdict).toBe("blocked");
    const codes = parsed.issues.map((item) => item.code);
    expect(codes).toEqual(expect.arrayContaining([
      "credential_column_forbidden",
      "credential_material_forbidden",
      "formula_not_importable",
      "unknown_role_mapping",
    ]));

    const allOutput = await Promise.all([
      readFile(join(output, "import-report.json"), "utf8"),
      readFile(join(output, "quarantine", "account_roles.jsonl"), "utf8"),
      readFile(join(output, "quarantine", "branches.jsonl"), "utf8"),
    ]).then((parts) => parts.join("\n"));
    expect(allOutput).not.toContain("CorrectHorseBatteryStaple!2026");
    expect(allOutput).toContain("[REDACTED_CREDENTIAL]");
  });

  it("refuses to overwrite a caller-selected output directory", async () => {
    const directory = await temporaryDirectory();
    const workbook = await buildFixture(directory, "valid");
    const output = join(directory, "already-there");
    const first = python([validator, "--workbook", workbook, "--output-dir", output]);
    const second = python([validator, "--workbook", workbook, "--output-dir", output]);
    expect(first.status).toBe(0);
    expect(second.status).toBe(2);
    expect(second.stderr).toMatch(/must not already exist/i);
  });
});
