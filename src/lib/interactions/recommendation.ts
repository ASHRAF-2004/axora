import {
  DEFAULT_ABSTRACT_INTERACTION_CONFIG,
  DEFAULT_DISABLED_INTERACTION_CONFIG,
  DEFAULT_MASCOT_CONFIG,
  DEFAULT_RESTRAINED_MOTION_CONFIG,
} from "./catalog";
import {
  CompanyInteractionProfileSchema,
  INTERACTION_RECOMMENDATION_POLICY_VERSION,
  InteractionRecommendationSchema,
  type ActiveInteractionConfig,
  type CompanyInteractionProfile,
  type InteractionConfig,
  type InteractionRecommendation,
} from "./schema";

const NO_INTERACTION_INDUSTRY = /\b(?:bank|banking|finance|financial|insurance|legal|law|healthcare|medical|clinic|hospital|government|public administration)\b/i;
const TECHNOLOGY_INDUSTRY = /\b(?:technology|software|digital|robotics|automation|artificial intelligence|information technology|cybersecurity)\b/i;
const EDUCATION_INDUSTRY = /\b(?:education|school|university|college|learning|training)\b/i;
const INDUSTRIAL_INDUSTRY = /\b(?:manufacturing|industrial|construction|engineering|logistics|freight|supply chain)\b/i;
const CONSULTANCY_INDUSTRY = /\b(?:consultancy|consulting|accounting|professional services)\b/i;

function cloneConfig<T extends InteractionConfig>(config: T): T {
  return structuredClone(config);
}

