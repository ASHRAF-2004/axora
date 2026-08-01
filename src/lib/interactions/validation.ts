import { z } from "zod";
import { getInteractionAsset } from "./catalog";
import { intersectsRect, type ProtectedRect, type Rect, type Size } from "./geometry";
import {
  InteractionConfigSchema,
  type InteractionAssetId,
  type InteractionConfig,
} from "./schema";

export type PublicationIssueSeverity = "error" | "warning";

export interface PublicationValidationIssue {
  code:
    | "invalid-config"
    | "asset-not-approved"
    | "asset-not-licensed"
    | "asset-type-mismatch"
    | "fallback-not-approved"
    | "fallback-missing"
    | "performance-budget"
    | "tone-unsuitable"
    | "mobile-performance"
    | "accessibility-label"
    | "pause-control-missing"
    | "dismiss-control-missing"
    | "protected-control-overlap"
    | "horizontal-overflow"
    | "vertical-overflow"
    | "tenant-isolation";
  severity: PublicationIssueSeverity;
  path: string;
  message: string;
}

export interface PublicationValidationContext {
  pageTone?: "restrained" | "balanced" | "expressive";
  viewport?: Size;
  interactionRect?: Rect;
  protectedRects?: readonly ProtectedRect[];
  measuredAssetBytes?: number;
  measuredRuntimeBytes?: number;
  allowedAssetIds?: readonly InteractionAssetId[];
}

export interface PublicationValidationResult {
  valid: boolean;
  config: InteractionConfig | null;
  errors: readonly PublicationValidationIssue[];
  warnings: readonly PublicationValidationIssue[];
  issues: readonly PublicationValidationIssue[];
}

export class InteractionPublicationError extends Error {
  readonly issues: readonly PublicationValidationIssue[];

  constructor(issues: readonly PublicationValidationIssue[]) {
    super(issues.map((issue) => issue.message).join(" "));
    this.name = "InteractionPublicationError";
    this.issues = issues;
  }
}

const PERFORMANCE_BUDGETS = {
  low: { assetBytes: 100_000, runtimeBytes: 16_000 },
  balanced: { assetBytes: 300_000, runtimeBytes: 48_000 },
  rich: { assetBytes: 800_000, runtimeBytes: 128_000 },
} as const;

function result(config: InteractionConfig | null, issues: PublicationValidationIssue[]): PublicationValidationResult {
  const errors = issues.filter((issue) => issue.severity === "error");
  const warnings = issues.filter((issue) => issue.severity === "warning");
  return { valid: errors.length === 0, config, errors, warnings, issues };
}

function zodIssues(error: z.ZodError): PublicationValidationIssue[] {
  return error.issues.map((issue) => ({
    code: "invalid-config",
    severity: "error",
    path: issue.path.join("."),
    message: issue.message,
  }));
}

