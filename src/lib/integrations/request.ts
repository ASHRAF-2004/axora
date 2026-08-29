export async function parseFormUrlEncoded(
  request: Request,
  allowedFields: readonly string[],
  maximumBytes = 16_384,
) {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/x-www-form-urlencoded") return null;
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) return null;
  const body = await request.text();
  if (Buffer.byteLength(body, "utf8") > maximumBytes) return null;
  const parameters = new URLSearchParams(body);
  const allowed = new Set(allowedFields);
  for (const key of parameters.keys()) {
    if (!allowed.has(key) || parameters.getAll(key).length !== 1) return null;
  }
  return parameters;
}

export function requestOriginIsSame(request: Request, expectedOrigin: string) {
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  return origin === expectedOrigin
    && (!fetchSite || fetchSite === "same-origin" || fetchSite === "none");
}
