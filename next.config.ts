import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(self)" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
  { key: "Strict-Transport-Security", value: "max-age=31536000" },
];

const nextConfig: NextConfig = {
  output: "standalone",
  // `pg-cloudflare` exposes a different implementation when OpenNext bundles
  // for workerd. Next's Node.js file tracer otherwise copies only
  // `dist/empty.js`, leaving the Cloudflare build without `dist/index.js`.
  serverExternalPackages: ["pg-cloudflare"],
  outputFileTracingIncludes: {
    "/*": [
      "./node_modules/pg-cloudflare/dist/**/*",
      "./node_modules/pg-cloudflare/esm/**/*",
    ],
  },
  poweredByHeader: false,
  experimental: {
    serverActions: {
      // Product editors may submit eight independently validated 5 MB images
      // in one multipart action. Caddy retains a much smaller limit on every
      // route except the explicit product/supplier/driver upload surfaces.
      bodySizeLimit: "44mb",
    },
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  async redirects() {
    return [{
      source: "/:locale(en|ar|ms)/operations-experience",
      destination: "/:locale/how-it-works",
      permanent: true,
    }];
  },
};

export default nextConfig;
