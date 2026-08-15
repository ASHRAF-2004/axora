import { NextRequest, NextResponse } from "next/server";

const SESSION_RETURN_HEADER = "x-axora-return-to";
const NEXT_NOT_FOUND_STYLE_HASH = "'sha256-Z5XTK23DFuEMs0PwnyZDO9SWxemQ5HxcpVaBNuUJyWY='";

export function buildContentSecurityPolicy(nonce: string, development = false) {
  const directives = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' 'wasm-unsafe-eval'${development ? " 'unsafe-eval'" : ""} https://challenges.cloudflare.com`,
    `style-src-elem 'self' 'nonce-${nonce}' ${NEXT_NOT_FOUND_STYLE_HASH}`,
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self'",
    "connect-src 'self' blob: https://challenges.cloudflare.com",
    "frame-src https://challenges.cloudflare.com",
    "worker-src 'self' blob:",
    "media-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "manifest-src 'self'",
    ...(development ? [] : ["upgrade-insecure-requests"]),
  ];
  return directives.join("; ");
}

export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const contentSecurityPolicy = buildContentSecurityPolicy(
    nonce,
    process.env.NODE_ENV === "development",
  );
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", contentSecurityPolicy);

  // Never trust an inbound return-route header. Rebuild it from Next's parsed
  // same-origin URL so protected pages and actions can preserve the exact path
  // and query when a real session expiry sends the browser to login.
  const returnTo = `${request.nextUrl.pathname}${request.nextUrl.search}`;
  if (returnTo.length <= 2_048) {
    requestHeaders.set(SESSION_RETURN_HEADER, returnTo);
  } else {
    requestHeaders.delete(SESSION_RETURN_HEADER);
  }

  const routeLocale = request.nextUrl.pathname.split("/")[1];
  if (routeLocale === "en" || routeLocale === "ar" || routeLocale === "ms") {
    requestHeaders.set("x-axora-route-locale", routeLocale);
  } else {
    requestHeaders.delete("x-axora-route-locale");
  }
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", contentSecurityPolicy);
  return response;
}

export const config = {
  matcher: [
    {
      source: "/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|webp|ico|svg|pdf|woff2?)$).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
