import type { Company } from "../types";
import {
  CompanyInteractionProfileSchema,
  type CompanyInteractionProfile,
} from "./schema";

const REGULATED = /\b(?:bank|banking|finance|financial|insurance|legal|law|healthcare|medical|clinic|hospital|government)\b/i;
const TECHNOLOGY = /\b(?:technology|software|digital|robotics|automation|artificial intelligence|information technology|cybersecurity)\b/i;
const EDUCATION = /\b(?:education|school|university|college|learning|training)\b/i;
const HEALTHCARE = /\b(?:healthcare|medical|clinic|hospital)\b/i;
const INDUSTRIAL = /\b(?:manufacturing|industrial|construction|engineering|logistics|freight|supply chain)\b/i;

/**
 * Adapts the company facts Axora currently stores to the interaction
 * recommendation contract. Unknown brand facts stay unknown instead of being
 * invented. A future website-brand profile can supply verified logo, palette,
 * audience, product, and device information through the same strict schema.
 */
export function interactionProfileFromCompany(
  company: Pick<Company, "name" | "industry">,
): CompanyInteractionProfile {
  const industry = company.industry.trim() || "Unspecified industry";
  const regulated = REGULATED.test(industry);

  let brandPersonality: CompanyInteractionProfile["brandPersonality"] = [
    "modern",
  ];
  if (regulated) brandPersonality = ["formal", "calm"];
  else if (TECHNOLOGY.test(industry)) {
    brandPersonality = ["modern", "technical", "friendly"];
  } else if (EDUCATION.test(industry)) {
    brandPersonality = ["friendly", "calm"];
  } else if (INDUSTRIAL.test(industry)) {
    brandPersonality = ["technical", "formal"];
  }

  const intendedAudience: CompanyInteractionProfile["intendedAudience"] =
    HEALTHCARE.test(industry)
      ? "patients"
      : EDUCATION.test(industry)
        ? "students"
        : "business";

  return CompanyInteractionProfileSchema.parse({
    companyName: company.name,
    industry,
    brandPersonality,
    hasLogo: false,
    paletteStyle: "unknown",
    servicesOrProducts: [],
    intendedAudience,
    websitePurpose: "company-profile",
    accessibility: {
      reducedMotionPriority: regulated,
      cognitiveSimplicityPriority: regulated,
    },
    deviceMix: "balanced",
    performanceCondition: "standard",
  });
}
