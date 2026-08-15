import type { SemanticModelId } from "./immersive-public-experience";

export type ImmersiveScenePhase = "loading" | "ready" | "transitioning" | "fallback";

export type ImmersiveSceneBounds = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
};

export type ImmersiveSceneRuntime = {
  phase: ImmersiveScenePhase;
  requestedAsset: SemanticModelId;
  attachedAsset: SemanticModelId | null;
  renderedAsset: SemanticModelId | null;
  transitionFrom: SemanticModelId | null;
  bounds: ImmersiveSceneBounds | null;
  insideFrustum: boolean;
};

export function normalizationScale(
  dimensions: { x: number; y: number; z: number },
  targetLongestSide = 3.2,
) {
  const longest = Math.max(dimensions.x, dimensions.y, dimensions.z);
  if (!Number.isFinite(longest) || longest <= 0) {
    throw new Error("The semantic model has no usable bounds.");
  }
  return targetLongestSide / longest;
}

export function cameraDistanceForBounds(
  dimensions: { x: number; y: number; z: number },
  aspect: number,
  verticalFovDegrees = 42,
  margin = 1.28,
) {
  const safeAspect = Math.max(0.45, Number.isFinite(aspect) ? aspect : 1);
  const verticalFov = verticalFovDegrees * Math.PI / 180;
  const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * safeAspect);
  const verticalDistance = dimensions.y / (2 * Math.tan(verticalFov / 2));
  const horizontalDistance = dimensions.x / (2 * Math.tan(horizontalFov / 2));
  return Math.max(4.8, (Math.max(verticalDistance, horizontalDistance) + dimensions.z / 2) * margin);
}

export function projectedBoundsAreUsable(bounds: ImmersiveSceneBounds) {
  return [bounds.left, bounds.top, bounds.right, bounds.bottom, bounds.width, bounds.height]
    .every(Number.isFinite)
    && bounds.left >= 0.015
    && bounds.top >= 0.015
    && bounds.right <= 0.985
    && bounds.bottom <= 0.985
    && bounds.width >= 0.08
    && bounds.height >= 0.08;
}
