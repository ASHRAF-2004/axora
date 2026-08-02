#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { renderAccountSetupEmail } from "../../server-tools/account-setup-email.mjs";
import { renderTransactionalEmail } from "../../server-tools/transactional-email.mjs";

const LOCALES = new Set(["en", "ar", "ms"]);
const TEMPLATES = new Set([
  "account-setup",
  "password-reset",
  "email-verification",
  "contact-notification",
  "workflow-update",
]);
const PREVIEW_RECIPIENT = "preview@axora.test";
const PREVIEW_FROM = { Email: "noreply@axora.management", Name: "Axora" };
const PREVIEW_REPLY_TO = [{ Email: "support@axora.management", Name: "Axora support" }];
const TOKEN = "P".repeat(43);

function parseArguments(argv) {
  const options = { locale: "en", template: "account-setup" };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--locale") options.locale = argv[++index];
    else if (argument === "--template") options.template = argv[++index];
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!LOCALES.has(options.locale)) throw new Error("Locale must be en, ar, or ms.");
  if (!TEMPLATES.has(options.template)) {
    throw new Error(`Template must be one of: ${[...TEMPLATES].join(", ")}.`);
  }
  return options;
}

function previewEndpoint(env = process.env) {
  const port = String(env.MAILPIT_PREVIEW_PORT ?? "8025");
  const portNumber = Number(port);
  if (!/^\d{1,5}$/.test(port) || !Number.isInteger(portNumber)
    || portNumber < 1 || portNumber > 65_535) {
    throw new Error("MAILPIT_PREVIEW_PORT is invalid.");
  }
  return new URL(`http://127.0.0.1:${port}/api/v1/send`);
}

async function attachment(contentId, filename, url) {
  const bytes = await readFile(url);
  if (!bytes.length) throw new Error(`Preview asset is empty: ${filename}`);
  return {
    Content: bytes.toString("base64"),
    ContentID: contentId,
    ContentType: "image/png",
    Filename: filename,
  };
}

async function renderPreview({ locale, template }) {
  if (template === "account-setup") {
    const rendered = await renderAccountSetupEmail({
      recipientName: "Axora Preview User",
      recipientEmail: PREVIEW_RECIPIENT,
      companyName: "Example Company",
      role: "COMPANY_ADMIN",
      branchName: "Example Branch",
      expiresAt: "2030-01-02T03:04:00.000Z",
      setupUrl: `https://axora.management/account/setup#token=${TOKEN}`,
      locale,
    });
    return {
      rendered,
      attachments: await Promise.all([
        attachment("axora-logo", "axora-email.png", new URL("../../public/brand/axora-email.png", import.meta.url)),
        attachment("account-envelope", "account-envelope.png", new URL("../../public/email/account-setup/account-envelope.png", import.meta.url)),
      ]),
    };
  }

  if (template === "contact-notification") {
    const rendered = await renderTransactionalEmail({
      deliveryId: "00000000-0000-4000-8000-000000000002",
      messageKind: "CONTACT_NOTIFICATION",
      locale,
      recipientEmail: "contact-team@axora.test",
      recipientName: "Axora contact team",
      contact: {
        name: "Axora Preview Contact",
        email: "contact@company.test",
        company: "Example Company",
        phone: "+60 12 345 6789",
        subject: "Procurement consultation",
        message: "Please contact us about a controlled procurement rollout.",
        submittedAt: "2030-01-02T03:04:00.000Z",
      },
    });
    return {
      rendered,
      attachments: [await attachment("axora-logo", "axora-email.png", new URL("../../public/brand/axora-email.png", import.meta.url))],
    };
  }

  if (template === "workflow-update") {
    const rendered = await renderTransactionalEmail({
      deliveryId: "00000000-0000-4000-8000-000000000003",
      messageKind: "WORKFLOW_UPDATE",
      locale,
      recipientEmail: PREVIEW_RECIPIENT,
      recipientName: "Axora Preview User",
      workflow: {
        title: "Purchase request approved",
        body: "Your purchase request moved to Axora sourcing.",
        actionPath: "/notifications",
      },
    });
    return {
      rendered,
      attachments: [await attachment("axora-logo", "axora-email.png", new URL("../../public/brand/axora-email.png", import.meta.url))],
    };
  }

  const passwordReset = template === "password-reset";
  const rendered = await renderTransactionalEmail({
    deliveryId: "00000000-0000-4000-8000-000000000001",
    messageKind: passwordReset ? "PASSWORD_RESET" : "EMAIL_VERIFICATION",
    locale,
    recipientEmail: PREVIEW_RECIPIENT,
    recipientName: "Axora Preview User",
    expiresAt: "2030-01-02T03:04:00.000Z",
    actionUrl: `https://axora.management/account/${passwordReset ? "reset-password" : "verify-email"}#token=${TOKEN}`,
  });
  return {
    rendered,
    attachments: [await attachment("axora-logo", "axora-email.png", new URL("../../public/brand/axora-email.png", import.meta.url))],
  };
}

export async function sendPreview(options, { fetchImpl = globalThis.fetch, env = process.env } = {}) {
  if (env.NODE_ENV === "production") throw new Error("Email preview is disabled in production.");
  const { rendered, attachments } = await renderPreview(options);
  const response = await fetchImpl(previewEndpoint(env), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      From: PREVIEW_FROM,
      To: [{
        Email: rendered.recipientEmail,
        Name: rendered.recipientName ?? "Axora Preview User",
      }],
      ReplyTo: PREVIEW_REPLY_TO,
      Subject: `[Preview] ${rendered.subject}`,
      HTML: rendered.html,
      Text: rendered.text,
      Attachments: attachments,
      Headers: { "X-Axora-Preview": "local-only" },
      Tags: ["axora-preview", options.locale, options.template],
    }),
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error(`Mailpit rejected the preview (${response.status}).`);
  return { locale: options.locale, template: options.template };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  await sendPreview(options);
  process.stdout.write(`Captured ${options.template} (${options.locale}) at http://127.0.0.1:${process.env.MAILPIT_PREVIEW_PORT ?? "8025"}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "Email preview failed."}\n`);
    process.exitCode = 1;
  });
}

export const previewInternals = { parseArguments, previewEndpoint, renderPreview };
