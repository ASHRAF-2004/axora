import type { MetadataRoute } from "next";

const baseUrl = "https://axora.management";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: "*", allow: ["/", "/en/", "/ar/", "/ms/"], disallow: ["/api/", "/account/", "/login", "/dashboard", "/companies", "/branches", "/products", "/requests", "/approvals", "/deliveries", "/finance", "/reports", "/audit", "/email-operations", "/users", "/support", "/settings", "/profile", "/help", "/driver", "/receiving", "/notifications"] },
    ],
    sitemap: `${baseUrl}/sitemap.xml`,
    host: baseUrl,
  };
}
