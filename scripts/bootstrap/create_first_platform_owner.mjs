#!/usr/bin/env node

import {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
} from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import pg from "pg";

const REQUIRED_MIGRATION = "032_user_session_revocation_audit.sql";
const MIGRATIONS_DIRECTORY = fileURLToPath(
  new URL("../../database/migrations/", import.meta.url),
);
const PENDING_ACCOUNT_PASSWORD_HASH =
  "$2b$12$WuY.R47gEaitrj7J5zwZzutoX6T8co.PmnoE28TzRlWv93Cmxd0By";
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CONTROL_PATTERN = /[\u0000-\u001F\u007F]/;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const TOKEN_HASH_PATTERN = /^[0-9a-f]{64}$/;
const MINIMUM_SERVICE_SECRET_LENGTH = 32;
const MAXIMUM_SERVICE_SECRET_LENGTH = 4_096;
const DEFAULT_TTL_HOURS = 24;
const MAXIMUM_TTL_HOURS = 24 * 7;

const USAGE = `Usage:
  node scripts/bootstrap/create_first_platform_owner.mjs \\
    --email owner@example.com \\
    --display-name "Owner name" \\
    --locale en \\
    --operator "operator identity" \\
    --reason "Approved initial platform bootstrap" \\
    --confirm-first-platform-owner

  To replace an unconsumed first-owner invitation after delivery failure, use
  the same command and identity fields plus:

    --replace-pending-first-owner-invitation

This command never accepts a password and never prints the one-time setup token.`;

export function parseBootstrapArguments(argv) {
  const values = {};
  const booleanFlags = new Set([
    "confirm-first-platform-owner",
    "replace-pending-first-owner-invitation",
  ]);
  const valueFlags = new Set(["email", "display-name", "locale", "operator", "reason"]);
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help") return { help: true };
    if (!argument.startsWith("--") || argument.includes("=")) {
      throw new Error("Arguments must use separate, named --flag value pairs.");
    }
    const name = argument.slice(2);
    if (booleanFlags.has(name)) {
      if (values[name] !== undefined) throw new Error(`Duplicate argument: --${name}`);
      values[name] = true;
      continue;
    }
    if (!valueFlags.has(name)) throw new Error(`Unknown argument: --${name}`);
    if (values[name] !== undefined) throw new Error(`Duplicate argument: --${name}`);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`Missing value for --${name}`);
    }
    values[name] = value;
    index += 1;
  }
  return values;
}

function boundedText(value, label, minimum, maximum) {
  const normalized = String(value ?? "").normalize("NFKC").trim();
  if (
    normalized.length < minimum
    || normalized.length > maximum
    || CONTROL_PATTERN.test(normalized)
  ) {
    throw new Error(`${label} is invalid.`);
  }
  return normalized;
}

export function validateBootstrapArguments(parsed) {
  if (parsed.help) return parsed;
  if (parsed["confirm-first-platform-owner"] !== true) {
    throw new Error("Explicit --confirm-first-platform-owner acknowledgement is required.");
  }
  const email = boundedText(parsed.email, "Email", 3, 254).toLowerCase();
  if (!EMAIL_PATTERN.test(email)) throw new Error("Email is invalid.");
  const displayName = boundedText(parsed["display-name"], "Display name", 2, 200);
  const locale = boundedText(parsed.locale, "Locale", 2, 2).toLowerCase();
  if (!["en", "ar", "ms"].includes(locale)) {
    throw new Error("Locale must be en, ar, or ms for the account-setup email.");
  }
  const operatorIdentity = boundedText(parsed.operator, "Operator identity", 3, 200);
  const reason = boundedText(parsed.reason, "Bootstrap reason", 10, 500);
  return {
    email,
    displayName,
    locale,
    operatorIdentity,
    reason,
    replacePending: parsed["replace-pending-first-owner-invitation"] === true,
  };
}

