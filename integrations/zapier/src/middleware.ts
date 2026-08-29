import type { BeforeRequestMiddleware } from "zapier-platform-core";

import { AXORA_ORIGIN } from "./constants.js";

export const addAxoraBearerToken: BeforeRequestMiddleware = (
  request,
  _z,
  bundle,
) => {
  let destination: URL;
  try {
    destination = new URL(request.url);
  } catch {
    return request;
  }
  const accessToken = bundle.authData.access_token;
  const hasAuthorization = Object.keys(request.headers ?? {})
    .some((name) => name.toLowerCase() === "authorization");
  if (
    typeof accessToken === "string"
    && destination.origin === AXORA_ORIGIN
    && destination.pathname.startsWith("/api/v1/")
    && !hasAuthorization
  ) {
    request.headers = {
      ...request.headers,
      Authorization: `Bearer ${accessToken}`,
    };
  }
  return request;
};
