import { describe, expect, it } from "vitest";
import {
  CompanyInteractionProfileSchema,
  DEFAULT_DISABLED_INTERACTION_CONFIG,
  DEFAULT_MASCOT_CONFIG,
  InteractionConfigSchema,
  OwnerInteractionChoiceSchema,
  parseInteractionConfig,
} from "@/lib/interactions";

describe("trusted interaction schema", () => {
  it("accepts only the complete approved active and disabled shapes", () => {
    expect(InteractionConfigSchema.parse(DEFAULT_MASCOT_CONFIG)).toEqual(DEFAULT_MASCOT_CONFIG);
    expect(InteractionConfigSchema.parse(DEFAULT_DISABLED_INTERACTION_CONFIG)).toEqual(DEFAULT_DISABLED_INTERACTION_CONFIG);
  });

  it("rejects unknown and executable fields at every boundary", () => {
    expect(InteractionConfigSchema.safeParse({ ...DEFAULT_MASCOT_CONFIG, javascript: "alert(1)" }).success).toBe(false);
    expect(InteractionConfigSchema.safeParse({
      ...DEFAULT_MASCOT_CONFIG,
      fallback: { ...DEFAULT_MASCOT_CONFIG.fallback, onClick: "run()" },
    }).success).toBe(false);
    expect(InteractionConfigSchema.safeParse({
      ...DEFAULT_MASCOT_CONFIG,
      semanticRole: "informative",
      accessibleLabel: "javascript:alert(1)",
    }).success).toBe(false);
    expect(InteractionConfigSchema.safeParse({
      ...DEFAULT_MASCOT_CONFIG,
      render: () => null,
    }).success).toBe(false);
  });

  it("rejects unsupported identifiers, unsafe values, and inconsistent controls", () => {
    expect(InteractionConfigSchema.safeParse({ ...DEFAULT_MASCOT_CONFIG, assetId: "https://evil.example/robot.riv" }).success).toBe(false);
    expect(InteractionConfigSchema.safeParse({ ...DEFAULT_MASCOT_CONFIG, interactionType: "arbitrary-code" }).success).toBe(false);
    expect(InteractionConfigSchema.safeParse({ ...DEFAULT_MASCOT_CONFIG, scale: 50 }).success).toBe(false);
    expect(InteractionConfigSchema.safeParse({ ...DEFAULT_MASCOT_CONFIG, walkingSpeed: -1 }).success).toBe(false);
    expect(InteractionConfigSchema.safeParse({
      ...DEFAULT_MASCOT_CONFIG,
      interactionTriggers: DEFAULT_MASCOT_CONFIG.interactionTriggers.filter((trigger) => trigger !== "pointer"),
    }).success).toBe(false);
    expect(InteractionConfigSchema.safeParse({
      ...DEFAULT_MASCOT_CONFIG,
      approvedStates: DEFAULT_MASCOT_CONFIG.approvedStates.filter((state) => !state.startsWith("walking-")),
    }).success).toBe(false);
  });

  it("keeps a disabled choice structurally disabled", () => {
    const accepted = OwnerInteractionChoiceSchema.safeParse({
      schemaVersion: 1,
      recommendationId: "rec_123456_disabled",
      decision: "disabled",
      config: DEFAULT_DISABLED_INTERACTION_CONFIG,
      savedAt: "2026-08-01T12:00:00+08:00",
    });
    expect(accepted.success).toBe(true);
    expect(OwnerInteractionChoiceSchema.safeParse({
      schemaVersion: 1,
      recommendationId: "rec_123456_disabled",
      decision: "disabled",
      config: DEFAULT_MASCOT_CONFIG,
      savedAt: "2026-08-01T12:00:00+08:00",
    }).success).toBe(false);
  });

  it("validates company inputs without accepting generated behavior code", () => {
    const profile = {
      companyName: "Northstar Learning",
      industry: "Education",
      brandPersonality: ["friendly", "modern"],
      hasLogo: true,
      paletteStyle: "vibrant",
      servicesOrProducts: ["Training"],
      intendedAudience: "students",
      websitePurpose: "education",
      accessibility: { reducedMotionPriority: false, cognitiveSimplicityPriority: false },
      deviceMix: "balanced",
      performanceCondition: "standard",
    } as const;
    expect(CompanyInteractionProfileSchema.safeParse(profile).success).toBe(true);
    expect(CompanyInteractionProfileSchema.safeParse({ ...profile, generatedHandler: "() => run()" }).success).toBe(false);
    expect(CompanyInteractionProfileSchema.safeParse({ ...profile, industry: "<script>alert(1)</script>" }).success).toBe(false);
  });

  it("provides one parsing entry point for untrusted JSON", () => {
    expect(parseInteractionConfig(structuredClone(DEFAULT_MASCOT_CONFIG))).toEqual(DEFAULT_MASCOT_CONFIG);
    expect(() => parseInteractionConfig({ enabled: true })).toThrow();
  });
});