function accountSetupTtlHours(env = process.env) {
  const value = String(env.ACCOUNT_SETUP_TTL_HOURS ?? DEFAULT_TTL_HOURS);
  if (!/^[0-9]+$/.test(value)) throw new Error("ACCOUNT_SETUP_TTL_HOURS is invalid.");
  const hours = Number.parseInt(value, 10);
  if (hours < 1 || hours > MAXIMUM_TTL_HOURS) {
    throw new Error("ACCOUNT_SETUP_TTL_HOURS must be between 1 and 168.");
  }
  return hours;
}

async function accountEmailServiceSecret(env = process.env) {
  const filename = String(env.AXORA_EMAIL_SERVICE_AUTH_KEY_FILE ?? "").trim();
  if (!filename) throw new Error("AXORA_EMAIL_SERVICE_AUTH_KEY_FILE is required.");
  try {
    const metadata = await lstat(filename);
    if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error("unsafe_secret_file");
    const value = (await readFile(filename, "utf8")).trim();
    if (
      value.length < MINIMUM_SERVICE_SECRET_LENGTH
      || value.length > MAXIMUM_SERVICE_SECRET_LENGTH
      || /[\s\u0000-\u001F\u007F]/.test(value)
    ) {
      throw new Error("unsafe_secret_value");
    }
    return value;
  } catch {
    throw new Error("The private account-email service key is unavailable.");
  }
}

function accountEmailSenderUrl(env = process.env) {
  const configured = String(
    env.AXORA_EMAIL_SENDER_URL ?? "http://email-sender:3100",
  ).trim();
  const parsed = new URL(configured);
  if (parsed.protocol !== "http:" || parsed.hostname !== "email-sender"
    || parsed.username || parsed.password || parsed.search || parsed.hash
    || (parsed.pathname !== "/" && parsed.pathname !== "")) {
    throw new Error("AXORA_EMAIL_SENDER_URL must point to the private email-sender service.");
  }
  return parsed;
}

function accountSetupUrl(rawToken, env = process.env) {
  const parsed = new URL(String(env.APP_BASE_URL ?? "https://axora.management"));
  if (parsed.protocol !== "https:" || parsed.username || parsed.password
    || parsed.pathname !== "/" || parsed.search || parsed.hash) {
    throw new Error("APP_BASE_URL must be the canonical Axora HTTPS origin.");
  }
  const url = new URL("/account/setup", parsed);
  url.hash = new URLSearchParams({ token: rawToken }).toString();
  return url.toString();
}

function serviceSigningKey(secret) {
  return createHash("sha256")
    .update("axora-account-email-service-auth-v1\0", "utf8")
    .update(secret, "utf8")
    .digest();
}

function signedServiceHeaders(method, pathname, body, secret) {
  const timestamp = String(Math.floor(Date.now() / 1_000));
  const requestId = randomUUID();
  const bodyHash = createHash("sha256").update(body, "utf8").digest("hex");
  const canonical = [timestamp, requestId, method, pathname, bodyHash].join("\n");
  const signature = createHmac("sha256", serviceSigningKey(secret))
    .update(canonical, "utf8")
    .digest("base64url");
  return {
    "X-Axora-Email-Timestamp": timestamp,
    "X-Axora-Email-Request-Id": requestId,
    "X-Axora-Email-Signature": signature,
  };
}

