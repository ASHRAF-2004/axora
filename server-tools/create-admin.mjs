import { readFileSync } from "node:fs";
import { hash } from "bcryptjs";
import pg from "pg";

const [email, displayName] = process.argv.slice(2);
if (!email || !displayName) {
  console.error("Usage: node create-admin.mjs admin@example.com 'Admin name'");
  process.exit(2);
}

const passwordFile = process.env.ADMIN_PASSWORD_FILE || "/run/secrets/admin_initial_password";
const adminPassword = process.env.ADMIN_INITIAL_PASSWORD?.trim()
  || readFileSync(passwordFile, "utf8").trim();
const databasePassword = process.env.DATABASE_URL ? "" : process.env.DB_PASSWORD
  || readFileSync(process.env.DB_PASSWORD_FILE || "/run/secrets/axora_app_password", "utf8").trim();
if (adminPassword.length < 14) throw new Error("The initial admin password must be at least 14 characters.");

const client = new pg.Client(process.env.DATABASE_URL ? {
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: false },
} : {
  host: process.env.DB_HOST || "db",
  port: Number(process.env.DB_PORT || 5432),
  database: process.env.DB_NAME || "axora",
  user: process.env.DB_USER || "axora_app",
  password: databasePassword,
});

await client.connect();
try {
  const passwordHash = await hash(adminPassword, 12);
  const result = await client.query(
    `INSERT INTO users(email,display_name,password_hash,role_id,is_owner)
     VALUES ($1,$2,$3,(SELECT id FROM roles WHERE role_key='ADMIN'),true)
     ON CONFLICT ((lower(email))) DO UPDATE SET
       display_name=EXCLUDED.display_name,
       password_hash=EXCLUDED.password_hash,
       role_id=EXCLUDED.role_id,
       active=true,
       is_owner=true
     RETURNING id`,
    [email.toLowerCase(), displayName, passwordHash],
  );
  console.log(`Admin account prepared: ${email} (${result.rows[0].id})`);
} finally {
  await client.end();
}
