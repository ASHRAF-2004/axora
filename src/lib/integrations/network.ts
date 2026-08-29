import { isIP } from "node:net";
import { hashIntegrationSecret } from "./crypto";

export function integrationNetworkHash(request: Request) {
  const candidate = request.headers.get("cf-connecting-ip")?.trim() ?? "";
  return hashIntegrationSecret(
    "network",
    isIP(candidate) ? candidate : "unavailable",
  );
}