async function assertEmailSenderReady(env, fetchImpl = globalThis.fetch) {
  if (String(env.AXORA_EMAIL_DELIVERY_ENABLED ?? "false") !== "true") {
    throw new Error("Account email delivery must be enabled before first-owner bootstrap.");
  }
  const readyUrl = new URL("/health/ready", accountEmailSenderUrl(env));
  let response;
  try {
    response = await fetchImpl(readyUrl, {
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    throw new Error("The private account-email sender is unavailable.");
  }
  if (!response.ok) throw new Error("The private account-email sender is not ready.");
  const status = await response.json().catch(() => undefined);
  if (status?.status !== "ready") {
    throw new Error("The private account-email sender is not ready.");
  }
}

async function deliverBootstrapInvitation(payload, {
  env = process.env,
  secret,
  fetchImpl = globalThis.fetch,
} = {}) {
  const endpoint = new URL("/v1/account-setup", accountEmailSenderUrl(env));
  const body = JSON.stringify({
    deliveryId: payload.invitationId,
    recipientName: payload.displayName,
    recipientEmail: payload.email,
    companyName: "Axora",
    role: "PLATFORM_OWNER",
    expiresAt: payload.expiresAt,
    locale: payload.locale,
    setupUrl: accountSetupUrl(payload.rawToken, env),
  });
  let response;
  try {
    response = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...signedServiceHeaders("POST", endpoint.pathname, body, secret),
      },
      body,
      signal: AbortSignal.timeout(18_000),
    });
  } catch {
    return { status: "UNCERTAIN" };
  }
  const result = await response.json().catch(() => undefined);
  if (response.ok && result?.succeeded === true
    && ["delivered", "queued"].includes(String(result.status))) {
    const messageId = typeof result.messageId === "string"
      && result.messageId.length <= 255 && !/[\r\n]/.test(result.messageId)
      ? result.messageId
      : undefined;
    return { status: "SENT", ...(messageId ? { messageId } : {}) };
  }
  return { status: result?.disposition === "uncertain" || response.status >= 500
    ? "UNCERTAIN" : "FAILED" };
}

export function prepareSetupToken() {
  const rawToken = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(rawToken, "utf8").digest("hex");
  if (!TOKEN_PATTERN.test(rawToken) || !TOKEN_HASH_PATTERN.test(tokenHash)) {
    throw new Error("Secure setup token generation failed.");
  }
  return { rawToken, tokenHash };
}

async function expectedMigrations() {
  const filenames = (await readdir(MIGRATIONS_DIRECTORY))
    .filter((filename) => /^[0-9]{3}_[A-Za-z0-9._-]+\.sql$/.test(filename))
    .sort();
  const lastRequired = filenames.indexOf(REQUIRED_MIGRATION);
  if (lastRequired < 0) throw new Error(`Required migration is missing: ${REQUIRED_MIGRATION}`);
  return Promise.all(filenames.slice(0, lastRequired + 1).map(async (filename) => ({
    filename,
    sha256: createHash("sha256")
      .update(await readFile(resolve(MIGRATIONS_DIRECTORY, filename)))
      .digest("hex"),
  })));
}

async function assertNormalizedMigrations(client, expected) {
  let result;
  try {
    result = await client.query(
      "SELECT filename,sha256 FROM schema_migrations WHERE filename=ANY($1::text[])",
      [expected.map((migration) => migration.filename)],
    );
  } catch {
    throw new Error("The normalized Axora migrations have not been applied.");
  }
  const recorded = new Map(result.rows.map((row) => [row.filename, row.sha256]));
  for (const migration of expected) {
    if (recorded.get(migration.filename) !== migration.sha256) {
      throw new Error(`Migration is absent or has a checksum mismatch: ${migration.filename}`);
    }
  }
}

async function sslConfiguration(env = process.env) {
  if (env.DATABASE_SSL === "false") return false;
  if (env.DATABASE_SSL !== "true") return undefined;
  const caFilename = String(env.DATABASE_SSL_CA_FILE ?? "").trim();
  return {
    rejectUnauthorized: env.DATABASE_SSL_REJECT_UNAUTHORIZED !== "false",
    ...(caFilename ? { ca: await readFile(caFilename, "utf8") } : {}),
  };
}

async function connectClient(env = process.env) {
  const connectionString = String(env.DATABASE_URL ?? "").trim();
  if (!connectionString) throw new Error("DATABASE_URL is required; implicit database targets are forbidden.");
  const client = new pg.Client({
    connectionString,
    ssl: await sslConfiguration(env),
  });
  await client.connect();
  return client;
}

