export async function parseFormUrlEncoded(
  request: Request,
  allowedFields: readonly string[],
  maximumBytes = 16_384,
) {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/x-www-form-urlencoded") return null;
  const body = await readLimitedTextBody(request,maximumBytes);
  if (body === null) return null;
  const parameters = new URLSearchParams(body);
  const allowed = new Set(allowedFields);
  for (const key of parameters.keys()) {
    if (!allowed.has(key) || parameters.getAll(key).length !== 1) return null;
  }
  return parameters;
}

export async function readLimitedTextBody(
  request: Request,
  maximumBytes: number,
) {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 0) return null;
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null
    && (!/^\d+$/.test(contentLength) || Number(contentLength) > maximumBytes)) {
    return null;
  }
  if (!request.body) return "";

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done,value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maximumBytes) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(value);
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(
      Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)),length),
    );
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }
}

export function requestOriginIsSame(request: Request, expectedOrigin: string) {
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  return origin === expectedOrigin
    && (!fetchSite || fetchSite === "same-origin" || fetchSite === "none");
}
