import {
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import fs from "node:fs";
import { isIP } from "node:net";
import type { PoolClient, QueryResultRow } from "pg";
import { z } from "zod";
import { query, withAuditTransaction } from "./db";

export const VISITOR_CLAIM_COOKIE = "axora_visitor_claim";
export const VISITOR_CLAIM_COOKIE_MAX_AGE = 365 * 24 * 60 * 60;

const HASH_PATTERN = /^[0-9a-f]{64}$/;
const COOKIE_PATTERN = /^(v1|v2)\.([A-Za-z0-9_-]{43})\.([A-Za-z0-9_-]{43})$/;
const CURRENT_COOKIE_VERSION = "v2" as const;
const RATE_BUCKET_MS = 60 * 60 * 1_000;

export const visitorChoiceSchema = z.enum(["EARLY_BIRD", "NIGHT_OWL"]);
export type VisitorChoice = z.infer<typeof visitorChoiceSchema>;

export interface VisitorCounterSnapshot {
  version: number;
  totalCount: number;
  earlyBirdCount: number;
  nightOwlCount: number;
  visitorNumber?: number;
  choice?: VisitorChoice;
  claimedNew?: boolean;
}

export interface VisitorIdentity {
  tokenHash?: string;
}

export interface VisitorRateLimitScope {
  networkBucketHash?: string;
  bucketStartedAt?: Date;
}

export interface VerifiedVisitorClaimCookie {
  value: string;
  tokenHash: string;
  needsRotation: boolean;
}

interface VisitorSnapshotRow extends QueryResultRow {
  snapshot_version: string | number;
  total_count: string | number;
  early_bird_count: string | number;
  night_owl_count: string | number;
  visitor_number: string | number | null;
  choice: string | null;
  claimed_new?: boolean;
}

export class VisitorClaimRateLimitError extends Error {
  constructor() {
    super("The visitor claim has been rate limited.");
    this.name = "VisitorClaimRateLimitError";
  }
}

function visitorSecret() {
  const value = process.env.SESSION_SECRET_FILE
    && fs.existsSync(process.env.SESSION_SECRET_FILE)
    ? fs.readFileSync(process.env.SESSION_SECRET_FILE, "utf8").trim()
    : process.env.SESSION_SECRET?.trim();
  if (!value || value.length < 32 || value.length > 4_096) {
    throw new Error("The visitor identity signing key is unavailable.");
  }
  return value;
}

function fingerprint(domain: string, value: string) {
  const normalized = value.normalize("NFKC").trim();
  if (!normalized || normalized.length > 2_048
    || /[\u0000-\u001F\u007F]/.test(normalized)) {
    throw new Error("The visitor identity context is invalid.");
  }
  return createHmac("sha256", visitorSecret())
    .update(`axora-public-visitor-${domain}-v1\0`, "utf8")
    .update(normalized, "utf8")
    .digest("hex");
}

function cookieSignature(version: "v1" | "v2", rawToken: string) {
  return createHmac("sha256", visitorSecret())
    .update(`axora-public-visitor-cookie-${version}\0`, "utf8")
    .update(rawToken, "utf8")
    .digest("base64url");
}

function cookieValue(version: "v1" | "v2", rawToken: string) {
  return `${version}.${rawToken}.${cookieSignature(version, rawToken)}`;
}

export function createVisitorClaimCookie(): VerifiedVisitorClaimCookie {
  const rawToken = randomBytes(32).toString("base64url");
  const value = cookieValue(CURRENT_COOKIE_VERSION, rawToken);
  if (!COOKIE_PATTERN.test(value)) {
    throw new Error("A secure visitor cookie could not be generated.");
  }
  return {
    value,
    tokenHash: fingerprint("cookie-token", rawToken),
    needsRotation: false,
  };
}

export function readVisitorClaimCookie(value: string | undefined | null): VerifiedVisitorClaimCookie | undefined {
  if (!value || value.length > 128) return undefined;
  const match = COOKIE_PATTERN.exec(value);
  if (!match) return undefined;
  const version = match[1] as "v1" | "v2";
  const rawToken = match[2];
  const provided = Buffer.from(match[3], "base64url");
  const expected = Buffer.from(cookieSignature(version, rawToken), "base64url");
  if (provided.length !== expected.length
    || !timingSafeEqual(provided, expected)) {
    return undefined;
  }
  return {
    value: cookieValue(CURRENT_COOKIE_VERSION, rawToken),
    tokenHash: fingerprint("cookie-token", rawToken),
    needsRotation: version !== CURRENT_COOKIE_VERSION,
  };
}

export function visitorTokenHashFromCookie(value: string | undefined | null) {
  return readVisitorClaimCookie(value)?.tokenHash;
}

export function normalizedPublicNetworkIdentifier(value: string | null | undefined) {
  const candidate = value?.trim().toLowerCase();
  const version = candidate ? isIP(candidate) : 0;
  if (!candidate || !version) return undefined;
  if (version === 4) {
    return candidate.split(".").map((part) => String(Number(part))).join(".");
  }
  try {
    const hostname = new URL(`http://[${candidate}]`).hostname;
    return hostname.startsWith("[") && hostname.endsWith("]")
      ? hostname.slice(1, -1).toLowerCase()
      : candidate;
  } catch {
    return candidate;
  }
}

export function buildVisitorIdentity(input: { cookieValue?: string }): VisitorIdentity {
  const tokenHash = visitorTokenHashFromCookie(input.cookieValue);
  return tokenHash ? { tokenHash } : {};
}

export function buildVisitorRateLimitScope(
  remoteIp: string | null | undefined,
  at = new Date(),
): VisitorRateLimitScope {
  const normalized = normalizedPublicNetworkIdentifier(remoteIp);
  if (!normalized || !Number.isFinite(at.getTime())) return {};
  const bucketStartedAt = new Date(Math.floor(at.getTime() / RATE_BUCKET_MS) * RATE_BUCKET_MS);
  return {
    networkBucketHash: fingerprint(
      `network-rate-${bucketStartedAt.toISOString()}`,
      normalized,
    ),
    bucketStartedAt,
  };
}

function safeCounter(value: string | number | null, label: string) {
  if (value === null) return undefined;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`The public visitor ${label} is invalid.`);
  }
  return parsed;
}

