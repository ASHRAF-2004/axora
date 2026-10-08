import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { publicMessages } from "@/lib/i18n";

const dependencies = vi.hoisted(() => ({
  session: vi.fn(),
  headers: vi.fn(),
  cookies: vi.fn(),
  snapshot: vi.fn(),
  challenge: vi.fn(),
}));

// Public content must not depend on the retired introductory choice, its
// verification/network state, or an account session to render.
vi.mock("@/lib/auth", () => ({ getAccountLifecycleSession: dependencies.session }));
vi.mock("next/headers", () => ({ headers: dependencies.headers, cookies: dependencies.cookies }));
vi.mock("@/lib/public-visitor-counter", () => ({
  buildVisitorIdentity: vi.fn(),
  getPublicVisitorSnapshot: dependencies.snapshot,
  VISITOR_CLAIM_COOKIE: "axora_visitor_claim",
}));
vi.mock("@/components/public/VisitorChoiceChallenge", () => ({
  VisitorChoiceChallenge: dependencies.challenge,
}));

import PublicHome, { generateMetadata } from "@/app/[locale]/page";

describe("public homepage without the team-choice intro", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const dependency of Object.values(dependencies)) {
      dependency.mockImplementation(() => {
        throw new Error("The public homepage must not load the retired choice dependencies.");
      });
    }
  });

  it.each(["en", "ar", "ms"] as const)("renders the real %s homepage without visitor or session dependencies", async (locale) => {
    const html = renderToStaticMarkup(await PublicHome({ params: Promise.resolve({ locale }) }));
    const copy = publicMessages(locale).home;
    expect(html).toContain(`<h1 id="public-home-title">${copy.title}</h1>`);
    expect(html).toContain(`href="/${locale}/how-it-works"`);
    expect(html).toContain(`href="/${locale}/contact"`);
    expect(html).toContain('aria-labelledby="public-process-title"');
    expect(html).toContain('aria-labelledby="public-roles-title"');
    expect(html).not.toMatch(/role="dialog"|data-visitor-claimed|visitor-choice|turnstile|Choose Early Birds|Choose Night Owls|أيُّ فريق تختار؟/);
    for (const dependency of Object.values(dependencies)) expect(dependency).not.toHaveBeenCalled();
  });

  it("preserves supported locale validation", async () => {
    await expect(PublicHome({ params: Promise.resolve({ locale: "unsupported" }) })).rejects.toThrow("NEXT_HTTP_ERROR_FALLBACK;404");
  });

  it.each(["en", "ar", "ms"] as const)("preserves %s discovery metadata and language alternates", async (locale) => {
    const metadata = await generateMetadata({ params: Promise.resolve({ locale }) });
    expect(metadata.title).toBe(publicMessages(locale).home.title);
    expect(metadata.alternates).toEqual({
      canonical: `/${locale}`,
      languages: { en: "/en", ar: "/ar", ms: "/ms", "x-default": "/" },
    });
  });
});
