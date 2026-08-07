import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { applyMigrations } from "./helpers/pglite";

const migrationUrl = new URL(
  "../database/migrations/042_role_scope_lifecycle.sql",
  import.meta.url,
);

function splitSql(source: string) {
  const statements: string[] = [];
  let current = "";
  let index = 0;
  let singleQuoted = false;
  let doubleQuoted = false;
  let lineComment = false;
  let blockComment = false;
  let dollarTag: string | undefined;

  while (index < source.length) {
    if (lineComment) {
      const character = source[index++];
      current += character;
      if (character === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (source.startsWith("*/", index)) {
        current += "*/";
        index += 2;
        blockComment = false;
      } else {
        current += source[index++];
      }
      continue;
    }
    if (dollarTag) {
      if (source.startsWith(dollarTag, index)) {
        current += dollarTag;
        index += dollarTag.length;
        dollarTag = undefined;
      } else {
        current += source[index++];
      }
      continue;
    }
    if (singleQuoted) {
      const character = source[index++];
      current += character;
      if (character === "'" && source[index] === "'") {
        current += source[index++];
      } else if (character === "'") {
        singleQuoted = false;
      }
      continue;
    }
    if (doubleQuoted) {
      const character = source[index++];
      current += character;
      if (character === '"' && source[index] === '"') {
        current += source[index++];
      } else if (character === '"') {
        doubleQuoted = false;
      }
      continue;
    }

    if (source.startsWith("--", index)) {
      current += "--";
      index += 2;
      lineComment = true;
      continue;
    }
    if (source.startsWith("/*", index)) {
      current += "/*";
      index += 2;
      blockComment = true;
      continue;
    }
    if (source[index] === "'") {
      singleQuoted = true;
      current += source[index++];
      continue;
    }
    if (source[index] === '"') {
      doubleQuoted = true;
      current += source[index++];
      continue;
    }
    if (source[index] === "$") {
      const match = /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/.exec(
        source.slice(index),
      );
      if (match) {
        dollarTag = match[0];
        current += dollarTag;
        index += dollarTag.length;
        continue;
      }
    }
    if (source[index] === ";") {
      current += ";";
      if (current.trim()) statements.push(current.trim());
      current = "";
      index += 1;
      continue;
    }
    current += source[index++];
  }

  if (current.trim()) statements.push(current.trim());
  return statements;
}

describe("role lifecycle migration statement diagnostic", () => {
  it("executes every top-level migration statement in order", async () => {
    const db = new PGlite();
    try {
      await db.exec("CREATE ROLE axora_app NOLOGIN");
      await applyMigrations(db, {
        through: "041_delegated_access_management.sql",
      });
      const statements = splitSql(await readFile(migrationUrl, "utf8"));
      expect(statements.length).toBeGreaterThan(20);
      for (const [statementIndex, statement] of statements.entries()) {
        try {
          await db.exec(statement);
        } catch (error) {
          console.error(
            `Migration 042 failed at top-level statement ${statementIndex + 1}:\n${statement.slice(0, 2_000)}`,
          );
          throw error;
        }
      }
    } finally {
      await db.close();
    }
  }, 30_000);
});
