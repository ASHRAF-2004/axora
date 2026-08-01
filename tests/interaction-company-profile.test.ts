import { describe, expect, it } from "vitest";
import { interactionProfileFromCompany } from "../src/lib/interactions/company-profile";
import { recommendInteraction } from "../src/lib/interactions/recommendation";

describe("company interaction profile adapter", () => {
  it("uses a friendly technical profile only when the stored industry supports it", () => {
    const profile = interactionProfileFromCompany({
      name: "Northstar Automation",
      industry: "Robotics and automation technology",
    });

    expect(profile.brandPersonality).toEqual([
      "modern",
      "technical",
      "friendly",
    ]);
    expect(profile.paletteStyle).toBe("unknown");
    expect(profile.hasLogo).toBe(false);
    expect(recommendInteraction(profile).config.interactionType).toBe("mascot");
  });

  it("defaults regulated companies to a restrained accessible experience", () => {
    const profile = interactionProfileFromCompany({
      name: "Example Medical Clinic",
      industry: "Healthcare",
    });

    expect(profile.intendedAudience).toBe("patients");
    expect(profile.accessibility).toEqual({
      reducedMotionPriority: true,
      cognitiveSimplicityPriority: true,
    });
    expect(recommendInteraction(profile).config.enabled).toBe(false);
  });

  it("does not invent unverified products, logo, palette, or performance data", () => {
    const profile = interactionProfileFromCompany({
      name: "Example Company",
      industry: "Professional services",
    });

    expect(profile.servicesOrProducts).toEqual([]);
    expect(profile.hasLogo).toBe(false);
    expect(profile.paletteStyle).toBe("unknown");
    expect(profile.performanceCondition).toBe("standard");
  });
});