async function lockBootstrapScopes(client) {
  const locks = await client.query(`SELECT
    pg_try_advisory_xact_lock(
      hashtextextended(current_database() || ':axora:schema_migrations', 0)
    ) AS migration_lock,
    pg_try_advisory_xact_lock(
      hashtextextended(current_database() || ':axora:first_platform_owner', 0)
    ) AS bootstrap_lock`);
  if (!locks.rows[0]?.migration_lock || !locks.rows[0]?.bootstrap_lock) {
    throw new Error("A migration or first-owner bootstrap is already running.");
  }
  await client.query(
    "LOCK TABLE users, role_assignments, account_setup_invitations IN SHARE ROW EXCLUSIVE MODE",
  );
}

async function assertNoOwnerOrInflightOwner(client) {
  const result = await client.query(`SELECT
    EXISTS(SELECT 1 FROM users WHERE is_owner=true) AS owner_exists,
    EXISTS(
      SELECT 1 FROM role_assignments assignment
      JOIN roles role ON role.id=assignment.role_id
      WHERE role.role_key='PLATFORM_OWNER' AND assignment.active=true
    ) AS owner_assignment_exists,
    EXISTS(
      SELECT 1 FROM account_setup_invitations invitation
      JOIN roles role ON role.id=invitation.intended_role_id
      WHERE role.role_key='PLATFORM_OWNER'
        AND invitation.consumed_at IS NULL AND invitation.revoked_at IS NULL
    ) AS owner_invitation_exists`);
  const state = result.rows[0];
  if (state?.owner_exists || state?.owner_assignment_exists || state?.owner_invitation_exists) {
    throw new Error(
      "A platform owner or in-flight owner invitation already exists; recovery is a separate procedure.",
    );
  }
}

async function recordBootstrapDelivery(client, invitationId, delivery) {
  await client.query("BEGIN");
  let transactionOpen = true;
  try {
    await client.query(
      "SELECT set_config('axora.change_reason',$1,true)",
      [`First platform owner invitation delivery ${delivery.status.toLowerCase()}`],
    );
    const recorded = await client.query(
      `UPDATE account_setup_invitations
       SET delivery_status=$2,delivery_attempt_count=1,
           delivery_attempted_at=now(),
           sent_at=CASE WHEN $2='SENT' THEN now() ELSE NULL END,
           provider_message_id=CASE WHEN $2='SENT' THEN $3 ELSE NULL END,
           last_delivery_error=CASE
             WHEN $2='SENT' THEN NULL
             WHEN $2='UNCERTAIN' THEN 'delivery_uncertain'
             ELSE 'delivery_failed'
           END
       WHERE id=$1 AND delivery_status='SENDING'
       RETURNING id`,
      [invitationId, delivery.status, delivery.messageId ?? null],
    );
    if (recorded.rowCount !== 1) {
      throw new Error("The first-owner invitation delivery result could not be recorded.");
    }
    await client.query("COMMIT");
    transactionOpen = false;
  } catch (error) {
    if (transactionOpen) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // The caller closes the connection and reports the recovery requirement.
      }
    }
    throw error;
  }
}

async function claimBootstrapDelivery(client, invitationId) {
  await client.query("BEGIN");
  let transactionOpen = true;
  try {
    await client.query(
      "SELECT set_config('axora.change_reason',$1,true)",
      ["First platform owner invitation delivery claimed"],
    );
    const claimed = await client.query(
      `UPDATE account_setup_invitations
       SET delivery_status='SENDING',delivery_attempt_count=1,
           delivery_attempted_at=now(),last_delivery_error=NULL
       WHERE id=$1 AND delivery_status='PENDING'
       RETURNING id`,
      [invitationId],
    );
    if (claimed.rowCount !== 1) {
      throw new Error("The first-owner invitation delivery could not be claimed.");
    }
    await client.query("COMMIT");
    transactionOpen = false;
  } catch (error) {
    if (transactionOpen) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // The caller closes the connection and reports the recovery requirement.
      }
    }
    throw error;
  }
}

