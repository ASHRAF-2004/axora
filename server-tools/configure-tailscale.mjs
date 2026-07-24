import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";

const OFFICIAL_API_BASE_URL = "https://api.tailscale.com/api/v2";
const API_TOKEN_PATTERN = /^tskey-api-([A-Za-z0-9]+)-[A-Za-z0-9]+$/;
const AUTH_KEY_PATTERN = /^tskey-auth-([A-Za-z0-9]+)-[A-Za-z0-9]+$/;

function redactSecrets(value) {
  return String(value).replace(
    /tskey-(?:api|auth)-[A-Za-z0-9_-]+/g,
    "[redacted Tailscale key]",
  );
}

async function readExistingAuthKey(target) {
  try {
    const key = (await readFile(target, "utf8")).trim();
    if (!AUTH_KEY_PATTERN.test(key)) {
      throw new Error(`${target} exists but does not contain a valid Tailscale auth key.`);
    }
    return key;
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function writeSecret(target, value) {
  await writeFile(target, `${value}\n`, { flag: "wx", mode: 0o600 });
  await chmod(target, 0o600);
}

export async function configureTailscale({
  apiToken,
  projectDir,
  apiBaseUrl = OFFICIAL_API_BASE_URL,
  log = console.log,
  warn = console.warn,
}) {
  const tokenMatch = API_TOKEN_PATTERN.exec(apiToken);
  if (!tokenMatch) {
    throw new Error("That does not look like a Tailscale API access token.");
  }
  const apiTokenId = tokenMatch[1];
  let activeToken = apiToken;

  async function apiRequest(route, options = {}) {
    let response;
    try {
      response = await fetch(`${apiBaseUrl}${route}`, {
        ...options,
        headers: {
          authorization: `Bearer ${activeToken}`,
          ...options.headers,
        },
        signal: AbortSignal.timeout(30_000),
      });
    } catch (error) {
      throw new Error(`Could not reach the Tailscale API: ${redactSecrets(error.message)}`);
    }

    const body = await response.text();
    if (!response.ok) {
      const safeBody = redactSecrets(body).replace(/\s+/g, " ").trim().slice(0, 500);
      throw new Error(
        `Tailscale API ${options.method || "GET"} ${route} failed `
        + `(${response.status})${safeBody ? `: ${safeBody}` : "."}`,
      );
    }
    return { body, response };
  }

  const policyPath = path.join(projectDir, "tailscale", "policy.hujson");
  const targetPolicy = await readFile(policyPath, "utf8");
  JSON.parse(targetPolicy);

  const currentPolicyResponse = await apiRequest("/tailnet/-/acl", {
    headers: { accept: "application/hujson" },
  });
  const etag = currentPolicyResponse.response.headers.get("etag");
  if (!etag) {
    throw new Error(
      "Tailscale did not provide the policy version needed for a safe update. "
      + "No policy or key was changed.",
    );
  }

  const backupsDir = path.join(projectDir, "backups");
  await mkdir(backupsDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const policyBackupPath = path.join(
    backupsDir,
    `tailscale-policy-before-axora-${timestamp}-${process.pid}.hujson`,
  );
  await writeFile(policyBackupPath, currentPolicyResponse.body, {
    flag: "wx",
    mode: 0o600,
  });
  log(`[Axora] Backed up the previous Tailscale policy to ${policyBackupPath}`);

  await apiRequest("/tailnet/-/acl/validate", {
    method: "POST",
    headers: { "content-type": "application/hujson" },
    body: targetPolicy,
  });

  await apiRequest("/tailnet/-/acl", {
    method: "POST",
    headers: {
      "content-type": "application/hujson",
      "if-match": etag,
    },
    body: targetPolicy,
  });

  const appliedPolicyResponse = await apiRequest("/tailnet/-/acl", {
    headers: { accept: "application/json" },
  });
  let appliedPolicy;
  try {
    appliedPolicy = JSON.parse(appliedPolicyResponse.body);
  } catch {
    throw new Error("Tailscale returned an invalid policy after the update.");
  }
  const expectedPolicy = JSON.parse(targetPolicy);
  for (const field of ["acls", "tagOwners", "grants", "tests"]) {
    if (!isDeepStrictEqual(appliedPolicy[field], expectedPolicy[field])) {
      throw new Error(
        `Tailscale's applied ${field} policy does not match Axora's protected policy.`,
      );
    }
  }
  log("[Axora] Applied and verified the private Axora-only Tailscale policy.");

  const secretsDir = path.join(projectDir, "secrets");
  await mkdir(secretsDir, { recursive: true, mode: 0o700 });
  await chmod(secretsDir, 0o700);

  async function ensureAuthKey({
    targetName,
    description,
    reusable,
    ephemeral,
    tag,
    expirySeconds,
  }) {
    const target = path.join(secretsDir, targetName);
    const createCapabilities = {
      devices: {
        create: {
          reusable,
          ephemeral,
          preauthorized: true,
          tags: [tag],
        },
      },
    };
    const existing = await readExistingAuthKey(target);
    if (existing) {
      const existingKeyId = AUTH_KEY_PATTERN.exec(existing)?.[1];
      const metadataResponse = await apiRequest(
        `/tailnet/-/keys/${encodeURIComponent(existingKeyId)}`,
      );
      let metadata;
      try {
        metadata = JSON.parse(metadataResponse.body);
      } catch {
        throw new Error(`Tailscale returned invalid metadata for ${targetName}.`);
      }
      const expiresAt = Date.parse(metadata.expires || "");
      const existingKeyIsExpected = metadata.keyType === "auth"
        && Number(metadata.expirySeconds) === expirySeconds
        && metadata.invalid !== true
        && Number.isFinite(expiresAt)
        && expiresAt > Date.now()
        && isDeepStrictEqual(metadata.capabilities, createCapabilities);
      if (!existingKeyIsExpected) {
        throw new Error(
          `${targetName} does not have Axora's required tag and key restrictions.`,
        );
      }
      log(`[Axora] Verified and kept the existing protected ${targetName}.`);
      return;
    }

    const keyResponse = await apiRequest("/tailnet/-/keys", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        keyType: "auth",
        capabilities: createCapabilities,
        description,
        expirySeconds,
      }),
    });

    let keyResult;
    try {
      keyResult = JSON.parse(keyResponse.body);
    } catch {
      throw new Error(`Tailscale returned an invalid response while creating ${description}.`);
    }
    const returnedKeyMatch = AUTH_KEY_PATTERN.exec(keyResult.key || "");
    const returnedExpiry = Date.parse(keyResult.expires || "");
    const responseIsExpected = typeof keyResult.id === "string"
      && /^[A-Za-z0-9]+$/.test(keyResult.id)
      && returnedKeyMatch?.[1] === keyResult.id
      && keyResult.keyType === "auth"
      && Number(keyResult.expirySeconds) === expirySeconds
      && Number.isFinite(returnedExpiry)
      && returnedExpiry > Date.now()
      && isDeepStrictEqual(keyResult.capabilities, createCapabilities)
      && Boolean(returnedKeyMatch);
    if (!responseIsExpected) {
      if (typeof keyResult.id === "string" && keyResult.id) {
        try {
          await apiRequest(`/tailnet/-/keys/${encodeURIComponent(keyResult.id)}`, {
            method: "DELETE",
          });
        } catch (error) {
          warn(
            `[Axora] WARNING: Revoke the rejected ${description} key on Tailscale's `
            + `Keys page. ${redactSecrets(error.message)}`,
          );
        }
      }
      throw new Error(`Tailscale did not return a usable key for ${description}.`);
    }

    try {
      await writeSecret(target, keyResult.key);
    } catch (error) {
      try {
        await apiRequest(`/tailnet/-/keys/${encodeURIComponent(keyResult.id)}`, {
          method: "DELETE",
        });
      } catch (cleanupError) {
        warn(
          `[Axora] WARNING: Revoke the orphaned ${description} key on Tailscale's `
          + `Keys page. ${redactSecrets(cleanupError.message)}`,
        );
      }
      throw error;
    }
    if (keyResult.expires) {
      try {
        await writeSecret(`${target}_expires`, String(keyResult.expires));
      } catch (error) {
        warn(
          `[Axora] WARNING: The key is protected, but its local expiry reminder `
          + `could not be saved: ${redactSecrets(error.message)}`,
        );
      }
    }
    log(`[Axora] Created and protected ${description}.`);
  }

  await ensureAuthKey({
    targetName: "tailscale_db_auth_key",
    description: "Axora Ubuntu database enrollment",
    reusable: false,
    ephemeral: false,
    tag: "tag:axora-db",
    expirySeconds: 86_400,
  });
  await ensureAuthKey({
    targetName: "tailscale_render_auth_key",
    description: "Axora Render private database connection",
    reusable: true,
    ephemeral: true,
    tag: "tag:axora-render",
    expirySeconds: 7_776_000,
  });

  let apiTokenRevoked = false;
  try {
    await apiRequest(`/tailnet/-/keys/${encodeURIComponent(apiTokenId)}`, {
      method: "DELETE",
    });
    apiTokenRevoked = true;
    log("[Axora] Revoked the temporary Tailscale API access token.");
  } catch (error) {
    warn(
      "[Axora] WARNING: The hybrid keys are ready, but automatic revocation failed. "
      + "Revoke the temporary API access token on Tailscale's Keys page. "
      + redactSecrets(error.message),
    );
  } finally {
    activeToken = "";
    apiToken = "";
  }

  return { apiTokenRevoked, policyBackupPath };
}

const invokedAsScript = process.argv[1]
  && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (invokedAsScript) {
  let apiToken = "";
  try {
    apiToken = readFileSync(3, "utf8").trim();
    await configureTailscale({
      apiToken,
      projectDir: process.cwd(),
    });
  } catch (error) {
    console.error(`[Axora] ERROR: ${redactSecrets(error.message)}`);
    process.exitCode = 1;
  } finally {
    apiToken = "";
  }
}