function stableHash(value: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function recommendationId(profile: CompanyInteractionProfile, config: InteractionConfig) {
  const signature = JSON.stringify({
    companyName: profile.companyName.trim().toLocaleLowerCase("en"),
    industry: profile.industry.trim().toLocaleLowerCase("en"),
    personalities: [...profile.brandPersonality].sort(),
    audience: profile.intendedAudience,
    purpose: profile.websitePurpose,
    accessibility: profile.accessibility,
    deviceMix: profile.deviceMix,
    performance: profile.performanceCondition,
    assetId: config.assetId,
  });
  return `rec_${stableHash(signature)}_${config.assetId.replace(/[^a-z0-9]+/g, "_")}`;
}

function tuneForConditions(config: ActiveInteractionConfig, profile: CompanyInteractionProfile): ActiveInteractionConfig {
  const tuned = cloneConfig(config);
  if (profile.performanceCondition === "low") {
    tuned.performanceTier = "low";
    tuned.mobileBehavior = "static";
    tuned.desktopBehavior = tuned.interactionType === "restrained-motion" ? "reduced" : "static";
    tuned.intensity = "subtle";
    tuned.automaticMovement = false;
    tuned.dragEnabled = false;
  } else if (profile.deviceMix === "mobile-first") {
    tuned.mobileBehavior = "reduced";
    tuned.scale = Math.min(tuned.scale, 0.85);
    tuned.walkingSpeed = Math.min(tuned.walkingSpeed, 30);
  }
  if (profile.accessibility.reducedMotionPriority) {
    tuned.intensity = "subtle";
    tuned.mobileBehavior = "static";
    tuned.reducedMotionBehavior = "static";
    tuned.automaticMovement = false;
  }
  if (profile.accessibility.cognitiveSimplicityPriority) {
    tuned.reactionsEnabled = false;
    tuned.dragEnabled = false;
    tuned.intensity = "subtle";
  }
  if (profile.paletteStyle === "neutral" || profile.paletteStyle === "restrained") tuned.colorTreatment = "neutral";
  return tuned;
}

function noInteractionRecommendation(profile: CompanyInteractionProfile, rationale: string): InteractionRecommendation {
  const config = cloneConfig(DEFAULT_DISABLED_INTERACTION_CONFIG);
  return InteractionRecommendationSchema.parse({
    schemaVersion: 1,
    recommendationId: recommendationId(profile, config),
    policyVersion: INTERACTION_RECOMMENDATION_POLICY_VERSION,
    config,
    rationale,
    confidence: "high",
    metrics: { toneFit: 98, accessibilityFit: 100, performanceFit: 100 },
    alternativeAssetIds: ["axora-restrained-motion-v1"],
  });
}

export function recommendInteraction(input: CompanyInteractionProfile): InteractionRecommendation {
  const profile = CompanyInteractionProfileSchema.parse(input);
  const personality = new Set(profile.brandPersonality);
  const stronglyRestrained = NO_INTERACTION_INDUSTRY.test(profile.industry)
    || (personality.has("formal") && personality.has("premium"))
    || (profile.accessibility.cognitiveSimplicityPriority && profile.accessibility.reducedMotionPriority);

  if (stronglyRestrained) {
    return noInteractionRecommendation(
      profile,
      `${profile.companyName} has a restrained, trust-sensitive profile, so Axora recommends no persistent character or ambient animation.`,
    );
  }

  if (profile.performanceCondition === "low") {
    return noInteractionRecommendation(
      profile,
      `${profile.companyName} is expected to serve lower-performance devices, so Axora recommends a static experience for fast, predictable access.`,
    );
  }

  let config: ActiveInteractionConfig;
  let rationale: string;
  let confidence: "medium" | "high" = "high";
  let alternativeAssetIds: InteractionRecommendation["alternativeAssetIds"];

  const friendlyTechnology = TECHNOLOGY_INDUSTRY.test(profile.industry)
    && (personality.has("friendly") || personality.has("playful") || personality.has("modern"));
  if (friendlyTechnology) {
    config = cloneConfig(DEFAULT_MASCOT_CONFIG);
    rationale = `Axora selected a lightweight interactive robot because ${profile.companyName} is technology-focused with a friendly, modern identity. It stays inside approved content regions and becomes static under reduced motion.`;
    alternativeAssetIds = ["axora-orbit-v1", "axora-restrained-motion-v1", "none"];
  } else if (EDUCATION_INDUSTRY.test(profile.industry) && (profile.intendedAudience === "children" || profile.intendedAudience === "students")) {
    config = cloneConfig(DEFAULT_MASCOT_CONFIG);
    config.interactionType = "guided-character";
    config.automaticMovement = false;
    config.initialPlacement = "feature-area";
    config.permittedRegion = "features";
    rationale = `Axora selected a friendly learning guide for ${profile.companyName}; it reacts only in the feature area and never carries essential learning content.`;
    alternativeAssetIds = ["axora-orbit-v1", "axora-restrained-motion-v1", "none"];
  } else if (INDUSTRIAL_INDUSTRY.test(profile.industry) || CONSULTANCY_INDUSTRY.test(profile.industry) || personality.has("formal")) {
    config = cloneConfig(DEFAULT_RESTRAINED_MOTION_CONFIG);
    rationale = `Axora selected restrained section motion to support ${profile.companyName}'s professional tone without introducing a character or distracting from services and evidence.`;
    alternativeAssetIds = ["none", "axora-orbit-v1"];
  } else {
    config = cloneConfig(DEFAULT_ABSTRACT_INTERACTION_CONFIG);
    rationale = `Axora selected a lightweight geometric illustration that suits ${profile.companyName}'s brand without imposing a character personality. Motion remains bounded and has a static fallback.`;
    alternativeAssetIds = ["axora-restrained-motion-v1", "none"];
    confidence = "medium";
  }

  config = tuneForConditions(config, profile);
  const performanceFit = config.performanceTier === "rich" ? 82 : 97;
  const accessibilityFit = profile.accessibility.reducedMotionPriority ? 98 : 96;
  const toneFit = confidence === "high" ? 94 : 84;

  return InteractionRecommendationSchema.parse({
    schemaVersion: 1,
    recommendationId: recommendationId(profile, config),
    policyVersion: INTERACTION_RECOMMENDATION_POLICY_VERSION,
    config,
    rationale,
    confidence,
    metrics: { toneFit, accessibilityFit, performanceFit },
    alternativeAssetIds,
  });
}
