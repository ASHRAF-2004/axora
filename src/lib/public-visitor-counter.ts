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
export const VISITOR_CLAIM_COOKIE_MAX_AGE = 400 * 24 * 60 * 60;

const HASH_PATTERN = /^[0-9a-f]{64}$/;
const COOKIE_PATTERN = /^v1\.([A-Za-z0-9_-]{43})\.([A-Za-z0-9_-]{43})$/;

export const visitorChoiceSchema = z.enum(["EARLY_BIRD", "NIGHT_OWL"]);
export type VisitorChoice = z.infer<typeof visitorChoiceSchema>;

export interface VisitorCounterSnapshot {
  totalCount: number;
  earlyBirdCount: number;
  nightOwlCount: number;
  visitorNumber?: number;
  choice?: VisitorChoice;
  claimedNew?: boolean;
}

export interface VisitorIdentity {
  tokenHash?: string;
  networkHash?: string;
}

interface VisitorSnapshotRow extends QueryResultRow {
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

function cookieSignature(rawToken: string) {
  return createHmac("sha256", visitorSecret())
    .update("axora-public-visitor-cookie-v1\0", "utf8")
    .update(rawToken, "utf8")
    .digest("base64url");
}

export function createVisitorClaimCookie() {
  const rawToken = randomBytes(32).toString("base64url");
  const value = `v1.${rawToken}.${cookieSignature(rawToken)}`;
  if (!COOKIE_PATTERN.test(value)) {
    throw new Error("A secure visitor cookie could not be generated.");
  }
  return {
    value,
    tokenHash: fingerprint("cookie-token", rawToken),
  };
}

export function visitorTokenHashFromCookie(value: string | undefined | null) {
  if (!value || value.length > 128) return undefined;
  const match = COOKIE_PATTERN.exec(value);
  if (!match) return undefined;
  const rawToken = match[1];
  const provided = Buffer.from(match[2], "base64url");
  const expected = Buffer.from(cookieSignature(rawToken), "base64url");
  if (provided.length !== expected.length
    || !timingSafeEqual(provided, expected)) {
    return undefined;
  }
  return fingerprint("cookie-token", rawToken);
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

export function buildVisitorIdentity(input: {
  cookieValue?: string;
  remoteIp?: string;
}): VisitorIdentity {
  const tokenHash = visitorTokenHashFromCookie(input.cookieValue);
  const remoteIp = normalizedPublicNetworkIdentifier(input.remoteIp);
  const networkHash = remoteIp
    ? fingerprint("network", remoteIp)
    : undefined;

  return {
    ...(tokenHash ? { tokenHash } : {}),
    ...(networkHash ? { networkHash } : {}),
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
  const totalCount = safeCounter(row.total_count, "total");
  const earlyBirdCount = safeCounter(row.early_bird_count, "early-bird total");
  const nightOwlCount = safeCounter(row.night_owl_count, "night-owl total");
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

export async function getPublicVisitorSnapshot(identity: VisitorIdentity) {
  const result = await query<VisitorSnapshotRow>(
    `SELECT * FROM public.axora_public_visitor_snapshot_v2($1,$2,$3,$4)`,
    [
      identity.tokenHash ?? null,
      identity.networkHash ?? null,
      null,
      null,
    ],
  );
  if (result.rowCount !== 1) {
    throw new Error("The public visitor counter is unavailable.");
  }
  return mapSnapshot(result.rows[0]);
}

async function consumeRateScope(
  client: PoolClient,
  action: "VISITOR_CHOICE" | "VISITOR_CHOICE_STREAM",
  kind: "NETWORK" | "IDENTIFIER",
  hash: string,
  limit: number,
) {
  if (!HASH_PATTERN.test(hash) || !Number.isInteger(limit)
    || limit < 1 || limit > 1_000) {
    throw new Error("The visitor rate-limit configuration is invalid.");
  }
  const consumed = await client.query(
    `INSERT INTO public.public_request_rate_buckets(
       action_key,scope_kind,scope_hash,bucket_started_at,request_count
     ) VALUES ($1,$2,$3,date_trunc('hour',now()),1)
     ON CONFLICT(action_key,scope_kind,scope_hash,bucket_started_at)
     DO UPDATE SET
       request_count=public.public_request_rate_buckets.request_count+1
     WHERE public.public_request_rate_buckets.request_count < $4
     RETURNING request_count`,
    [action, kind, hash, limit],
  );
  if (!consumed.rowCount) throw new VisitorClaimRateLimitError();
}

export async function consumeVisitorClaimRateLimit(identity: VisitorIdentity) {
  const scopes = [
    ...(identity.networkHash
      ? [{ kind: "NETWORK" as const, hash: identity.networkHash, limit: 24 }]
      : []),
  ];
  if (!scopes.length) return;
  await withAuditTransaction(
    { reason: "Public visitor choice rate-limit check" },
    async (client) => {
      await client.query(`SELECT public.axora_prune_public_visitor_rate_buckets()`);
      for (const scope of scopes) {
        await consumeRateScope(client, "VISITOR_CHOICE", scope.kind, scope.hash, scope.limit);
      }
    },
  );
}

export async function consumeVisitorStreamRateLimit(identity: VisitorIdentity) {
  if (!identity.networkHash) return;
  await withAuditTransaction(
    { reason: "Public visitor stream rate-limit check" },
    async (client) => consumeRateScope(client, "VISITOR_CHOICE_STREAM", "NETWORK", identity.networkHash!, 30),
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
        `SELECT * FROM public.axora_claim_public_visitor(
           $1,$2,$3,$4,$5,$6,$7,$8,$9
         )`,
        [
          input.identity.tokenHash,
          input.identity.networkHash ?? null,
          null,
          null,
          null,
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
