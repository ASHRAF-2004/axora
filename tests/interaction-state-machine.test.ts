import { describe, expect, it } from "vitest";
import {
  createInitialMascotMachine,
  transitionMascot,
  type MascotEnvironment,
  type MascotEvent,
  type MascotMachine,
} from "@/lib/interactions";

const environment: MascotEnvironment = {
  bounds: { minX: 0, maxX: 100, minY: 0, maxY: 80 },
  sprite: { width: 20, height: 20 },
  protectedZones: [],
  dragEnabled: true,
  automaticMovement: true,
  reactionsEnabled: true,
  walkingSpeed: 50,
  idleFrequencyMs: 100,
  resumeDelayMs: 200,
  reducedMotion: false,
  documentVisible: true,
};

function send(machine: MascotMachine, event: MascotEvent, env = environment) {
  return transitionMascot(machine, event, env).machine;
}

function ticks(machine: MascotMachine, count: number, env = environment) {
  let next = machine;
  for (let index = 0; index < count; index += 1) next = send(next, { type: "tick", deltaMs: 100 }, env);
  return next;
}

describe("deterministic mascot state machine", () => {
  it("loads, walks, turns at an edge, and continues in the other direction", () => {
    let machine = createInitialMascotMachine({ position: { x: 95, y: 80 }, facing: "right" });
    machine = send(machine, { type: "asset-loaded" });
    expect(machine.state).toBe("idle");
    machine = send(machine, { type: "tick", deltaMs: 100 });
    expect(machine.state).toBe("walking-right");
    machine = send(machine, { type: "tick", deltaMs: 100 });
    expect(machine.state).toBe("turning");
    machine = ticks(machine, 3);
    expect(machine.state).toBe("walking-left");
    expect(machine.facing).toBe("left");
  });

  it("supports pickup, constrained carrying, release, landing, recovery, and walking resume", () => {
    let machine = send(createInitialMascotMachine({ position: { x: 20, y: 10 } }), { type: "asset-loaded" });
    const grabbed = transitionMascot(machine, { type: "pointer-down", pointerId: 7, point: { x: 25, y: 15 } }, environment);
    machine = grabbed.machine;
    expect(machine.state).toBe("grabbed");
    expect(grabbed.effects).toEqual([{ type: "capture-pointer", pointerId: 7 }]);

    const ignoredSecondPointer = transitionMascot(machine, { type: "pointer-down", pointerId: 8, point: { x: 30, y: 20 } }, environment);
    expect(ignoredSecondPointer.machine).toBe(machine);
    machine = send(machine, { type: "pointer-move", pointerId: 7, point: { x: 1_000, y: 40 } });
    expect(machine.state).toBe("being-carried");
    expect(machine.position.x).toBe(100);

    const released = transitionMascot(machine, { type: "pointer-up", pointerId: 7, point: { x: 1_000, y: 40 } }, environment);
    machine = released.machine;
    expect(machine.state).toBe("released");
    expect(released.effects).toEqual([{ type: "release-pointer", pointerId: 7 }]);
    machine = ticks(machine, 8);
    expect(["landing", "recovering", "walking-right"]).toContain(machine.state);
    for (let index = 0; index < 5 && machine.state !== "walking-right"; index += 1) {
      machine = send(machine, { type: "tick", deltaMs: 100 });
    }
    expect(machine.state).toBe("walking-right");
  });

  it("handles pointer cancellation and release outside the interaction area", () => {
    let machine = send(createInitialMascotMachine({ position: { x: 20, y: 10 } }), { type: "asset-loaded" });
    machine = send(machine, { type: "pointer-down", pointerId: 2, point: { x: 25, y: 15 } });
    machine = send(machine, { type: "pointer-move", pointerId: 2, point: { x: -500, y: -500 } });
    expect(machine.position).toEqual({ x: 0, y: 0 });
    const cancelled = transitionMascot(machine, { type: "pointer-cancel", pointerId: 2 }, environment);
    expect(cancelled.machine.state).toBe("released");
    expect(cancelled.machine.activePointerId).toBeNull();
    expect(cancelled.effects).toEqual([{ type: "release-pointer", pointerId: 2 }]);
  });

  it("pauses while hidden and provides a stationary reduced-motion state", () => {
    let machine = send(createInitialMascotMachine(), { type: "asset-loaded" });
    machine = send(machine, { type: "visibility-change", visible: false });
    expect(machine.state).toBe("hidden");
    const unchanged = send(machine, { type: "tick", deltaMs: 100 });
    expect(unchanged).toBe(machine);
    machine = send(machine, { type: "visibility-change", visible: true });
    expect(machine.state).toBe("idle");
    machine = send(machine, { type: "reduced-motion-change", reduced: true });
    expect(machine.state).toBe("reduced-motion");
    expect(send(machine, { type: "tick", deltaMs: 100 })).toBe(machine);
  });

  it("clamps on resize, hides for an unsafe region, and releases captured pointers", () => {
    let machine = send(createInitialMascotMachine({ position: { x: 90, y: 70 } }), { type: "asset-loaded" });
    machine = send(machine, { type: "pointer-down", pointerId: 4, point: { x: 95, y: 75 } });
    const unsafeEnvironment = {
      ...environment,
      bounds: { minX: 0, maxX: 30, minY: 0, maxY: 30 },
      protectedZones: [{ id: "form", x: 0, y: 0, width: 50, height: 50 }],
    };
    const transition = transitionMascot(machine, { type: "resize" }, unsafeEnvironment);
    expect(transition.machine.state).toBe("hidden");
    expect(transition.machine.pauseReason).toBe("unsafe-layout");
    expect(transition.effects).toContainEqual({ type: "release-pointer", pointerId: 4 });
    expect(transition.effects).toContainEqual({ type: "hide-interaction" });
  });

  it("cleans up deterministically on route change and unmount", () => {
    let machine = send(createInitialMascotMachine(), { type: "asset-loaded" });
    machine = send(machine, { type: "route-change" });
    expect(machine.state).toBe("paused");
    expect(machine.pauseReason).toBe("route-change");
    machine = send(machine, { type: "unmount" });
    expect(machine.state).toBe("unmounted");
    expect(send(machine, { type: "resume" })).toBe(machine);
  });
});
