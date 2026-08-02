import { argon2, randomBytes, timingSafeEqual } from "node:crypto";
import { compare as compareBcrypt } from "bcryptjs";
import {
  MAX_PASSWORD_CODE_POINTS,
  MIN_PASSWORD_CODE_POINTS,
  passwordCodePointLength,
} from "./password-policy-shared";

export {
  MAX_PASSWORD_CODE_POINTS,
  MIN_PASSWORD_CODE_POINTS,
} from "./password-policy-shared";

const ARGON2_VERSION = 19;
const ARGON2_MEMORY_KIB = 65_536;
const ARGON2_PASSES = 3;
const ARGON2_PARALLELISM = 1;
const ARGON2_SALT_BYTES = 16;
const ARGON2_TAG_BYTES = 32;
const BCRYPT_HASH_PATTERN = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/;
const ARGON2_HASH_PATTERN = /^\$argon2id\$v=(\d+)\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/;

/**
 * Valid bcrypt data used only while an invited account is waiting for setup.
 * Its original random input was discarded. Keeping the column non-null makes
 * an application-only rollback fail authentication safely instead of passing
 * NULL to an older bcrypt comparison path.
 */
export const PENDING_ACCOUNT_PASSWORD_HASH =
  "$2b$12$WuY.R47gEaitrj7J5zwZzutoX6T8co.PmnoE28TzRlWv93Cmxd0By" as const;

export class PasswordPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PasswordPolicyError";
  }
}

export interface PasswordPolicyResult {
  codePointCount: number;
  utf8ByteLength: number;
}

/**
 * NIST SP 800-63B-4 measures password length in Unicode code points. The
 * product limit prevents unbounded hashing work without truncating input.
 * Legacy bcrypt hashes remain verification-only and are upgraded after login.
 */
export function assertPasswordPolicy(password: string): PasswordPolicyResult {
  const codePointCount = passwordCodePointLength(password);
  const utf8ByteLength = Buffer.byteLength(password, "utf8");

  if (codePointCount < MIN_PASSWORD_CODE_POINTS) {
    throw new PasswordPolicyError(
      `Use at least ${MIN_PASSWORD_CODE_POINTS} Unicode code points.`,
    );
  }
  if (codePointCount > MAX_PASSWORD_CODE_POINTS) {
    throw new PasswordPolicyError(
      `Use at most ${MAX_PASSWORD_CODE_POINTS} Unicode code points. The password was not truncated.`,
    );
  }
  if (password.includes("\u0000")) {
    throw new PasswordPolicyError("The null control character is not supported in passwords.");
  }

  return { codePointCount, utf8ByteLength };
}

function base64WithoutPadding(value: Buffer) {
  return value.toString("base64").replace(/=+$/, "");
}

function decodeBase64WithoutPadding(value: string) {
  if (!value || value.length % 4 === 1) return null;
  try {
    const decoded = Buffer.from(value, "base64");
    return base64WithoutPadding(decoded) === value ? decoded : null;
  } catch {
    return null;
  }
}

function deriveArgon2id(
  password: string,
  salt: Buffer,
  parameters: { memory: number; passes: number; parallelism: number; tagLength: number },
) {
  return new Promise<Buffer>((resolve, reject) => {
    argon2("argon2id", {
      message: Buffer.from(password, "utf8"),
      nonce: salt,
      memory: parameters.memory,
      passes: parameters.passes,
      parallelism: parameters.parallelism,
      tagLength: parameters.tagLength,
    }, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey);
    });
  });
}

interface ParsedArgon2idHash {
  version: number;
  memory: number;
  passes: number;
  parallelism: number;
  salt: Buffer;
  tag: Buffer;
}

function parseArgon2idHash(encoded: string): ParsedArgon2idHash | null {
  const match = ARGON2_HASH_PATTERN.exec(encoded);
  if (!match) return null;
  const version = Number(match[1]);
  const memory = Number(match[2]);
  const passes = Number(match[3]);
  const parallelism = Number(match[4]);
  const salt = decodeBase64WithoutPadding(match[5]);
  const tag = decodeBase64WithoutPadding(match[6]);

  // Stored hashes are trusted application data, but hard bounds still prevent
  // a corrupted row from turning login into an excessive CPU/memory request.
  if (version !== ARGON2_VERSION
    || !Number.isInteger(memory) || memory < 19_456 || memory > 131_072
    || !Number.isInteger(passes) || passes < 2 || passes > 5
    || !Number.isInteger(parallelism) || parallelism < 1 || parallelism > 4
    || !salt || salt.length < 16 || salt.length > 64
    || !tag || tag.length < 16 || tag.length > 64) {
    return null;
  }
  return { version, memory, passes, parallelism, salt, tag };
}

/** Create a self-describing PHC-style Argon2id password hash. */
export async function hashPassword(password: string) {
  assertPasswordPolicy(password);
  const salt = randomBytes(ARGON2_SALT_BYTES);
  const tag = await deriveArgon2id(password, salt, {
    memory: ARGON2_MEMORY_KIB,
    passes: ARGON2_PASSES,
    parallelism: ARGON2_PARALLELISM,
    tagLength: ARGON2_TAG_BYTES,
  });
  return `$argon2id$v=${ARGON2_VERSION}$m=${ARGON2_MEMORY_KIB},t=${ARGON2_PASSES},p=${ARGON2_PARALLELISM}$${base64WithoutPadding(salt)}$${base64WithoutPadding(tag)}`;
}

/** Verify modern Argon2id hashes and existing bcrypt credentials. */
export async function verifyPassword(password: string, encodedHash: string) {
  const parsed = parseArgon2idHash(encodedHash);
  if (parsed) {
    try {
      const candidate = await deriveArgon2id(password, parsed.salt, {
        memory: parsed.memory,
        passes: parsed.passes,
        parallelism: parsed.parallelism,
        tagLength: parsed.tag.length,
      });
      return candidate.length === parsed.tag.length && timingSafeEqual(candidate, parsed.tag);
    } catch {
      return false;
    }
  }
  if (BCRYPT_HASH_PATTERN.test(encodedHash)) {
    try {
      return await compareBcrypt(password, encodedHash);
    } catch {
      return false;
    }
  }
  return false;
}

export function passwordHashNeedsUpgrade(encodedHash: string) {
  const parsed = parseArgon2idHash(encodedHash);
  return !parsed
    || parsed.memory !== ARGON2_MEMORY_KIB
    || parsed.passes !== ARGON2_PASSES
    || parsed.parallelism !== ARGON2_PARALLELISM
    || parsed.tag.length !== ARGON2_TAG_BYTES;
}

export const passwordHashInternals = {
  algorithm: "argon2id" as const,
  memoryKiB: ARGON2_MEMORY_KIB,
  passes: ARGON2_PASSES,
  parallelism: ARGON2_PARALLELISM,
};
