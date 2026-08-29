import { z } from "zod";
import {
  hashIntegrationSecret,
  integrationSecretHashMatches,
} from "./crypto";

const cursorSchema = z.object({
  v: z.literal(1),
  route: z.string().min(1).max(120),
  company: z.string().uuid(),
  sort: z.string().min(1).max(300),
  id: z.string().uuid(),
}).strict();

export interface ExternalCursor {
  sort: string;
  id: string;
}

export type PaginationResult =
  | { ok: true; limit: number; cursor?: ExternalCursor }
  | { ok: false; field: "limit" | "cursor" | "query" };

export function encodeExternalCursor(input: {
  route: string;
  companyId: string;
  sort: string;
  id: string;
}) {
  const payload = Buffer.from(JSON.stringify({
    v: 1,
    route: input.route,
    company: input.companyId,
    sort: input.sort,
    id: input.id,
  }), "utf8").toString("base64url");
  return `${payload}.${hashIntegrationSecret("cursor", payload)}`;
}

function decodeExternalCursor(
  value: string,
  route: string,
  companyId: string,
) {
  if (value.length > 1024) return null;
  const [payload, signature, extra] = value.split(".");
  if (!payload || !signature || extra
    || !integrationSecretHashMatches("cursor", payload, signature)) return null;
  try {
    const parsed = cursorSchema.safeParse(JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ));
    if (!parsed.success || parsed.data.route !== route
      || parsed.data.company !== companyId) return null;
    return { sort: parsed.data.sort, id: parsed.data.id };
  } catch {
    return null;
  }
}

export function parseExternalPagination(
  request: Request,
  route: string,
  companyId: string,
): PaginationResult {
  const parameters = new URL(request.url).searchParams;
  for (const key of parameters.keys()) {
    if (!new Set(["limit", "cursor"]).has(key)
      || parameters.getAll(key).length !== 1) {
      return { ok: false, field: "query" };
    }
  }
  const rawLimit = parameters.get("limit");
  if (rawLimit !== null && !/^[1-9][0-9]{0,2}$/.test(rawLimit)) {
    return { ok: false, field: "limit" };
  }
  const limit = rawLimit === null ? 25 : Number(rawLimit);
  if (limit < 1 || limit > 100) return { ok: false, field: "limit" };
  const rawCursor = parameters.get("cursor");
  if (!rawCursor) return { ok: true, limit };
  const cursor = decodeExternalCursor(rawCursor, route, companyId);
  return cursor ? { ok: true, limit, cursor }
    : { ok: false, field: "cursor" };
}

export const paginationInternals = { decodeExternalCursor };
