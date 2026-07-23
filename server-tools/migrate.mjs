import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import pg from "pg";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required for hosted migrations.");
}

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: false },
});
const migrationsDirectory = path.resolve("database/migrations");

await client.connect();
try {
  await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    filename text PRIMARY KEY,
    sha256 text NOT NULL,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`);

  const files = (await readdir(migrationsDirectory))
    .filter((filename) => /^[0-9]{3}_.*\.sql$/.test(filename))
    .sort();

  for (const filename of files) {
    const sql = await readFile(path.join(migrationsDirectory, filename), "utf8");
    const checksum = createHash("sha256").update(sql).digest("hex");
    const recorded = await client.query(
      "SELECT sha256 FROM schema_migrations WHERE filename=$1",
      [filename],
    );
    if (recorded.rows[0]) {
      if (recorded.rows[0].sha256 !== checksum) {
        throw new Error(`Migration checksum changed after application: ${filename}`);
      }
      console.log(`Migration already applied: ${filename}`);
      continue;
    }

    console.log(`Applying migration: ${filename}`);
    await client.query(sql);
    await client.query(
      "INSERT INTO schema_migrations(filename,sha256) VALUES ($1,$2)",
      [filename, checksum],
    );
  }
} finally {
  await client.end();
}
