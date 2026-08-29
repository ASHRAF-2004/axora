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

export function slackIntegrationEnabled(env: NodeJS.ProcessEnv = process.env) {
  return integrationFlagEnabled(INTEGRATION_FLAGS.slack, env);
}

function readDedicatedSecret(
  fileVariable: string,
  inlineVariable: string,
  env: NodeJS.ProcessEnv,
) {
  const filename = env[fileVariable]?.trim();
  const inline = env[inlineVariable]?.trim();
  if (env.NODE_ENV === "production" && inline) {
    throw new Error("Production Slack credentials must be file-mounted.");
  }
  return filename
    ? fs.existsSync(filename) ? fs.readFileSync(filename, "utf8").trim() : ""
    : inline ?? "";
}

export interface SlackProviderConfiguration {
  appId: string;
  clientId: string;
  clientSecret: string;
  signingSecret: string;
  redirectUri: string;
  eventsUri: string;
}

export function slackProviderConfiguration(
  env: NodeJS.ProcessEnv = process.env,
): SlackProviderConfiguration {
  const appId = env.AXORA_SLACK_APP_ID?.trim() ?? "";
  const clientId = env.AXORA_SLACK_CLIENT_ID?.trim() ?? "";
  const clientSecret = readDedicatedSecret(
    "AXORA_SLACK_CLIENT_SECRET_FILE","AXORA_SLACK_CLIENT_SECRET",env,
  );
  const signingSecret = readDedicatedSecret(
    "AXORA_SLACK_SIGNING_SECRET_FILE","AXORA_SLACK_SIGNING_SECRET",env,
  );
  if (!/^A[A-Z0-9]{8,32}$/.test(appId)
    || !/^\d{6,20}\.\d{6,20}$/.test(clientId)
    || clientSecret.length < 24 || clientSecret.length > 512
    || /[\s\x00-\x1f\x7f]/.test(clientSecret)
    || !/^[0-9a-fA-F]{32,128}$/.test(signingSecret)) {
    throw new Error("Slack provider configuration is unavailable.");
  }
  const origin = integrationOrigin(env);
  return {
    appId,clientId,clientSecret,signingSecret,
    redirectUri: `${origin}/api/integrations/slack/oauth/callback`,
    eventsUri: `${origin}/api/integrations/slack/events`,
  };
}

export function slackProviderConfigured(env: NodeJS.ProcessEnv = process.env) {
  try {
    slackProviderConfiguration(env);
    return true;
  } catch {
    return false;
  }
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
