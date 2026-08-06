import {
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import fs from "node:fs";
import type { QueryResultRow } from "pg";
import {
  visitorChoiceSchema,
  type VisitorCounterSnapshot,
  type VisitorIdentity,
} from "./public-visitor-counter";
import { withAuditTransaction } from "./db";

export const VISITOR_FALLBACK_COOKIE = "axora_visitor_fallback";
export const VISITOR_FALLBACK_COOKIE_MAX_AGE = 15 * 60;

const HASH_PATTERN = /^[0-9a-f]{64}$/;
const FALLBACK_COOKIE_PATTERN =
  /^v1\.([0-9a-z]{1,12})\.([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{43})$/;
const FALLBACK_CLOCK_SKEW_SECONDS = 60;

interface FallbackSnapshotRow extends QueryResultRow {
  total_count: string | number;
  early_bird_count: string | number;
  night_owl_count: string | number;
  visitor_number: string | number | null;
  choice: string | null;
  claimed_new?: boolean;
}

function visitorSecret() {
  const file = process.env.SESSION_SECRET_FILE?.trim();
  const value = file && fs.existsSync(file)
    ? fs.readFileSync(file, "utf8").trim()
    : process.env.SESSION_SECRET?.trim();
  if (!value || value.length < 32 || value.length > 4_096) {
    throw new Error("The visitor identity signing key is unavailable.");
  }
  return value;
}

function fallbackSignature(
  issuedAt: string,
  nonce: string,
  networkHash: string,
) {
  return createHmac("sha256", visitorSecret())
    .update("axora-public-visitor-fallback-v2\0", "utf8")
    .update(issuedAt, "utf8")
    .update("\0", "utf8")
    .update(nonce, "utf8")
    .update("\0", "utf8")
    .update(networkHash, "utf8")
    .digest("base64url");
}

function signaturesMatch(provided: string, expected: string) {
  const providedBytes = Buffer.from(provided, "base64url");
  const expectedBytes = Buffer.from(expected, "base64url");
  return providedBytes.length === expectedBytes.length
    && timingSafeEqual(providedBytes, expectedBytes);
}

export function createVisitorFallbackCookie(
  networkHash: string,
  now = Date.now(),
) {
  if (!HASH_PATTERN.test(networkHash)
    || !Number.isFinite(now)
    || now < 0) {
    throw new Error("The visitor fallback context is invalid.");
  }
  const issuedAt = Math.floor(now / 1_000).toString(36);
  const nonce = randomBytes(16).toString("base64url");
  const value = `v1.${issuedAt}.${nonce}.${fallbackSignature(
    issuedAt,
    nonce,
    networkHash,
  )}`;
  if (!FALLBACK_COOKIE_PATTERN.test(value)) {
    throw new Error("The visitor fallback cookie could not be generated.");
  }
  return value;
}

export function verifyVisitorFallbackCookie(
  value: string | undefined | null,
  networkHash: string | undefined,
  now = Date.now(),
) {
  if (!value || value.length > 160
    || !networkHash || !HASH_PATTERN.test(networkHash)
    || !Number.isFinite(now) || now < 0) {
    return false;
  }
  const match = FALLBACK_COOKIE_PATTERN.exec(value);
  if (!match) return false;

  const issuedAtText = match[1];
  const nonce = match[2];
  const signature = match[3];
  const issuedAt = Number.parseInt(issuedAtText, 36);
  const nowSeconds = Math.floor(now / 1_000);
  if (!Number.isSafeInteger(issuedAt)
    || issuedAt > nowSeconds + FALLBACK_CLOCK_SKEW_SECONDS
    || nowSeconds - issuedAt > VISITOR_FALLBACK_COOKIE_MAX_AGE) {
    return false;
  }

  return signaturesMatch(
    signature,
    fallbackSignature(issuedAtText, nonce, networkHash),
  );
}

function safeCounter(value: string | number | null, label: string) {
  if (value === null) return undefined;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`The public visitor ${label} is invalid.`);
  }
  return parsed;
}

function mapSnapshot(row: FallbackSnapshotRow): VisitorCounterSnapshot {
  const totalCount = safeCounter(row.total_count, "total");
  const earlyBirdCount = safeCounter(
    row.early_bird_count,
    "early-bird total",
  );
  const nightOwlCount = safeCounter(
    row.night_owl_count,
    "night-owl total",
  );
  if (totalCount === undefined
    || earlyBirdCount === undefined
    || nightOwlCount === undefined
    || totalCount !== earlyBirdCount + nightOwlCount) {
    throw new Error("The public visitor counter is inconsistent.");
  }
  const visitorNumber = safeCounter(row.visitor_number, "number");
  const choice = row.choice === null
    ? undefined
    : visitorChoiceSchema.parse(row.choice);
  if ((visitorNumber === undefined) !== (choice === undefined)) {
    throw new Error("The public visitor claim state is inconsistent.");
  }
  return {
    totalCount,
    earlyBirdCount,
    nightOwlCount,
    ...(visitorNumber !== undefined ? { visitorNumber } : {}),
    ...(choice ? { choice } : {}),
    ...(typeof row.claimed_new === "boolean"
      ? { claimedNew: row.claimed_new }
      : {}),
  };
}

export async function claimPublicVisitorFallback(input: {
  identity: VisitorIdentity & {
    tokenHash: string;
    networkHash: string;
    networkDeviceHash: string;
    clientSignalHash: string;
  };
  choice: "EARLY_BIRD" | "NIGHT_OWL";
  locale: "en" | "ar" | "ms";
}) {
  if (!HASH_PATTERN.test(input.identity.tokenHash)
    || !HASH_PATTERN.test(input.identity.networkHash)
    || !HASH_PATTERN.test(input.identity.networkDeviceHash)
    || !HASH_PATTERN.test(input.identity.clientSignalHash)) {
    throw new Error("The public visitor fallback identity is invalid.");
  }
  const parsedChoice = visitorChoiceSchema.parse(input.choice);

  return withAuditTransaction(
    { reason: "Public visitor choice claimed with network fallback" },
    async (client) => {
      const result = await client.query<FallbackSnapshotRow>(
        `SELECT * FROM public.axora_claim_public_visitor_fallback(
           $1,$2,$3,$4,$5,$6
         )`,
        [
          input.identity.tokenHash,
          input.identity.networkHash,
          input.identity.networkDeviceHash,
          input.identity.clientSignalHash,
          parsedChoice,
          input.locale,
        ],
      );
      if (result.rowCount !== 1) {
        throw new Error("The public visitor fallback claim could not be recorded.");
      }
      return mapSnapshot(result.rows[0]);
    },
  );
}
