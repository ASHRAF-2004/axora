import type { InteractionStateName } from "./schema";
import {
  advanceHorizontalPosition,
  clampPointToBounds,
  landingY,
  resolveSafePosition,
  type MovementBounds,
  type Point,
  type ProtectedRect,
  type Size,
} from "./geometry";

export type MascotFacing = "left" | "right";
export type MascotPauseReason = "manual" | "offscreen" | "route-change" | "unsafe-layout" | null;

export interface MascotMachine {
  state: InteractionStateName;
  position: Point;
  facing: MascotFacing;
  activePointerId: number | null;
  dragOffset: Point | null;
  phaseElapsedMs: number;
  idleElapsedMs: number;
  verticalVelocity: number;
  resumeState: InteractionStateName | null;
  pauseReason: MascotPauseReason;
  sequence: number;
}

export interface MascotEnvironment {
  bounds: MovementBounds;
  sprite: Size;
  protectedZones: readonly ProtectedRect[];
  dragEnabled: boolean;
  automaticMovement: boolean;
  reactionsEnabled: boolean;
  walkingSpeed: number;
  idleFrequencyMs: number;
  resumeDelayMs: number;
  reducedMotion: boolean;
  documentVisible: boolean;
}

export type MascotEvent =
  | { type: "asset-loaded" }
  | { type: "asset-error" }
  | { type: "tick"; deltaMs: number }
  | { type: "pointer-enter" }
  | { type: "pointer-leave" }
  | { type: "pointer-down"; pointerId: number; point: Point }
  | { type: "pointer-move"; pointerId: number; point: Point }
  | { type: "pointer-up"; pointerId: number; point: Point }
  | { type: "pointer-cancel"; pointerId: number }
  | { type: "react" }
  | { type: "resize" }
  | { type: "visibility-change"; visible: boolean }
  | { type: "reduced-motion-change"; reduced: boolean }
  | { type: "pause"; reason?: Exclude<MascotPauseReason, null> }
  | { type: "resume" }
  | { type: "route-change" }
  | { type: "dismiss" }
  | { type: "unmount" };

export type MascotEffect =
  | { type: "capture-pointer"; pointerId: number }
  | { type: "release-pointer"; pointerId: number }
  | { type: "show-static-fallback" }
  | { type: "hide-interaction" }
  | { type: "announce-pause-change"; paused: boolean };

export interface MascotTransition {
  machine: MascotMachine;
  effects: readonly MascotEffect[];
}

const TURN_DURATION_MS = 220;
const LANDING_DURATION_MS = 260;
const REACTION_DURATION_MS = 420;
const GRAVITY_PX_PER_SECOND_SQUARED = 1_300;
const MAX_FRAME_MS = 100;

const WALKING_STATES = new Set<InteractionStateName>(["walking-left", "walking-right"]);
const POINTER_STATES = new Set<InteractionStateName>([
  "idle", "walking-left", "walking-right", "turning", "hovered", "pressed", "reacting", "sleeping",
]);

export function createInitialMascotMachine(options: {
  position?: Point;
  facing?: MascotFacing;
  reducedMotion?: boolean;
  visible?: boolean;
} = {}): MascotMachine {
  const visible = options.visible ?? true;
  const reducedMotion = options.reducedMotion ?? false;
  return {
    state: !visible ? "hidden" : reducedMotion ? "reduced-motion" : "loading",
    position: options.position ?? { x: 0, y: 0 },
    facing: options.facing ?? "right",
    activePointerId: null,
    dragOffset: null,
    phaseElapsedMs: 0,
    idleElapsedMs: 0,
    verticalVelocity: 0,
    resumeState: !visible ? "loading" : null,
    pauseReason: !visible ? "offscreen" : null,
    sequence: 0,
  };
}

function changed(machine: MascotMachine, patch: Partial<MascotMachine>, effects: readonly MascotEffect[] = []): MascotTransition {
  return { machine: { ...machine, ...patch, sequence: machine.sequence + 1 }, effects };
}

