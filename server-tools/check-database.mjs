import pg from "pg";
import { readFileSync } from "node:fs";

if (!process.env.DATABASE_URL) {
  process.exit(1);
}

const ssl = process.env.DATABASE_SSL === "false"
  ? false
  : process.env.DATABASE_SSL === "true"
    ? {
        rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== "false",
        ...(process.env.DATABASE_SSL_CA_FILE
          ? { ca: readFileSync(process.env.DATABASE_SSL_CA_FILE, "utf8") }
          : {}),
      }
    : undefined;

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 10_000,
  keepAlive: true,
  ssl,
});

try {
  await client.connect();
  await client.query("SELECT 1");
  console.log("Ubuntu database connection is ready.");
} catch {
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