export function validateInteractionForPublication(
  input: unknown,
  context: PublicationValidationContext = {},
): PublicationValidationResult {
  const parsed = InteractionConfigSchema.safeParse(input);
  if (!parsed.success) return result(null, zodIssues(parsed.error));
  const config = parsed.data;
  if (!config.enabled) return result(config, []);

  const issues: PublicationValidationIssue[] = [];
  const asset = getInteractionAsset(config.assetId);
  if (!asset || asset.purpose === "fallback") {
    issues.push({
      code: "asset-not-approved",
      severity: "error",
      path: "assetId",
      message: "The selected interaction asset is not approved as a runtime experience.",
    });
  } else {
    if (!asset.license.commercialUseApproved
      || !asset.license.localCopyApproved
      || !asset.license.inventoryDocument
      || !asset.license.exactLicense
      || (asset.license.attributionRequired && !asset.license.attributionDocument)) {
      issues.push({
        code: "asset-not-licensed",
        severity: "error",
        path: "assetId",
        message: "The selected interaction asset does not have a complete commercial-use license record.",
      });
    }
    if (!asset.supportedInteractionTypes.includes(config.interactionType)) {
      issues.push({
        code: "asset-type-mismatch",
        severity: "error",
        path: "interactionType",
        message: "The selected asset is not approved for this interaction type.",
      });
    }
  }

  const fallback = config.fallback.kind === "hidden" ? undefined : getInteractionAsset(config.fallback.assetId);
  if (config.fallback.kind === "hidden") {
    issues.push({
      code: "fallback-missing",
      severity: "error",
      path: "fallback",
      message: "Published interactions require a static fallback for reduced motion and runtime failure.",
    });
  } else if (!fallback || (fallback.purpose !== "fallback" && fallback.purpose !== "both")) {
    issues.push({
      code: "fallback-not-approved",
      severity: "error",
      path: "fallback.assetId",
      message: "The selected static fallback is not in the approved fallback catalog.",
    });
  } else if (!fallback.supportedInteractionTypes.includes(config.interactionType)) {
    issues.push({
      code: "fallback-not-approved",
      severity: "error",
      path: "fallback.assetId",
      message: "The selected static fallback is not approved for this interaction type.",
    });
  } else if (!fallback.license.commercialUseApproved
    || !fallback.license.localCopyApproved
    || !fallback.license.exactLicense
    || (fallback.license.attributionRequired && !fallback.license.attributionDocument)) {
    issues.push({
      code: "asset-not-licensed",
      severity: "error",
      path: "fallback.assetId",
      message: "The selected fallback does not have a complete commercial-use license record.",
    });
  }

  if (context.allowedAssetIds && (!context.allowedAssetIds.includes(config.assetId)
    || (config.fallback.assetId !== "none" && !context.allowedAssetIds.includes(config.fallback.assetId)))) {
    issues.push({
      code: "tenant-isolation",
      severity: "error",
      path: "assetId",
      message: "This tenant is not allowed to publish one or more selected interaction assets.",
    });
  }

  const budget = PERFORMANCE_BUDGETS[config.performanceTier];
  const assetBytes = context.measuredAssetBytes ?? asset?.performance.estimatedAssetBytes ?? 0;
  const runtimeBytes = context.measuredRuntimeBytes ?? asset?.performance.estimatedRuntimeBytes ?? 0;
  if (assetBytes > budget.assetBytes || runtimeBytes > budget.runtimeBytes) {
    issues.push({
      code: "performance-budget",
      severity: "error",
      path: "performanceTier",
      message: `The interaction exceeds the ${config.performanceTier} performance budget.`,
    });
  }
  if (context.viewport && context.viewport.width <= 640 && config.mobileBehavior === "full" && config.performanceTier === "rich") {
    issues.push({
      code: "mobile-performance",
      severity: "warning",
      path: "mobileBehavior",
      message: "Full rich motion may perform poorly on a small mobile viewport; use reduced or static behavior.",
    });
  }

  const characterLike = ["mascot", "guided-character", "lightweight-2d-scene"].includes(config.interactionType);
  if ((context.pageTone ?? "balanced") === "restrained" && (characterLike || config.intensity === "lively")) {
    issues.push({
      code: "tone-unsuitable",
      severity: "error",
      path: "interactionType",
      message: "This character or motion intensity is unsuitable for a restrained company tone.",
    });
  }

  if (config.semanticRole === "informative" && !config.accessibleLabel) {
    issues.push({
      code: "accessibility-label",
      severity: "error",
      path: "accessibleLabel",
      message: "An informative interaction requires an accessible text equivalent.",
    });
  }
  if (config.automaticMovement && !config.allowVisitorPause) {
    issues.push({
      code: "pause-control-missing",
      severity: "error",
      path: "allowVisitorPause",
      message: "Persistent automatic movement requires a visible visitor pause control.",
    });
  }
  if (config.initialPlacement.startsWith("fixed-") && !config.allowVisitorDismiss) {
    issues.push({
      code: "dismiss-control-missing",
      severity: "error",
      path: "allowVisitorDismiss",
      message: "A persistent fixed interaction requires a visible dismiss control.",
    });
  }

  if (context.viewport && context.interactionRect) {
    const { viewport, interactionRect } = context;
    if (interactionRect.x < 0 || interactionRect.x + interactionRect.width > viewport.width) {
      issues.push({
        code: "horizontal-overflow",
        severity: "error",
        path: "initialPlacement",
        message: "The interaction would cause horizontal overflow at this viewport size.",
      });
    }
    if (interactionRect.y < 0 || interactionRect.y + interactionRect.height > viewport.height) {
      issues.push({
        code: "vertical-overflow",
        severity: "warning",
        path: "initialPlacement",
        message: "Part of the interaction is outside the current viewport.",
      });
    }
    if ((context.protectedRects ?? []).some((protectedRect) => intersectsRect(interactionRect, protectedRect))) {
      issues.push({
        code: "protected-control-overlap",
        severity: "error",
        path: "permittedRegion",
        message: "The interaction overlaps navigation, a form, a call to action, consent, or legal content.",
      });
    }
  }

  return result(config, issues);
}

export function assertInteractionPublishable(
  input: unknown,
  context: PublicationValidationContext = {},
): InteractionConfig {
  const validation = validateInteractionForPublication(input, context);
  if (!validation.valid || !validation.config) throw new InteractionPublicationError(validation.errors);
  return validation.config;
}