export async function createFirstPlatformOwner(
  input,
  { env = process.env, dependencies = {} } = {},
) {
  const loadExpectedMigrations = dependencies.expectedMigrations ?? expectedMigrations;
  const loadServiceSecret = dependencies.accountEmailServiceSecret
    ?? accountEmailServiceSecret;
  const openClient = dependencies.connectClient ?? connectClient;
  const checkEmailSender = dependencies.assertEmailSenderReady
    ?? assertEmailSenderReady;
  const deliverInvitation = dependencies.deliverBootstrapInvitation
    ?? deliverBootstrapInvitation;
  const expected = await loadExpectedMigrations();
  const secret = await loadServiceSecret(env);
  await checkEmailSender(env, dependencies.fetchImpl ?? globalThis.fetch);
  const invitationId = randomUUID();
  const preparedToken = prepareSetupToken();
  // Validate every delivery endpoint before mutating the empty baseline.
  accountSetupUrl(preparedToken.rawToken, env);
  const ttlHours = accountSetupTtlHours(env);
  const client = await openClient(env);
  let transactionOpen = false;
  try {
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    transactionOpen = true;
    await lockBootstrapScopes(client);
    await assertNormalizedMigrations(client, expected);
    await client.query(
      "SELECT set_config('axora.change_reason',$1,true)",
      [`First platform owner bootstrap: ${input.reason}`],
    );
    await assertNoOwnerOrInflightOwner(client);
    const duplicate = await client.query(
      "SELECT 1 FROM users WHERE lower(email)=lower($1) LIMIT 1",
      [input.email],
    );
    if (duplicate.rowCount) throw new Error("The requested sign-in email already exists.");

    const role = await client.query(
      "SELECT id::text FROM roles WHERE role_key='PLATFORM_OWNER' FOR KEY SHARE",
    );
    if (role.rowCount !== 1) throw new Error("The normalized PLATFORM_OWNER role is unavailable.");
    const roleId = role.rows[0].id;
    const user = await client.query(
      `INSERT INTO users(
         email,display_name,password_hash,role_id,active,is_owner,
         company_id,branch_id,account_setup_completed_at,auth_version,
         account_kind,account_status,email_verified_at
       ) VALUES ($1,$2,$3,$4,true,true,NULL,NULL,NULL,1,'PLATFORM','INVITED',NULL)
       RETURNING id::text`,
      [input.email, input.displayName, PENDING_ACCOUNT_PASSWORD_HASH, roleId],
    );
    const userId = user.rows[0].id;
    await client.query(
      `INSERT INTO user_profiles(user_id,display_name,preferred_locale)
       VALUES ($1,$2,$3)`,
      [userId, input.displayName, input.locale],
    );
    await client.query(
      `INSERT INTO account_credentials(user_id,password_hash,password_algorithm)
       VALUES ($1,NULL,NULL)`,
      [userId],
    );
    await client.query(
      `INSERT INTO role_assignments(
         user_id,role_id,scope_type,company_id,branch_id,active,assigned_by
       ) VALUES ($1,$2,'PLATFORM',NULL,NULL,true,NULL)`,
      [userId, roleId],
    );
    await client.query(
      `INSERT INTO onboarding_progress(user_id,profile_stage_status)
       VALUES ($1,'NOT_STARTED')`,
      [userId],
    );
    const invitation = await client.query(
      `INSERT INTO account_setup_invitations(
         id,user_id,company_id,token_hash,expires_at,created_by,
         email_locale,
         intended_role_id,intended_branch_id,intended_scope_type,intended_supplier_id
       ) VALUES (
         $1,$2,NULL,$3,now()+make_interval(hours => $4::integer),NULL,
         $5,$6,NULL,'PLATFORM',NULL
       ) RETURNING id::text,expires_at::text AS expires_at`,
      [
        invitationId,
        userId,
        preparedToken.tokenHash,
        ttlHours,
        input.locale,
        roleId,
      ],
    );
    await client.query(
      `INSERT INTO platform_owner_bootstrap_audits(
         invitation_id,user_id,operator_identity,reason
       ) VALUES ($1,$2,$3,$4)`,
      [invitationId, userId, input.operatorIdentity, input.reason],
    );
    await client.query("COMMIT");
    transactionOpen = false;
    const expiresAt = invitation.rows[0].expires_at;
    await claimBootstrapDelivery(client, invitationId);
    const delivery = await deliverInvitation({
      invitationId,
      displayName: input.displayName,
      email: input.email,
      expiresAt,
      locale: input.locale,
      rawToken: preparedToken.rawToken,
    }, {
      env,
      secret,
      fetchImpl: dependencies.fetchImpl ?? globalThis.fetch,
    });
    await recordBootstrapDelivery(client, invitationId, delivery);
    return {
      userId,
      invitationId,
      expiresAt,
      deliveryStatus: delivery.status,
    };
  } catch (error) {
    if (transactionOpen) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // Closing the connection below also releases locks and aborts state.
      }
    }
    throw error;
  } finally {
    await client.end();
  }
}

