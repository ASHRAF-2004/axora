import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const migrationsDirectory = new URL("../../database/migrations/", import.meta.url);
const demoSeedUrl = new URL("../../database/seeds/demo.sql", import.meta.url);

export async function migrationFiles() {
  return (await readdir(migrationsDirectory))
    .filter((filename) => /^[0-9]{3}_[A-Za-z0-9._-]+\.sql$/.test(filename))
    .sort();
}

export async function applyMigrations(
  db: PGlite,
  options: { through?: string } = {},
) {
  const filenames = await migrationFiles();
  const selected = options.through
    ? filenames.filter((filename) => filename <= options.through!)
    : filenames;

  for (const filename of selected) {
    await db.exec(
      await readFile(new URL(filename, migrationsDirectory), "utf8"),
    );
  }

  return selected;
}

export async function applyDemoSeed(db: PGlite) {
  const sql = await readFile(demoSeedUrl, "utf8");
  await db.exec(sql);
  return sql;
}

export async function createMigratedPGlite(options: { seed?: boolean } = {}) {
  const db = new PGlite();
  await applyMigrations(db);
  if (options.seed) await applyDemoSeed(db);
  return db;
}
