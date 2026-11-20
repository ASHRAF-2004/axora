// Emergency reset of a Platform Owner password when email recovery is not
// available. Runs inside the app image (see reset-owner-password.sh); reads the
// new password from stdin so it never appears in a process list or shell history.
// Uses the same Argon2id format as src/lib/password-policy.ts and the same
// updates as a normal password change (sessions are revoked).
import { argon2, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { promisify } from "node:util";
import pg from "pg";

const email = String(process.env.OWNER_EMAIL ?? "").trim().toLowerCase();
const password = readFileSync(0, "utf8").replace(/\r?\n$/, "");
const length = [...password].length;
if (!email || length < 15 || length > 128) {
  console.error("Refused: give the owner email and a new password of 15-128 characters.");
  process.exit(1);
}

const salt = randomBytes(16);
const tag = await promisify(argon2)("argon2id", {
  message: Buffer.from(password, "utf8"), nonce: salt,
  memory: 65_536, passes: 3, parallelism: 1, tagLength: 32,
});
const b64 = (value) => value.toString("base64").replace(/=+$/, "");
const hash = `$argon2id$v=19$m=65536,t=3,p=1$${b64(salt)}$${b64(tag)}`;

const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: false });
await client.connect();
try {
  await client.query("BEGIN");
  await client.query("SELECT set_config('axora.change_reason',$1,true)",
    ["Emergency platform owner password reset from the server console"]);
  const user = await client.query(
    `UPDATE users SET password_hash=$2,auth_version=auth_version+1
     WHERE lower(email)=$1 AND is_owner AND active AND account_status='ACTIVE'
     RETURNING id::text,auth_version::int AS "authVersion"`, [email, hash]);
  if (user.rowCount !== 1) throw new Error("No active platform owner has that email.");
  const { id, authVersion } = user.rows[0];
  await client.query(
    `UPDATE account_credentials SET password_hash=$2,password_algorithm='argon2id',
       password_changed_at=now(),failed_sign_in_count=0,first_failed_sign_in_at=NULL,
       locked_until=NULL,credential_version=$3
     WHERE user_id=$1`, [id, hash, authVersion]);
  await client.query(
    `UPDATE user_sessions SET revoked_at=now(),revoked_by=$1,revoke_reason='password_changed'
     WHERE user_id=$1 AND revoked_at IS NULL`, [id]);
  await client.query("COMMIT");
  console.log(`Password reset for ${email}. All of its sessions were signed out.`);
} catch (error) {
  await client.query("ROLLBACK").catch(() => {});
  console.error(`Refused: ${error.message}`);
  process.exitCode = 1;
} finally {
  await client.end();
}