function ignored(machine: MascotMachine): MascotTransition {
  return { machine, effects: [] };
}

function releaseEffect(machine: MascotMachine): MascotEffect[] {
  return machine.activePointerId === null ? [] : [{ type: "release-pointer", pointerId: machine.activePointerId }];
}

function resumeWalkingState(machine: MascotMachine, environment: MascotEnvironment): InteractionStateName {
  if (!environment.automaticMovement) return "idle";
  return machine.facing === "left" ? "walking-left" : "walking-right";
}

function safePositionOrHide(
  machine: MascotMachine,
  desired: Point,
  environment: MascotEnvironment,
): MascotTransition | Point {
  const resolved = resolveSafePosition({
    desired,
    previous: machine.position,
    sprite: environment.sprite,
    bounds: environment.bounds,
    protectedZones: environment.protectedZones,
  });
  if (resolved.safe) return resolved.point;
  return changed(machine, {
    state: "hidden",
    position: resolved.point,
    resumeState: resumeWalkingState(machine, environment),
    pauseReason: "unsafe-layout",
    activePointerId: null,
    dragOffset: null,
  }, [...releaseEffect(machine), { type: "hide-interaction" }]);
}

function startRelease(
  machine: MascotMachine,
  point: Point,
  environment: MascotEnvironment,
): MascotTransition {
  const dragOffset = machine.dragOffset ?? { x: 0, y: 0 };
  const desired = { x: point.x - dragOffset.x, y: point.y - dragOffset.y };
  const safe = safePositionOrHide(machine, desired, environment);
  if ("machine" in safe) return safe;
  return changed(machine, {
    state: "released",
    position: safe,
    activePointerId: null,
    dragOffset: null,
    phaseElapsedMs: 0,
    verticalVelocity: 0,
    resumeState: null,
    pauseReason: null,
  }, releaseEffect(machine));
}

