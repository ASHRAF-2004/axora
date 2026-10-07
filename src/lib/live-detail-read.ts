/** Existing authorized GET only: never retries a command or a denied read. */
export class LiveDetailReader<T> {
  private controller: AbortController | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private generation = 0;
  constructor(private url: string, private apply: (value: T) => void, private failed: () => void, private read: typeof fetch = fetch) {}

  stop() {
    this.generation += 1;
    this.controller?.abort();
    this.controller = null;
    clearTimeout(this.timer);
    this.timer = undefined;
  }
  refresh() {
    this.stop();
    const generation = this.generation;
    const load = async (attempt = 0) => {
      const controller = new AbortController();
      this.controller = controller;
      const deadline = setTimeout(() => controller.abort(), 15_000);
      try {
        const response = await this.read(this.url, { cache: "no-store", credentials: "same-origin", signal: controller.signal });
        if (generation !== this.generation || controller.signal.aborted) return;
        if (response.status === 401 || response.status === 403) {
          this.failed();
          return;
        }
        if (!response.ok) throw new Error("Unavailable");
        const value = await response.json() as T;
        if (generation === this.generation && !controller.signal.aborted) this.apply(value);
      } catch {
        if (generation === this.generation) {
          this.failed();
          if (attempt < 3) this.timer = setTimeout(() => void load(attempt + 1), 5_000 * 2 ** attempt);
        }
      } finally {
        clearTimeout(deadline);
        if (this.controller === controller) this.controller = null;
      }
    };
    void load();
  }
}