function mapSnapshot(row: VisitorSnapshotRow): VisitorCounterSnapshot {
  const version = safeCounter(row.snapshot_version, "version");
  const totalCount = safeCounter(row.total_count, "total");
  const earlyBirdCount = safeCounter(row.early_bird_count, "early-bird total");
  const nightOwlCount = safeCounter(row.night_owl_count, "night-owl total");
  if (version === undefined
    || totalCount === undefined
    || earlyBirdCount === undefined
    || nightOwlCount === undefined
    || version < totalCount
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
    version,
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

export async function getPublicVisitorSnapshot(identity: VisitorIdentity) {
  const result = await query<VisitorSnapshotRow>(
    `SELECT * FROM public.axora_public_visitor_snapshot_v3($1)`,
    [identity.tokenHash ?? null],
  );
  if (result.rowCount !== 1) {
    throw new Error("The public visitor counter is unavailable.");
  }
  return mapSnapshot(result.rows[0]);
}

async function consumeRateScope(
  client: PoolClient,
  scope: Required<VisitorRateLimitScope>,
  limit: number,
) {
  if (!HASH_PATTERN.test(scope.networkBucketHash)
    || !Number.isFinite(scope.bucketStartedAt.getTime())
    || scope.bucketStartedAt.getUTCMinutes() !== 0
    || scope.bucketStartedAt.getUTCSeconds() !== 0
    || scope.bucketStartedAt.getUTCMilliseconds() !== 0
    || !Number.isInteger(limit)
    || limit < 1
    || limit > 1_000) {
    throw new Error("The visitor rate-limit configuration is invalid.");
  }
  const consumed = await client.query(
    `INSERT INTO public.public_request_rate_buckets(
       action_key,scope_kind,scope_hash,bucket_started_at,request_count
     ) VALUES ('VISITOR_CHOICE','NETWORK',$1,$2,1)
     ON CONFLICT(action_key,scope_kind,scope_hash,bucket_started_at)
     DO UPDATE SET
       request_count=public.public_request_rate_buckets.request_count+1
     WHERE public.public_request_rate_buckets.request_count < $3
     RETURNING request_count`,
    [scope.networkBucketHash, scope.bucketStartedAt, limit],
  );
  if (!consumed.rowCount) throw new VisitorClaimRateLimitError();
}

export async function consumeVisitorClaimRateLimit(scope: VisitorRateLimitScope) {
  if (!scope.networkBucketHash || !scope.bucketStartedAt) return;
  await withAuditTransaction(
    { reason: "Public visitor choice rate-limit check" },
    async (client) => {
      await client.query(`SELECT public.axora_prune_public_visitor_rate_buckets()`);
      await consumeRateScope(client, {
        networkBucketHash: scope.networkBucketHash!,
        bucketStartedAt: scope.bucketStartedAt!,
      }, 24);
    },
  );
}

export async function claimPublicVisitor(input: {
  identity: VisitorIdentity & { tokenHash: string };
  choice: VisitorChoice;
  locale: "en" | "ar" | "ms";
  turnstileChallengeAt: Date;
  turnstileHostname: string;
}) {
  const parsedChoice = visitorChoiceSchema.parse(input.choice);
  if (!HASH_PATTERN.test(input.identity.tokenHash)
    || !Number.isFinite(input.turnstileChallengeAt.getTime())
    || !input.turnstileHostname.trim()) {
    throw new Error("The public visitor claim is invalid.");
  }
  return withAuditTransaction(
    { reason: "Public visitor choice claimed" },
    async (client) => {
      const result = await client.query<VisitorSnapshotRow>(
        `SELECT * FROM public.axora_claim_public_visitor_v3(
           $1,$2,$3,$4,$5
         )`,
        [
          input.identity.tokenHash,
          parsedChoice,
          input.locale,
          input.turnstileChallengeAt,
          input.turnstileHostname.trim().toLowerCase(),
        ],
      );
      if (result.rowCount !== 1) {
        throw new Error("The public visitor claim could not be recorded.");
      }
      return mapSnapshot(result.rows[0]);
    },
  );
}

export const publicVisitorCounterInternals = {
  fingerprint,
  mapSnapshot,
};
