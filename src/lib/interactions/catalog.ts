import type {
  ActiveInteractionConfig,
  ActiveInteractionType,
  DisabledInteractionConfig,
  InteractionAssetId,
} from "./schema";

export type TrustedInteractionComponentId =
  | "axora-buddy"
  | "axora-restrained-motion"
  | "axora-orbit"
  | "axora-static-mark";

export interface InteractionAssetLicense {
  name: string;
  source: string;
  exactLicense: string;
  commercialUseApproved: true;
  attributionRequired: boolean;
  attributionDocument: `/${string}` | null;
  localCopyApproved: true;
  inventoryDocument: "/docs/INTERACTION_ASSET_LICENSES.md";
}

export interface ApprovedInteractionAsset {
  id: Exclude<InteractionAssetId, "none">;
  displayName: string;
  description: string;
  componentId: TrustedInteractionComponentId;
  integrity: {
    algorithm: "sha256";
    digest: string;
    sourcePath: string;
  };
  purpose: "runtime" | "fallback" | "both";
  supportedInteractionTypes: readonly ActiveInteractionType[];
  localAssetPath: `/${string}` | null;
  fallbackAssetId: Exclude<InteractionAssetId, "none">;
  license: InteractionAssetLicense;
  performance: {
    estimatedAssetBytes: number;
    estimatedRuntimeBytes: number;
    requiresCanvas: false;
    requiresWebGl: false;
  };
  toneTags: readonly ("restrained" | "balanced" | "friendly" | "expressive")[];
}

const AXORA_ORIGINAL_LICENSE = {
  name: "Axora original asset",
  source: "Axora",
  exactLicense: "Copyright Axora; original project work",
  commercialUseApproved: true,
  attributionRequired: false,
  attributionDocument: null,
  localCopyApproved: true,
  inventoryDocument: "/docs/INTERACTION_ASSET_LICENSES.md",
} as const satisfies InteractionAssetLicense;

const LUCIDE_DERIVATIVE_LICENSE = {
  name: "ISC License",
  source: "Lucide Boxes icon; modified locally by Axora",
  exactLicense: "ISC License; Copyright (c) 2026 Lucide Icons and Contributors",
  commercialUseApproved: true,
  attributionRequired: true,
  attributionDocument: "/THIRD_PARTY_NOTICES.md",
  localCopyApproved: true,
  inventoryDocument: "/docs/INTERACTION_ASSET_LICENSES.md",
} as const satisfies InteractionAssetLicense;

export const APPROVED_INTERACTION_CATALOG = {
  "axora-buddy-v1": {
    id: "axora-buddy-v1",
    displayName: "Axora Buddy",
    description: "An original lightweight technology mascot with bounded walking, pickup, landing, and reaction states.",
    componentId: "axora-buddy",
    integrity: {
      algorithm: "sha256",
      digest: "f9faf1a5bf0389d09c6ad4047c0b847bc1252f8bdda354e6a464699e39470765",
      sourcePath: "public/interactions/axora-buddy-static.svg",
    },
    purpose: "both",
    supportedInteractionTypes: ["mascot", "guided-character"],
    localAssetPath: "/interactions/axora-buddy-static.svg",
    fallbackAssetId: "axora-buddy-v1",
    license: AXORA_ORIGINAL_LICENSE,
    performance: {
      estimatedAssetBytes: 7_000,
      // Conservative minified transfer estimate for the trusted Motion path.
      // Publication may replace this with a measured bundle value.
      estimatedRuntimeBytes: 45_000,
      requiresCanvas: false,
      requiresWebGl: false,
    },
    toneTags: ["friendly", "balanced", "expressive"],
  },
  "axora-restrained-motion-v1": {
    id: "axora-restrained-motion-v1",
    displayName: "Restrained section motion",
    description: "Trusted CSS transitions for calm section entrances and small emphasis changes.",
    componentId: "axora-restrained-motion",
    integrity: {
      algorithm: "sha256",
      digest: "9b34255aafac140af665b1fa1dd6e1b9c7759ffea24198992222c9eac327a5b6",
      sourcePath: "src/components/interactions/TrustedInteractionRenderer.tsx",
    },
    purpose: "runtime",
    supportedInteractionTypes: ["restrained-motion"],
    localAssetPath: null,
    fallbackAssetId: "axora-mark-static-v1",
    license: AXORA_ORIGINAL_LICENSE,
    performance: {
      estimatedAssetBytes: 0,
      estimatedRuntimeBytes: 8_000,
      requiresCanvas: false,
      requiresWebGl: false,
    },
    toneTags: ["restrained", "balanced"],
  },
  "axora-orbit-v1": {
    id: "axora-orbit-v1",
    displayName: "Axora Orbit",
    description: "A trusted DOM and SVG geometric illustration for modern, technical brands.",
    componentId: "axora-orbit",
    integrity: {
      algorithm: "sha256",
      digest: "9b34255aafac140af665b1fa1dd6e1b9c7759ffea24198992222c9eac327a5b6",
      sourcePath: "src/components/interactions/TrustedInteractionRenderer.tsx",
    },
    purpose: "runtime",
    supportedInteractionTypes: ["abstract-illustration", "interactive-background"],
    localAssetPath: null,
    fallbackAssetId: "axora-mark-static-v1",
    license: AXORA_ORIGINAL_LICENSE,
    performance: {
      estimatedAssetBytes: 0,
      estimatedRuntimeBytes: 8_000,
      requiresCanvas: false,
      requiresWebGl: false,
    },
    toneTags: ["balanced", "friendly", "expressive"],
  },
  "axora-mark-static-v1": {
    id: "axora-mark-static-v1",
    displayName: "Axora static mark",
    description: "A static, non-animated fallback rendered by a trusted Axora component.",
    componentId: "axora-static-mark",
    integrity: {
      algorithm: "sha256",
      digest: "6bb933938c6c5e484de658566e73a634184473c0739bfce1f26e2a5119e8a4ae",
      sourcePath: "public/brand/axora-mark.svg",
    },
    purpose: "fallback",
    supportedInteractionTypes: ["restrained-motion", "abstract-illustration", "interactive-background"],
    localAssetPath: "/brand/axora-mark.svg",
    fallbackAssetId: "axora-mark-static-v1",
    license: LUCIDE_DERIVATIVE_LICENSE,
    performance: {
      estimatedAssetBytes: 2_000,
      estimatedRuntimeBytes: 0,
      requiresCanvas: false,
      requiresWebGl: false,
    },
    toneTags: ["restrained", "balanced", "friendly", "expressive"],
  },
} as const satisfies Record<Exclude<InteractionAssetId, "none">, ApprovedInteractionAsset>;

