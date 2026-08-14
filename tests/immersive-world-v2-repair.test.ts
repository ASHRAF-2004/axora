import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { driverLiveMapInternals } from "@/components/role-portals/DriverLiveMap";
import { ImmersiveAudioController, type AudioLike } from "@/lib/immersive-audio";
import { PUBLIC_SCENE_MODELS, STAGE_SOUND_PATHS, WORKFLOW_STAGE_IDS } from "@/lib/immersive-public-experience";
import { publicSceneStates, validatePublicSceneStates } from "@/lib/public-scene-states";

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

  it("loads a real self-hosted MapLibre style and exact route geometry", async () => {
    const style = JSON.parse(await readFile(path.join(process.cwd(), "public/maps/axora-operational-style.json"), "utf8"));
    expect(driverLiveMapInternals.usableStyle(style)).toBe(true);
    expect(Object.keys(style.sources)).toEqual(expect.arrayContaining(["natural-earth-countries", "natural-earth-places"]));
    expect(style.layers.some((layer: { type?: string; source?: string }) => layer.type !== "background" && layer.source)).toBe(true);
    for (const source of Object.values(style.sources) as Array<{ data?: string }>) {
      expect(source.data).toMatch(/^\/maps\/.+\.geojson$/);
      const data = JSON.parse(await readFile(path.join(process.cwd(), "public", source.data!.slice(1)), "utf8"));
      expect(data.features.length).toBeGreaterThan(0);
    }
    const points = [
      { latitude: 3.139, longitude: 101.6869, accuracy: 8, capturedAt: "2026-08-15T00:00:00Z" },
      { latitude: 3.1412, longitude: 101.69, accuracy: 7, capturedAt: "2026-08-15T00:01:00Z" },
    ];
    expect(driverLiveMapInternals.routeFeature(points).geometry.coordinates).toEqual([[101.6869, 3.139], [101.69, 3.1412]]);
  });
});