export async function replacePendingFirstPlatformOwnerInvitation(
  input,
  { env = process.env, dependencies = {} } = {},
) {
  const loadExpectedMigrations = dependencies.expectedMigrations ?? expectedMigrations;
  const loadServiceSecret = dependencies.accountEmailServiceSecret
    ?? accountEmailServiceSecret;
  const openClient = dependencies.connectClient ?? connectClient;
  const checkEmailSender = dependencies.assertEmailSenderReady
    ?? assertEmailSenderReady;
  const deliverInvitation = dependencies.deliverBootstrapInvitation
    ?? deliverBootstrapInvitation;
  const expected = await loadExpectedMigrations();
  const secret = await loadServiceSecret(env);
  await checkEmailSender(env, dependencies.fetchImpl ?? globalThis.fetch);
  const invitationId = randomUUID();
  const preparedToken = prepareSetupToken();
  accountSetupUrl(preparedToken.rawToken, env);
  const ttlHours = accountSetupTtlHours(env);
  const client = await openClient(env);
  let transactionOpen = false;
  try {
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    transactionOpen = true;
    await lockBootstrapScopes(client);
    await assertNormalizedMigrations(client, expected);
    await client.query(
      "SELECT set_config('axora.change_reason',$1,true)",
      [`First platform owner invitation replaced: ${input.reason}`],
    );
    const owner = await client.query(
      `SELECT account.id::text,account.display_name,role.id::text AS role_id
       FROM users account
       JOIN account_credentials credential ON credential.user_id=account.id
       JOIN role_assignments assignment
         ON assignment.user_id=account.id
        AND assignment.scope_type='PLATFORM'
        AND assignment.company_id IS NULL
        AND assignment.branch_id IS NULL
        AND assignment.supplier_id IS NULL
        AND assignment.active=true
       JOIN roles role ON role.id=assignment.role_id
       WHERE lower(account.email)=lower($1)
         AND account.display_name=$2
         AND account.is_owner=true
         AND account.account_kind='PLATFORM'
         AND account.account_status='INVITED'
         AND account.active=true
         AND account.account_setup_completed_at IS NULL
         AND credential.password_hash IS NULL
         AND role.role_key='PLATFORM_OWNER'
       FOR UPDATE OF account`,
      [input.email, input.displayName],
    );
    if (owner.rowCount !== 1) {
      throw new Error(
        "Exactly one matching invited first platform owner is required for recovery.",
      );
    }
    const userId = owner.rows[0].id;
    const current = await client.query(
      `SELECT invitation.id::text
       FROM account_setup_invitations invitation
       WHERE invitation.user_id=$1
         AND invitation.company_id IS NULL
         AND invitation.intended_scope_type='PLATFORM'
         AND invitation.intended_role_id=$2
         AND invitation.consumed_at IS NULL
         AND invitation.revoked_at IS NULL
       ORDER BY invitation.created_at DESC,invitation.id
       FOR UPDATE`,
      [userId, owner.rows[0].role_id],
    );
    if (current.rowCount !== 1) {
      throw new Error("Exactly one live first-owner invitation is required for recovery.");
    }
    await client.query(
      "UPDATE account_setup_invitations SET revoked_at=now() WHERE id=$1",
      [current.rows[0].id],
    );
    const invitation = await client.query(
      `INSERT INTO account_setup_invitations(
         id,user_id,company_id,token_hash,expires_at,created_by,email_locale,
         intended_role_id,intended_branch_id,intended_scope_type,intended_supplier_id
       ) VALUES (
         $1,$2,NULL,$3,now()+make_interval(hours => $4::integer),NULL,$5,
         $6,NULL,'PLATFORM',NULL
       ) RETURNING expires_at::text AS expires_at`,
      [
        invitationId,
        userId,
        preparedToken.tokenHash,
        ttlHours,
        input.locale,
        owner.rows[0].role_id,
      ],
    );
    await client.query(
      `INSERT INTO platform_owner_bootstrap_audits(
         invitation_id,user_id,operator_identity,reason
       ) VALUES ($1,$2,$3,$4)`,
      [invitationId, userId, input.operatorIdentity, input.reason],
    );
    await client.query("COMMIT");
    transactionOpen = false;
    const expiresAt = invitation.rows[0].expires_at;
    await claimBootstrapDelivery(client, invitationId);
    const delivery = await deliverInvitation({
      invitationId,
      displayName: input.displayName,
      email: input.email,
      expiresAt,
      locale: input.locale,
      rawToken: preparedToken.rawToken,
    }, {
      env,
      secret,
      fetchImpl: dependencies.fetchImpl ?? globalThis.fetch,
    });
    await recordBootstrapDelivery(client, invitationId, delivery);
    return {
      userId,
      invitationId,
      expiresAt,
      deliveryStatus: delivery.status,
      replacedInvitationId: current.rows[0].id,
    };
  } catch (error) {
    if (transactionOpen) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // Closing the connection below also releases locks and aborts state.
      }
    }
    throw error;
  } finally {
    await client.end();
  }
}

