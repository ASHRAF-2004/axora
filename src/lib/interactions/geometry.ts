export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Rect extends Point, Size {}

export interface ProtectedRect extends Rect {
  id: string;
}

export interface MovementBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export interface SafePositionResult {
  point: Point;
  adjusted: boolean;
  safe: boolean;
  blockedBy: readonly string[];
}

function assertFinite(label: string, value: number) {
  if (!Number.isFinite(value)) throw new TypeError(`${label} must be a finite number.`);
}

function assertSize(size: Size) {
  assertFinite("Width", size.width);
  assertFinite("Height", size.height);
  if (size.width < 0 || size.height < 0) throw new RangeError("Dimensions cannot be negative.");
}

function assertRect(rect: Rect) {
  assertFinite("X", rect.x);
  assertFinite("Y", rect.y);
  assertSize(rect);
}

export function calculateMovementBounds(region: Rect, sprite: Size, padding = 0): MovementBounds {
  assertRect(region);
  assertSize(sprite);
  assertFinite("Padding", padding);
  if (padding < 0 || padding > 128) throw new RangeError("Padding must be between 0 and 128 pixels.");
  if (sprite.width + padding * 2 > region.width || sprite.height + padding * 2 > region.height) {
    throw new RangeError("The interaction does not fit inside its permitted region.");
  }

  const minX = region.x + padding;
  const minY = region.y + padding;
  return {
    minX,
    maxX: region.x + region.width - padding - sprite.width,
    minY,
    maxY: region.y + region.height - padding - sprite.height,
  };
}

export function clampPointToBounds(point: Point, bounds: MovementBounds): Point {
  assertFinite("Point X", point.x);
  assertFinite("Point Y", point.y);
  for (const [label, value] of Object.entries(bounds)) assertFinite(label, value);
  if (bounds.maxX < bounds.minX || bounds.maxY < bounds.minY) throw new RangeError("Movement bounds are inverted.");
  return {
    x: Math.min(bounds.maxX, Math.max(bounds.minX, point.x)),
    y: Math.min(bounds.maxY, Math.max(bounds.minY, point.y)),
  };
}

export function rectAtPoint(point: Point, size: Size): Rect {
  assertSize(size);
  return { x: point.x, y: point.y, width: size.width, height: size.height };
}

export function intersectsRect(first: Rect, second: Rect): boolean {
  assertRect(first);
  assertRect(second);
  return first.x < second.x + second.width
    && first.x + first.width > second.x
    && first.y < second.y + second.height
    && first.y + first.height > second.y;
}

export function isPointInProtectedZone(point: Point, protectedZones: readonly ProtectedRect[]): boolean {
  return protectedZones.some((zone) => (
    point.x >= zone.x
    && point.x <= zone.x + zone.width
    && point.y >= zone.y
    && point.y <= zone.y + zone.height
  ));
}

export function isRectClearOfProtectedZones(rect: Rect, protectedZones: readonly ProtectedRect[]): boolean {
  return protectedZones.every((zone) => !intersectsRect(rect, zone));
}

function squaredDistance(first: Point, second: Point) {
  const x = first.x - second.x;
  const y = first.y - second.y;
  return x * x + y * y;
}

export function resolveSafePosition(options: {
  desired: Point;
  sprite: Size;
  bounds: MovementBounds;
  protectedZones?: readonly ProtectedRect[];
  previous?: Point;
  gap?: number;
}): SafePositionResult {
  const { desired, sprite, bounds, previous } = options;
  const protectedZones = options.protectedZones ?? [];
  const gap = options.gap ?? 8;
  assertFinite("Safety gap", gap);
  if (gap < 0 || gap > 64) throw new RangeError("Safety gap must be between 0 and 64 pixels.");

  const clamped = clampPointToBounds(desired, bounds);
  const blockedBy = protectedZones
    .filter((zone) => intersectsRect(rectAtPoint(clamped, sprite), zone))
    .map((zone) => zone.id);
  if (blockedBy.length === 0) {
    return {
      point: clamped,
      adjusted: clamped.x !== desired.x || clamped.y !== desired.y,
      safe: true,
      blockedBy: [],
    };
  }

  const candidates: Point[] = [];
  if (previous) candidates.push(clampPointToBounds(previous, bounds));
  for (const zone of protectedZones) {
    candidates.push(
      clampPointToBounds({ x: zone.x - sprite.width - gap, y: clamped.y }, bounds),
      clampPointToBounds({ x: zone.x + zone.width + gap, y: clamped.y }, bounds),
      clampPointToBounds({ x: clamped.x, y: zone.y - sprite.height - gap }, bounds),
      clampPointToBounds({ x: clamped.x, y: zone.y + zone.height + gap }, bounds),
    );
  }
  candidates.push(
    { x: bounds.minX, y: bounds.minY },
    { x: bounds.maxX, y: bounds.minY },
    { x: bounds.minX, y: bounds.maxY },
    { x: bounds.maxX, y: bounds.maxY },
  );

  const safeCandidates = candidates
    .filter((candidate, index) => candidates.findIndex((item) => item.x === candidate.x && item.y === candidate.y) === index)
    .filter((candidate) => isRectClearOfProtectedZones(rectAtPoint(candidate, sprite), protectedZones))
    .sort((first, second) => squaredDistance(first, desired) - squaredDistance(second, desired));

  if (safeCandidates[0]) {
    return { point: safeCandidates[0], adjusted: true, safe: true, blockedBy };
  }
  return { point: clamped, adjusted: true, safe: false, blockedBy };
}

export function advanceHorizontalPosition(options: {
  point: Point;
  direction: "left" | "right";
  speed: number;
  deltaMs: number;
  bounds: MovementBounds;
}): { point: Point; reachedEdge: boolean } {
  assertFinite("Speed", options.speed);
  assertFinite("Frame delta", options.deltaMs);
  if (options.speed < 0 || options.speed > 240) throw new RangeError("Speed must be between 0 and 240 pixels per second.");
  if (options.deltaMs < 0 || options.deltaMs > 1_000) throw new RangeError("Frame delta must be between 0 and 1000 milliseconds.");
  const distance = options.speed * options.deltaMs / 1_000 * (options.direction === "left" ? -1 : 1);
  const desired = { x: options.point.x + distance, y: options.point.y };
  const point = clampPointToBounds(desired, options.bounds);
  return {
    point,
    reachedEdge: options.direction === "left" ? point.x <= options.bounds.minX : point.x >= options.bounds.maxX,
  };
}

export function landingY(bounds: MovementBounds): number {
  return bounds.maxY;
}
