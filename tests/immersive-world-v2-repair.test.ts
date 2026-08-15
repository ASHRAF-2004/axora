import { describe, expect, it, vi } from "vitest";
import { ImmersiveAudioController, type AudioLike } from "@/lib/immersive-audio";
import { PUBLIC_SCENE_MODELS, STAGE_SOUND_PATHS, WORKFLOW_STAGE_IDS } from "@/lib/immersive-public-experience";
import { publicSceneStates, validatePublicSceneStates } from "@/lib/public-scene-states";
import { cameraDistanceForBounds, normalizationScale, projectedBoundsAreUsable } from "@/lib/immersive-scene-runtime";

function audioFixture() {
  const created: Array<{ path: string; audio: AudioLike; play: ReturnType<typeof vi.fn>; pause: ReturnType<typeof vi.fn> }> = [];
  const timers = new Map<number, () => void>();
  let timerId = 0;
  const controller = new ImmersiveAudioController((audioPath) => {
    const play = vi.fn(async () => undefined);
    const pause = vi.fn();
    const audio: AudioLike = { currentTime: 0, load: vi.fn(), pause, play, preload: "none", volume: 1 };
    created.push({ path: audioPath, audio, play, pause });
    return audio;
  }, (callback) => { const id = ++timerId; timers.set(id, callback); return id; }, (id) => { timers.delete(id); });
  return { controller, created, timers };
}

describe("immersive world V2 audited repairs", () => {
  it("normalizes every semantic object and rejects clipped or tiny render bounds", () => {
    expect(normalizationScale({ x: 12, y: 3, z: 4 })).toBeCloseTo(3.2 / 12);
    expect(() => normalizationScale({ x: 0, y: 0, z: 0 })).toThrow("no usable bounds");
    expect(cameraDistanceForBounds({ x: 3.2, y: 1.2, z: 1 }, 16 / 9)).toBeGreaterThanOrEqual(4.8);
    expect(projectedBoundsAreUsable({ left: .2, top: .2, right: .8, bottom: .8, width: .6, height: .6 })).toBe(true);
    expect(projectedBoundsAreUsable({ left: -.1, top: .2, right: 1.2, bottom: .8, width: 1.3, height: .6 })).toBe(false);
    expect(projectedBoundsAreUsable({ left: .49, top: .49, right: .51, bottom: .51, width: .02, height: .02 })).toBe(false);
  });
  it("keeps sound locked until consent and maps every stage to its own cue", () => {
    const fixture = audioFixture();
    fixture.controller.setEnabled(true);
    expect(fixture.controller.play("request")).toBe(false);
    expect(fixture.created).toHaveLength(0);
    fixture.controller.unlock();
    for (const stage of WORKFLOW_STAGE_IDS) {
      fixture.controller.allowReplayAfterTransition();
      expect(fixture.controller.play(stage)).toBe(true);
    }
    expect(fixture.created.slice(0, 8).map((item) => item.path)).toEqual(WORKFLOW_STAGE_IDS.map((stage) => STAGE_SOUND_PATHS[stage]));
    expect(new Set(fixture.created.slice(0, 8).map((item) => item.path)).size).toBe(8);
  });

  it("plays Delivery engine then door and cancels active and scheduled sound", () => {
    const fixture = audioFixture();
    fixture.controller.setEnabled(true);
    fixture.controller.unlock();
    expect(fixture.controller.play("deliver")).toBe(true);
    expect(fixture.controller.play("deliver")).toBe(false);
    expect(fixture.created[0]?.path).toBe(STAGE_SOUND_PATHS.deliver);
    expect(fixture.timers.size).toBe(1);
    [...fixture.timers.values()][0]?.();
    expect(fixture.created[1]?.path).toBe("/immersive/sounds/delivery-door.wav");
    fixture.controller.setEnabled(false);
    expect(fixture.created.every((item) => item.pause.mock.calls.length === 1)).toBe(true);
    expect(fixture.timers.size).toBe(0);
    fixture.controller.dispose();
  });

  it("provides exact semantic localized state arrays for every public route", () => {
    expect(validatePublicSceneStates()).toBe(true);
    for (const locale of ["en", "ar", "ms"] as const) {
      for (const route of Object.keys(PUBLIC_SCENE_MODELS) as Array<keyof typeof PUBLIC_SCENE_MODELS>) {
        const states = publicSceneStates(route, locale);
        expect(states).toHaveLength(PUBLIC_SCENE_MODELS[route].length);
        expect(states.map((state) => state.model)).toEqual(PUBLIC_SCENE_MODELS[route]);
        for (const state of states) {
          expect(state.label).not.toMatch(/^\d+$/);
          expect(state.title.length).toBeGreaterThan(2);
          expect(state.description.length).toBeGreaterThan(15);
          expect(state.alternative).toBe(state.description);
        }
      }
    }
  });
});