export async function main(argv = process.argv.slice(2)) {
  let parsed;
  try {
    parsed = parseBootstrapArguments(argv);
    if (parsed.help) {
      console.log(USAGE);
      return 0;
    }
    const input = validateBootstrapArguments(parsed);
    const result = input.replacePending
      ? await replacePendingFirstPlatformOwnerInvitation(input)
      : await createFirstPlatformOwner(input);
    console.log(input.replacePending
      ? "First platform owner invitation replaced with a fresh hash-only setup token."
      : "First platform owner invitation created with a hash-only setup token.");
    console.log(`User ID: ${result.userId}`);
    console.log(`Invitation ID: ${result.invitationId}`);
    if (result.replacedInvitationId) {
      console.log(`Revoked invitation ID: ${result.replacedInvitationId}`);
    }
    console.log(`Expires at: ${result.expiresAt}`);
    console.log(`Delivery status: ${result.deliveryStatus}`);
    console.log("No password was created and no setup token was printed.");
    if (result.deliveryStatus !== "SENT") {
      console.error(
        "The invitation was not confirmed delivered. Use the documented audited recovery procedure to replace it with a new token.",
      );
      return 2;
    }
    return 0;
  } catch (error) {
    console.error(`First platform owner bootstrap refused: ${error.message}`);
    return 1;
  }
}

const invokedDirectly = process.argv[1]
  && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (invokedDirectly) process.exitCode = await main();
