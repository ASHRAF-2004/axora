import { describe, expect, it } from "vitest";
import { buildContentSecurityPolicy } from "@/proxy";

function directiveSources(policy: string, directive: string) {
  const value = policy.split("; ").find((entry) => entry.startsWith(`${directive} `));
  if (!value) throw new Error(`Missing ${directive}.`);
  return value.split(" ").slice(1);
}

describe("content security policy", () => {
  it("uses a request nonce and blocks unsafe embedding and object content", () => {
    const policy = buildContentSecurityPolicy("known-nonce", false);
    expect(policy).toContain("script-src 'self' 'nonce-known-nonce' 'strict-dynamic'");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("form-action 'self'");
    expect(policy).toContain("upgrade-insecure-requests");
    expect(policy).toContain("style-src-attr 'unsafe-inline'");
    expect(policy).toContain(
      "style-src-elem 'self' 'nonce-known-nonce' 'sha256-Z5XTK23DFuEMs0PwnyZDO9SWxemQ5HxcpVaBNuUJyWY='",
    );
    expect(policy).not.toMatch(/style-src-elem[^;]*'unsafe-inline'/);
    expect(policy).not.toMatch(/script-src[^;]*'unsafe-inline'/);
    expect(policy).not.toContain("'unsafe-eval'");
  });

  it("does not retain retired WebAssembly or remote executable capabilities", () => {
    const sources = directiveSources(buildContentSecurityPolicy("prod", false), "script-src");
    expect(sources).not.toContain("'wasm-unsafe-eval'");
    expect(sources).not.toContain("'unsafe-eval'");
    expect(sources).not.toContain("*");
    expect(sources.filter((source) => source.startsWith("http"))).toEqual([
      "https://challenges.cloudflare.com",
    ]);
    expect(sources.join(" ")).not.toMatch(/(?:unpkg|jsdelivr|gstatic|cdn\.)/i);
  });

  it("allows development evaluation without broadening production evaluation", () => {
    expect(buildContentSecurityPolicy("dev", true)).toContain("'unsafe-eval'");
    expect(buildContentSecurityPolicy("prod", false)).not.toContain("'unsafe-eval'");
    expect(buildContentSecurityPolicy("prod", false)).not.toContain("'wasm-unsafe-eval'");
  });

  it("allows only the official Turnstile origin for third-party challenge content", () => {
    const policy = buildContentSecurityPolicy("turnstile", false);
    expect(policy).toContain("frame-src https://challenges.cloudflare.com");
    expect(policy).toContain("connect-src 'self' blob: https://challenges.cloudflare.com");
  });
});
