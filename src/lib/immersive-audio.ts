import { STAGE_SOUND_PATHS, type SemanticModelId } from "./immersive-public-experience";

export type ImmersiveSoundId = SemanticModelId | "theme";
export type AudioLike = Pick<HTMLAudioElement, "currentTime" | "load" | "pause" | "play" | "preload" | "volume">;

type AudioFactory = (path: string) => AudioLike;
type Schedule = (callback: () => void, delay: number) => number;
type CancelSchedule = (timer: number) => void;

export class ImmersiveAudioController {
  private current: AudioLike | null = null;
  private door: AudioLike | null = null;
  private doorTimer: number | null = null;
  private enabled = false;
  private unlocked = false;
  private lastSound: ImmersiveSoundId | null = null;

  constructor(
    private readonly createAudio: AudioFactory,
    private readonly schedule: Schedule = (callback, delay) => window.setTimeout(callback, delay),
    private readonly cancelSchedule: CancelSchedule = (timer) => window.clearTimeout(timer),
  ) {}

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    if (!enabled) {
      this.stop();
      this.lastSound = null;
    }
  }

  unlock() {
    this.unlocked = true;
  }

  play(sound: ImmersiveSoundId) {
    if (!this.enabled || !this.unlocked || this.lastSound === sound) return false;
    this.stop();
    this.lastSound = sound;
    const audio = this.createAudio(STAGE_SOUND_PATHS[sound]);
    audio.preload = "auto";
    audio.volume = sound === "deliver" ? 0.22 : 0.3;
    audio.load();
    this.current = audio;
    void audio.play().catch(() => undefined);
    if (sound === "deliver") {
      this.doorTimer = this.schedule(() => {
        if (!this.enabled || !this.unlocked || this.lastSound !== "deliver") return;
        const door = this.createAudio("/immersive/sounds/delivery-door.wav");
        door.preload = "auto";
        door.volume = 0.22;
        door.load();
        this.door = door;
        void door.play().catch(() => undefined);
      }, 720);
    }
    return true;
  }

  allowReplayAfterTransition() {
    this.lastSound = null;
  }

  stop() {
    if (this.doorTimer !== null) this.cancelSchedule(this.doorTimer);
    this.doorTimer = null;
    for (const audio of [this.current, this.door]) {
      if (!audio) continue;
      audio.pause();
      audio.currentTime = 0;
    }
    this.current = null;
    this.door = null;
  }

  dispose() {
    this.stop();
    this.enabled = false;
    this.unlocked = false;
    this.lastSound = null;
  }
}

export const immersiveAudioInternals = { STAGE_SOUND_PATHS };
