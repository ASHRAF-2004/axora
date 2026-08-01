import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
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
      // Keep room for multipart headers around Axora's validated 2 MB file limit.
      bodySizeLimit: "3mb",
    },
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
