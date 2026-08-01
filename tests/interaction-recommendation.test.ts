import { describe, expect, it } from "vitest";
import { recommendInteraction, type CompanyInteractionProfile } from "@/lib/interactions";

function profile(overrides: Partial<CompanyInteractionProfile> = {}): CompanyInteractionProfile {
  return {
    companyName: "Northstar",
    industry: "Technology",
    brandPersonality: ["friendly", "modern"],
    hasLogo: true,
    paletteStyle: "vibrant",
    servicesOrProducts: ["Cloud automation"],
    intendedAudience: "business",
    websitePurpose: "lead-generation",
    accessibility: { reducedMotionPriority: false, cognitiveSimplicityPriority: false },
    deviceMix: "balanced",
    performanceCondition: "standard",
    ...overrides,
  };
}

describe("company-aware interaction recommendation", () => {
  it("is deterministic and chooses a friendly mascot for a matching technology brand", () => {
    const first = recommendInteraction(profile());
    const second = recommendInteraction(profile());
    expect(first).toEqual(second);
    expect(first.config.enabled && first.config.interactionType).toBe("mascot");
    expect(first.config.assetId).toBe("axora-buddy-v1");
    expect(first.rationale).toContain("technology-focused");
    expect(first.rationale.length).toBeLessThanOrEqual(320);
  });

  it.each(["Financial services", "Legal services", "Healthcare clinic", "Government"])(
    "recommends no interaction for restrained trust-sensitive industry %s",
    (industry) => {
      const recommendation = recommendInteraction(profile({ industry, brandPersonality: ["formal", "premium"] }));
      expect(recommendation.config.enabled).toBe(false);
      expect(recommendation.config.interactionType).toBe("none");
      expect(recommendation.metrics.accessibilityFit).toBe(100);
    },
  );

  it("uses restrained motion rather than a mascot for industrial and consultancy profiles", () => {
    for (const industry of ["Industrial manufacturing", "Professional consultancy"]) {
      const recommendation = recommendInteraction(profile({ industry, brandPersonality: ["formal", "modern"] }));
      expect(recommendation.config.enabled && recommendation.config.interactionType).toBe("restrained-motion");
      expect(recommendation.config.assetId).toBe("axora-restrained-motion-v1");
    }
  });

  it("selects a non-walking learning guide for an education audience", () => {
    const recommendation = recommendInteraction(profile({
      industry: "Education and learning",
      brandPersonality: ["friendly", "playful"],
      intendedAudience: "students",
      websitePurpose: "education",
    }));
    expect(recommendation.config.enabled && recommendation.config.interactionType).toBe("guided-character");
    expect(recommendation.config.enabled && recommendation.config.automaticMovement).toBe(false);
  });

  it("reduces cost and motion for mobile, accessibility, and device constraints", () => {
    const lowMobile = recommendInteraction(profile({ deviceMix: "mobile-first", performanceCondition: "low" }));
    expect(lowMobile.config.enabled).toBe(false);

    const lowDesktop = recommendInteraction(profile({ deviceMix: "desktop-first", performanceCondition: "low" }));
    expect(lowDesktop.config.enabled).toBe(false);
    expect(lowDesktop.rationale).toMatch(/lower-performance devices/i);

    const reduced = recommendInteraction(profile({
      accessibility: { reducedMotionPriority: true, cognitiveSimplicityPriority: true },
    }));
    expect(reduced.config.enabled).toBe(false);
  });
});
