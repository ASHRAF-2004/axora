import fs from "node:fs";

export const INTEGRATION_FLAGS = {
  externalApi: "AXORA_EXTERNAL_API_ENABLED",
  webhooks: "AXORA_INTEGRATION_WEBHOOKS_ENABLED",
  zapier: "AXORA_ZAPIER_ENABLED",
  slack: "AXORA_SLACK_ENABLED",
} as const;

export const INTEGRATION_PROVIDER_APPLICATION_SLUGS = {
  zapier: "axora-zapier",
  slack: "axora-slack",
} as const;

export function integrationFlagEnabled(
  flag: (typeof INTEGRATION_FLAGS)[keyof typeof INTEGRATION_FLAGS],
  env: NodeJS.ProcessEnv = process.env,
) {
  return env[flag] === "true";
}

export function externalApiEnabled(env: NodeJS.ProcessEnv = process.env) {
  return integrationFlagEnabled(INTEGRATION_FLAGS.externalApi, env);
}

export function integrationWebhooksEnabled(env: NodeJS.ProcessEnv = process.env) {
  return integrationFlagEnabled(INTEGRATION_FLAGS.webhooks, env);
}

export function integrationApplicationEnabled(
  applicationSlug: string,
  env: NodeJS.ProcessEnv = process.env,
) {
  if (applicationSlug === INTEGRATION_PROVIDER_APPLICATION_SLUGS.zapier) {
    return integrationFlagEnabled(INTEGRATION_FLAGS.zapier, env);
  }
  if (applicationSlug === INTEGRATION_PROVIDER_APPLICATION_SLUGS.slack) {
    return integrationFlagEnabled(INTEGRATION_FLAGS.slack, env);
  }
  return true;
}

export function integrationOrigin(env: NodeJS.ProcessEnv = process.env) {
  const configured = (env.APP_BASE_URL ?? "https://axora.management").trim();
  let origin: URL;
  try {
    origin = new URL(configured);
  } catch {
    throw new Error("APP_BASE_URL must be a valid absolute URL.");
  }
  if (origin.pathname !== "/" || origin.search || origin.hash
    || (env.NODE_ENV === "production" && origin.protocol !== "https:")) {
    throw new Error("APP_BASE_URL must be a canonical HTTPS origin.");
  }
  return origin.origin;
}

let cachedKey: Buffer | undefined;
let cachedSource: string | undefined;

export function integrationRootKey(env: NodeJS.ProcessEnv = process.env) {
  const filename = env.AXORA_INTEGRATION_ENCRYPTION_KEY_FILE?.trim();
  const inline = env.AXORA_INTEGRATION_ENCRYPTION_KEY?.trim();
  if (env.NODE_ENV === "production" && inline) {
    throw new Error("Production integration encryption material must be file-mounted.");
  }
  const source = filename ? `file:${filename}` : inline ? `inline:${inline}` : "missing";
  if (cachedKey && cachedSource === source) return cachedKey;

  const encoded = filename
    ? fs.existsSync(filename) ? fs.readFileSync(filename, "utf8").trim() : ""
    : inline ?? "";
  if (encoded.length < 43 || encoded.length > 512) {
    throw new Error("Dedicated integration encryption material is unavailable.");
  }
  let value: Buffer;
  try {
    value = Buffer.from(encoded, "base64url");
  } catch {
    throw new Error("Dedicated integration encryption material is invalid.");
  }
  if (value.byteLength < 32) {
    throw new Error("Dedicated integration encryption material is too short.");
  }
  cachedKey = value;
  cachedSource = source;
  return cachedKey;
}

export const integrationConfigInternals = {
  clearKeyCache() {
    cachedKey = undefined;
    cachedSource = undefined;
  },
};
