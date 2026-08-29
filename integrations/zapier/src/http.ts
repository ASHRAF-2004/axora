import type { Bundle, ZObject } from "zapier-platform-core";

import { AXORA_API_BASE, AXORA_ORIGIN } from "./constants.js";

export interface AxoraEnvelope<T> {
  data: T;
  meta?: Record<string, unknown>;
}
export interface AxoraRecord extends Record<string, unknown> {
  id: string;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function requireUuid(z: ZObject, value: unknown) {
  const candidate = typeof value === "string" ? value.trim() : "";
  if (!UUID_PATTERN.test(candidate)) {
    throw new z.errors.Error(
      "Enter a valid Axora record ID.",
      "InvalidAxoraRecordId",
      400,
    );
  }
  return candidate;
}

export function stableIdempotencyKey(
  z: ZObject,
  namespace: "hook-create" | "hook-revoke" | "draft-create",
  value: string,
) {
  return `zapier-${namespace}:${z.hash("sha256", value)}`;
}

export function absoluteAxoraUrl(value: unknown) {
  if (typeof value !== "string" || !value.startsWith("/")) return undefined;
  const resolved = new URL(value, AXORA_ORIGIN);
  return resolved.origin === AXORA_ORIGIN ? resolved.href : undefined;
}

export async function findAxoraRecord(
  z: ZObject,
  bundle: Bundle,
  collection: "companies" | "requests" | "deliveries" | "invoices",
) {
  const id = requireUuid(z, bundle.inputData.id);
  const response = await z.request<AxoraEnvelope<AxoraRecord>>({
    url: `${AXORA_API_BASE}/${collection}/${encodeURIComponent(id)}`,
    method: "GET",
    skipThrowForStatus: true,
  });
  if (response.status === 404) return [];
  response.throwForStatus();
  const record = response.data?.data;
  return record && typeof record.id === "string" ? [record] : [];
}