function transitionTick(machine: MascotMachine, deltaMs: number, environment: MascotEnvironment): MascotTransition {
  if (!Number.isFinite(deltaMs) || deltaMs < 0) throw new RangeError("Frame delta must be a non-negative finite number.");
  const safeDelta = Math.min(deltaMs, MAX_FRAME_MS);

  if (machine.state === "idle") {
    const idleElapsedMs = machine.idleElapsedMs + safeDelta;
    if (environment.automaticMovement && idleElapsedMs >= environment.idleFrequencyMs) {
      return changed(machine, { state: resumeWalkingState(machine, environment), idleElapsedMs: 0, phaseElapsedMs: 0 });
    }
    return changed(machine, { idleElapsedMs });
  }

  if (WALKING_STATES.has(machine.state)) {
    const direction = machine.state === "walking-left" ? "left" : "right";
    const movement = advanceHorizontalPosition({
      point: machine.position,
      direction,
      speed: environment.walkingSpeed,
      deltaMs: safeDelta,
      bounds: environment.bounds,
    });
    const safe = safePositionOrHide(machine, movement.point, environment);
    if ("machine" in safe) return safe;
    if (movement.reachedEdge || safe.x !== movement.point.x) {
      return changed(machine, { state: "turning", position: safe, phaseElapsedMs: 0 });
    }
    return changed(machine, { position: safe, phaseElapsedMs: machine.phaseElapsedMs + safeDelta });
  }

  if (machine.state === "turning") {
    const phaseElapsedMs = machine.phaseElapsedMs + safeDelta;
    if (phaseElapsedMs >= TURN_DURATION_MS) {
      const facing = machine.facing === "left" ? "right" : "left";
      return changed(machine, {
        state: environment.automaticMovement ? (facing === "left" ? "walking-left" : "walking-right") : "idle",
        facing,
        phaseElapsedMs: 0,
      });
    }
    return changed(machine, { phaseElapsedMs });
  }

  if (machine.state === "released") {
    return changed(machine, { state: "falling", phaseElapsedMs: 0, verticalVelocity: 0 });
  }

  if (machine.state === "falling") {
    const seconds = safeDelta / 1_000;
    const verticalVelocity = machine.verticalVelocity + GRAVITY_PX_PER_SECOND_SQUARED * seconds;
    const desiredY = machine.position.y + verticalVelocity * seconds;
    const ground = landingY(environment.bounds);
    const safe = safePositionOrHide(machine, { x: machine.position.x, y: Math.min(ground, desiredY) }, environment);
    if ("machine" in safe) return safe;
    if (safe.y >= ground || desiredY >= ground) {
      return changed(machine, { state: "landing", position: safe, verticalVelocity: 0, phaseElapsedMs: 0 });
    }
    return changed(machine, { position: safe, verticalVelocity, phaseElapsedMs: machine.phaseElapsedMs + safeDelta });
  }

  if (machine.state === "landing") {
    const phaseElapsedMs = machine.phaseElapsedMs + safeDelta;
    return phaseElapsedMs >= LANDING_DURATION_MS
      ? changed(machine, { state: "recovering", phaseElapsedMs: 0 })
      : changed(machine, { phaseElapsedMs });
  }

  if (machine.state === "recovering") {
    const phaseElapsedMs = machine.phaseElapsedMs + safeDelta;
    return phaseElapsedMs >= environment.resumeDelayMs
      ? changed(machine, { state: resumeWalkingState(machine, environment), phaseElapsedMs: 0, idleElapsedMs: 0 })
      : changed(machine, { phaseElapsedMs });
  }

  if (machine.state === "reacting") {
    const phaseElapsedMs = machine.phaseElapsedMs + safeDelta;
    return phaseElapsedMs >= REACTION_DURATION_MS
      ? changed(machine, { state: "idle", phaseElapsedMs: 0, idleElapsedMs: 0 })
      : changed(machine, { phaseElapsedMs });
  }

  return ignored(machine);
}