export const DEFAULT_DISABLED_INTERACTION_CONFIG = {
  schemaVersion: 1,
  enabled: false,
  interactionType: "none",
  assetId: "none",
  scale: 1,
  initialPlacement: "hero-right",
  permittedRegion: "hero",
  intensity: "none",
  dragEnabled: false,
  automaticMovement: false,
  reactionsEnabled: false,
  walkingSpeed: 0,
  idleFrequencySeconds: 0,
  resumeDelayMs: 0,
  desktopBehavior: "static",
  mobileBehavior: "static",
  reducedMotionBehavior: "static",
  performanceTier: "low",
  fallback: { kind: "hidden", assetId: "none" },
  semanticRole: "decorative",
  accessibleLabel: null,
  colorTreatment: "brand",
  allowVisitorPause: false,
  allowVisitorDismiss: false,
  approvedStates: [],
  interactionTriggers: [],
  protectedZones: ["primary-navigation", "forms", "calls-to-action", "consent", "legal"],
} as const satisfies DisabledInteractionConfig;

export const DEFAULT_MASCOT_CONFIG = {
  schemaVersion: 1,
  enabled: true,
  interactionType: "mascot",
  assetId: "axora-buddy-v1",
  scale: 1,
  initialPlacement: "hero-right",
  permittedRegion: "hero",
  intensity: "moderate",
  dragEnabled: true,
  automaticMovement: true,
  reactionsEnabled: true,
  walkingSpeed: 38,
  idleFrequencySeconds: 7,
  resumeDelayMs: 900,
  desktopBehavior: "full",
  mobileBehavior: "reduced",
  reducedMotionBehavior: "static",
  performanceTier: "balanced",
  fallback: { kind: "static-svg", assetId: "axora-buddy-v1" },
  semanticRole: "decorative",
  accessibleLabel: null,
  colorTreatment: "brand",
  allowVisitorPause: true,
  allowVisitorDismiss: true,
  approvedStates: [
    "loading", "idle", "walking-left", "walking-right", "turning", "hovered", "pressed",
    "grabbed", "being-carried", "released", "falling", "landing", "recovering", "reacting",
    "paused", "hidden", "reduced-motion", "error-fallback",
  ],
  interactionTriggers: ["pointer", "hover", "visibility", "route", "resize"],
  protectedZones: ["primary-navigation", "forms", "calls-to-action", "consent", "legal"],
} as const satisfies ActiveInteractionConfig;

export const DEFAULT_RESTRAINED_MOTION_CONFIG = {
  schemaVersion: 1,
  enabled: true,
  interactionType: "restrained-motion",
  assetId: "axora-restrained-motion-v1",
  scale: 1,
  initialPlacement: "feature-area",
  permittedRegion: "features",
  intensity: "subtle",
  dragEnabled: false,
  automaticMovement: false,
  reactionsEnabled: false,
  walkingSpeed: 24,
  idleFrequencySeconds: 12,
  resumeDelayMs: 700,
  desktopBehavior: "reduced",
  mobileBehavior: "static",
  reducedMotionBehavior: "static",
  performanceTier: "low",
  fallback: { kind: "static-svg", assetId: "axora-mark-static-v1" },
  semanticRole: "decorative",
  accessibleLabel: null,
  colorTreatment: "brand",
  allowVisitorPause: true,
  allowVisitorDismiss: false,
  approvedStates: ["loading", "idle", "paused", "hidden", "reduced-motion", "error-fallback"],
  interactionTriggers: ["scroll", "visibility", "route"],
  protectedZones: ["primary-navigation", "forms", "calls-to-action", "consent", "legal"],
} as const satisfies ActiveInteractionConfig;

export const DEFAULT_ABSTRACT_INTERACTION_CONFIG = {
  ...DEFAULT_RESTRAINED_MOTION_CONFIG,
  interactionType: "abstract-illustration",
  assetId: "axora-orbit-v1",
  initialPlacement: "hero-left",
  permittedRegion: "hero",
  intensity: "moderate",
  reactionsEnabled: true,
  desktopBehavior: "full",
  mobileBehavior: "reduced",
  performanceTier: "balanced",
  interactionTriggers: ["hover", "scroll", "visibility", "route"],
} as const satisfies ActiveInteractionConfig;

export function getInteractionAsset(id: InteractionAssetId): ApprovedInteractionAsset | undefined {
  if (id === "none") return undefined;
  return APPROVED_INTERACTION_CATALOG[id];
}

export function isApprovedInteractionAsset(id: string): id is Exclude<InteractionAssetId, "none"> {
  return Object.hasOwn(APPROVED_INTERACTION_CATALOG, id);
}
