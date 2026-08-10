import { readdirSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { describe, expect, it } from "vitest";
import * as ts from "typescript";
import {
  assertPostgresQueryParameterContract,
  postgresParameterIndexes,
} from "../src/lib/db";

function sourceFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return [".ts", ".tsx", ".js", ".mjs"].includes(extname(path)) ? [path] : [];
  });
}

function staticSql(node: ts.Expression | undefined) {
  if (!node) return undefined;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  return undefined;
}

function staticValues(node: ts.Expression | undefined) {
  if (!node || !ts.isArrayLiteralExpression(node) || node.elements.some(ts.isSpreadElement)) {
    return undefined;
  }
  return new Array(node.elements.length);
}

describe("PostgreSQL query parameter contracts", () => {
  it("ignores placeholders inside PostgreSQL strings, identifiers, comments and dollar quotes", () => {
    const sql = [
      "SELECT $1, '$9', \"$8\", $$ $7 $$, $tag$ $6 $tag$",
      "/* $5 /* $4 */ */ -- $3",
    ].join("\n");
    expect(postgresParameterIndexes(sql)).toEqual([1]);
    expect(() => assertPostgresQueryParameterContract(sql, ["bound"])).not.toThrow();
  });

  it("rejects skipped, missing and extra bind values without including SQL or values", () => {
    for (const [sql, values] of [
      ["SELECT $1,$3", [1, 2, 3]],
      ["SELECT $1,$2", [1]],
      ["SELECT $1", [1, 2]],
      ["SELECT 1", [1]],
    ] as const) {
      expect(() => assertPostgresQueryParameterContract(sql, values)).toThrow(
        /PostgreSQL parameter contract mismatch/,
      );
    }
  });

  it("statically verifies every directly analyzable production query call", () => {
    let checked = 0;
    for (const file of sourceFiles(join(process.cwd(), "src"))) {
      const source = readFileSync(file, "utf8");
      const tree = ts.createSourceFile(
        file,
        source,
        ts.ScriptTarget.Latest,
        true,
        file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
      );
      function visit(node: ts.Node) {
        if (ts.isCallExpression(node)) {
          const expression = node.expression;
          const isQuery = (ts.isPropertyAccessExpression(expression) && expression.name.text === "query")
            || (ts.isIdentifier(expression) && expression.text === "query");
          if (isQuery) {
            const sql = staticSql(node.arguments[0]);
            const values = staticValues(node.arguments[1]);
            if (sql !== undefined && values !== undefined) {
              assertPostgresQueryParameterContract(sql, values);
              checked += 1;
            } else if (sql !== undefined && node.arguments.length === 1) {
              assertPostgresQueryParameterContract(sql);
              checked += 1;
            }
          }
        }
        ts.forEachChild(node, visit);
      }
      visit(tree);
    }
    expect(checked).toBeGreaterThan(250);
  });
});