export function transitionMascot(
  machine: MascotMachine,
  event: MascotEvent,
  environment: MascotEnvironment,
): MascotTransition {
  if (machine.state === "unmounted") return ignored(machine);

  switch (event.type) {
    case "asset-loaded":
      if (machine.state !== "loading") return ignored(machine);
      if (!environment.documentVisible) return changed(machine, { state: "hidden", resumeState: "idle", pauseReason: "offscreen" });
      if (environment.reducedMotion) return changed(machine, { state: "reduced-motion", pauseReason: null });
      return changed(machine, { state: "idle", pauseReason: null, idleElapsedMs: 0 });
    case "asset-error":
      return changed(machine, {
        state: "error-fallback",
        activePointerId: null,
        dragOffset: null,
        pauseReason: null,
      }, [...releaseEffect(machine), { type: "show-static-fallback" }]);
    case "tick":
      if (environment.reducedMotion || !environment.documentVisible) return ignored(machine);
      return transitionTick(machine, event.deltaMs, environment);
    case "pointer-enter":
      if (!environment.reactionsEnabled || machine.state !== "idle") return ignored(machine);
      return changed(machine, { state: "hovered", resumeState: "idle", phaseElapsedMs: 0 });
    case "pointer-leave":
      if (machine.state !== "hovered") return ignored(machine);
      return changed(machine, { state: machine.resumeState ?? "idle", resumeState: null, phaseElapsedMs: 0 });
    case "pointer-down": {
      if (!environment.dragEnabled || environment.reducedMotion || machine.activePointerId !== null || !POINTER_STATES.has(machine.state)) {
        return ignored(machine);
      }
      return changed(machine, {
        state: "grabbed",
        activePointerId: event.pointerId,
        dragOffset: { x: event.point.x - machine.position.x, y: event.point.y - machine.position.y },
        phaseElapsedMs: 0,
        resumeState: null,
      }, [{ type: "capture-pointer", pointerId: event.pointerId }]);
    }
    case "pointer-move": {
      if (machine.activePointerId !== event.pointerId || (machine.state !== "grabbed" && machine.state !== "being-carried")) return ignored(machine);
      const dragOffset = machine.dragOffset ?? { x: 0, y: 0 };
      const safe = safePositionOrHide(machine, { x: event.point.x - dragOffset.x, y: event.point.y - dragOffset.y }, environment);
      if ("machine" in safe) return safe;
      return changed(machine, { state: "being-carried", position: safe });
    }
    case "pointer-up":
      if (machine.activePointerId !== event.pointerId) return ignored(machine);
      return startRelease(machine, event.point, environment);
    case "pointer-cancel":
      if (machine.activePointerId !== event.pointerId) return ignored(machine);
      return startRelease(machine, {
        x: machine.position.x + (machine.dragOffset?.x ?? 0),
        y: machine.position.y + (machine.dragOffset?.y ?? 0),
      }, environment);
    case "react":
      if (!environment.reactionsEnabled || machine.state !== "idle") return ignored(machine);
      return changed(machine, { state: "reacting", phaseElapsedMs: 0 });
    case "resize": {
      const safe = safePositionOrHide(machine, clampPointToBounds(machine.position, environment.bounds), environment);
      return "machine" in safe ? safe : changed(machine, { position: safe });
    }
    case "visibility-change":
      if (!event.visible) {
        return changed(machine, {
          state: "hidden",
          resumeState: machine.state === "hidden" ? machine.resumeState : machine.state,
          pauseReason: "offscreen",
          activePointerId: null,
          dragOffset: null,
        }, releaseEffect(machine));
      }
      if (machine.state !== "hidden" || machine.pauseReason !== "offscreen") return ignored(machine);
      return changed(machine, {
        state: environment.reducedMotion ? "reduced-motion" : (machine.resumeState === "loading" ? "loading" : "idle"),
        resumeState: null,
        pauseReason: null,
        phaseElapsedMs: 0,
        idleElapsedMs: 0,
      });
    case "reduced-motion-change":
      if (event.reduced) {
        return changed(machine, {
          state: "reduced-motion",
          resumeState: null,
          pauseReason: null,
          activePointerId: null,
          dragOffset: null,
        }, releaseEffect(machine));
      }
      if (machine.state !== "reduced-motion") return ignored(machine);
      return changed(machine, { state: "idle", phaseElapsedMs: 0, idleElapsedMs: 0 });
    case "pause":
      if (machine.state === "paused") return ignored(machine);
      return changed(machine, {
        state: "paused",
        resumeState: machine.state,
        pauseReason: event.reason ?? "manual",
        activePointerId: null,
        dragOffset: null,
      }, [...releaseEffect(machine), { type: "announce-pause-change", paused: true }]);
    case "resume":
      if (machine.state !== "paused") return ignored(machine);
      return changed(machine, {
        state: environment.reducedMotion ? "reduced-motion" : "idle",
        resumeState: null,
        pauseReason: null,
        phaseElapsedMs: 0,
        idleElapsedMs: 0,
      }, [{ type: "announce-pause-change", paused: false }]);
    case "route-change":
      return changed(machine, {
        state: "paused",
        resumeState: "idle",
        pauseReason: "route-change",
        activePointerId: null,
        dragOffset: null,
      }, releaseEffect(machine));
    case "dismiss":
      return changed(machine, {
        state: "hidden",
        resumeState: null,
        pauseReason: "manual",
        activePointerId: null,
        dragOffset: null,
      }, [...releaseEffect(machine), { type: "hide-interaction" }]);
    case "unmount":
      return changed(machine, {
        state: "unmounted",
        resumeState: null,
        pauseReason: null,
        activePointerId: null,
        dragOffset: null,
      }, releaseEffect(machine));
  }
}
