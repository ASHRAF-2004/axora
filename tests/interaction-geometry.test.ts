import { describe, expect, it } from "vitest";
import {
  advanceHorizontalPosition,
  calculateMovementBounds,
  clampPointToBounds,
  intersectsRect,
  isPointInProtectedZone,
  resolveSafePosition,
} from "@/lib/interactions";

describe("interaction geometry safety", () => {
  it("calculates top-left movement bounds without allowing overflow", () => {
    const bounds = calculateMovementBounds(
      { x: 10, y: 20, width: 300, height: 180 },
      { width: 60, height: 80 },
      12,
    );
    expect(bounds).toEqual({ minX: 22, maxX: 238, minY: 32, maxY: 108 });
    expect(clampPointToBounds({ x: -100, y: 900 }, bounds)).toEqual({ x: 22, y: 108 });
    expect(() => calculateMovementBounds(
      { x: 0, y: 0, width: 40, height: 40 },
      { width: 60, height: 20 },
      0,
    )).toThrow("does not fit");
  });

  it("treats touching edges as safe but detects actual overlap", () => {
    expect(intersectsRect(
      { x: 0, y: 0, width: 20, height: 20 },
      { x: 20, y: 0, width: 20, height: 20 },
    )).toBe(false);
    expect(intersectsRect(
      { x: 0, y: 0, width: 21, height: 20 },
      { x: 20, y: 0, width: 20, height: 20 },
    )).toBe(true);
  });

  it("moves a mascot away from protected controls", () => {
    const result = resolveSafePosition({
      desired: { x: 80, y: 40 },
      previous: { x: 10, y: 40 },
      sprite: { width: 40, height: 40 },
      bounds: { minX: 0, maxX: 160, minY: 0, maxY: 80 },
      protectedZones: [{ id: "checkout", x: 70, y: 20, width: 80, height: 70 }],
    });
    expect(result.safe).toBe(true);
    expect(result.adjusted).toBe(true);
    expect(result.blockedBy).toEqual(["checkout"]);
    expect(intersectsRect(
      { ...result.point, width: 40, height: 40 },
      { x: 70, y: 20, width: 80, height: 70 },
    )).toBe(false);
  });

  it("reports an unsafe layout when no permitted position exists", () => {
    const result = resolveSafePosition({
      desired: { x: 10, y: 10 },
      sprite: { width: 30, height: 30 },
      bounds: { minX: 0, maxX: 30, minY: 0, maxY: 30 },
      protectedZones: [{ id: "entire-region", x: 0, y: 0, width: 60, height: 60 }],
    });
    expect(result.safe).toBe(false);
    expect(result.blockedBy).toEqual(["entire-region"]);
  });

  it("turns at movement edges and validates frame input", () => {
    const result = advanceHorizontalPosition({
      point: { x: 95, y: 20 },
      direction: "right",
      speed: 80,
      deltaMs: 100,
      bounds: { minX: 0, maxX: 100, minY: 0, maxY: 80 },
    });
    expect(result).toEqual({ point: { x: 100, y: 20 }, reachedEdge: true });
    expect(() => advanceHorizontalPosition({
      point: { x: 0, y: 0 }, direction: "left", speed: 10, deltaMs: 2_000,
      bounds: { minX: 0, maxX: 100, minY: 0, maxY: 100 },
    })).toThrow("Frame delta");
  });

  it("recognizes pointer positions inside approved protected zones", () => {
    const zones = [{ id: "navigation", x: 0, y: 0, width: 320, height: 64 }];
    expect(isPointInProtectedZone({ x: 100, y: 20 }, zones)).toBe(true);
    expect(isPointInProtectedZone({ x: 100, y: 80 }, zones)).toBe(false);
  });
});
