import { acceptLiveFrame, type LiveContext, type LiveHint, type LiveSnapshot, type LiveStatus, type LiveTopic } from "./live-update-contract";

interface Source {
  addEventListener(type: string, listener: (event: MessageEvent<string>) => void): void;
  onerror: ((event: Event) => unknown) | null;
  close(): void;
}
export interface LiveClientEnvironment {
  source?: (url: string) => Source;
  read: (url: string, signal: AbortSignal) => Promise<{ status: number; snapshot?: LiveSnapshot }>;
  visible: () => boolean;
  online: () => boolean;
  later: (callback: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clear: (timer: ReturnType<typeof setTimeout> | undefined) => void;
}
interface Subscriber { topic: LiveTopic; context: LiveContext; receive: (hint: LiveHint) => void; version?: string }

/** One per tab/session provider; reconnects replay reads only, never commands. */
export class SharedLiveClient {
  private subscribers = new Map<symbol, Subscriber>();
  private statusListeners = new Set<(status: LiveStatus) => void>();
  private status: LiveStatus = "reconnecting";
  private source: Source | null = null;
  private reconnect: ReturnType<typeof setTimeout> | undefined;
  private polling: ReturnType<typeof setTimeout> | undefined;
  private reconfigure: ReturnType<typeof setTimeout> | undefined;
  private request: AbortController | null = null;
  private frame: { epoch: string; sequence: number } | null = null;
  private retiredEpochs = new Set<string>();
  private generation = 0;
  private failures = 0;
  private started = false;
  private enabled = true;
  private denied = false;
  private currentUrl = "";
  private lastSnapshot: LiveSnapshot | null = null;
  constructor(private environment: LiveClientEnvironment) {}

  subscribe(topic: LiveTopic, context: LiveContext, receive: (hint: LiveHint) => void) {
    const key = Symbol(topic);
    this.subscribers.set(key, { topic, context, receive });
    if (this.url() === this.currentUrl && this.lastSnapshot) this.apply(this.lastSnapshot);
    this.scheduleConfiguration();
    return () => { this.subscribers.delete(key); this.scheduleConfiguration(); };
  }
  onStatus(receive: (status: LiveStatus) => void) {
    this.statusListeners.add(receive);
    receive(this.status);
    return () => { this.statusListeners.delete(receive); };
  }
  private setStatus(status: LiveStatus) {
    if (status === this.status) return;
    this.status = status;
    this.statusListeners.forEach((receive) => receive(status));
  }
  start() { this.started = true; this.configure(); }
  stop() { this.started = false; this.disconnect(); this.environment.clear(this.reconfigure); }
  visibilityChanged() {
    if (!this.environment.visible() || !this.environment.online()) {
      this.disconnect();
      this.setStatus("paused");
    } else if (this.started) { this.configure(); }
  }
  private scheduleConfiguration() {
    this.environment.clear(this.reconfigure);
    if (this.started) this.reconfigure = this.environment.later(() => this.configure(), 50);
  }
  private url() {
    const topics = [...new Set([...this.subscribers.values()].map((subscriber) => subscriber.topic))].sort();
    if (!topics.length || topics.length > 4) return null;
    const parameters = new URLSearchParams({ topics: topics.join(",") });
    for (const name of ["driverId", "companyId", "branchId"] as const) {
      const values = [...new Set([...this.subscribers.values()].map((subscriber) => subscriber.context[name]).filter(Boolean))];
      if (values.length > 1) return null; // Never combine different company/driver contexts.
      if (values[0]) parameters.set(name, values[0]);
    }
    return `/api/live?${parameters}`;
  }
  private disconnect() {
    this.generation += 1;
    this.source?.close();
    this.source = null;
    this.request?.abort();
    this.request = null;
    this.environment.clear(this.reconnect);
    this.environment.clear(this.polling);
    this.reconnect = this.polling = undefined;
    this.frame = null;
  }
  private configure() {
    if (!this.started || this.denied) return;
    if (!this.environment.visible() || !this.environment.online()) { this.visibilityChanged(); return; }
    const next = this.url();
    if (!next) { this.disconnect(); this.setStatus("paused"); return; }
    if (next !== this.currentUrl) {
      this.disconnect();
      this.currentUrl = next;
      this.lastSnapshot = null;
    }
    if (!this.source && this.enabled && this.environment.source) this.connect();
    if (!this.source) this.schedulePoll(0);
  }
  private connect() {
    const generation = this.generation;
    this.setStatus("reconnecting");
    const source = this.environment.source!(this.currentUrl);
    this.source = source;
    source.addEventListener("snapshot", (event) => {
      if (generation !== this.generation || this.source !== source) return;
      try {
        if (event.data.length > 16_384) throw new Error("Frame too large");
        const value = JSON.parse(event.data);
        if (this.retiredEpochs.has(value?.epoch)) return;
        const accepted = acceptLiveFrame(this.frame, value);
        if (!accepted) return;
        if (this.frame && accepted.epoch !== this.frame.epoch) {
          this.retiredEpochs.add(this.frame.epoch);
          if (this.retiredEpochs.size > 8) this.retiredEpochs.delete(this.retiredEpochs.values().next().value!);
        }
        this.frame = { epoch: accepted.epoch, sequence: accepted.sequence };
        this.failures = 0;
        this.environment.clear(this.polling);
        this.polling = undefined;
        // A fallback read may still be pending when the reconnect becomes current.
        // Aborting also invalidates late resolutions from non-cooperative transports.
        this.request?.abort();
        this.request = null;
        this.setStatus("current");
        this.apply(accepted.snapshot);
      } catch { /* Malformed/duplicate frames never overwrite canonical display. */ }
    });
    const failed = () => {
      if (generation !== this.generation || this.source !== source) return;
      source.close();
      this.source = null;
      this.setStatus("reconnecting");
      this.schedulePoll(0);
      this.environment.clear(this.reconnect);
      this.reconnect = this.environment.later(() => {
        this.reconnect = undefined;
        this.configure();
      }, Math.min(30_000, 1_000 * 2 ** Math.min(this.failures++, 5)));
    };
    source.onerror = failed;
    source.addEventListener("unavailable", failed);
  }
  private apply(snapshot: LiveSnapshot) {
    this.lastSnapshot = snapshot;
    if (snapshot.streamEnabled !== undefined) this.enabled = snapshot.streamEnabled;
    this.subscribers.forEach((subscriber) => {
      const hint = snapshot.topics[subscriber.topic];
      if (!hint || subscriber.version === hint.version) return;
      subscriber.version = hint.version;
      subscriber.receive(hint);
    });
  }
  private schedulePoll(ms: number) {
    if (this.polling !== undefined || this.request || this.source || !this.started || this.denied) return;
    this.polling = this.environment.later(() => { this.polling = undefined; void this.poll(); }, ms);
  }
  private async poll() {
    if (!this.started || this.denied || !this.environment.visible() || !this.environment.online() || this.source) return;
    const generation = this.generation;
    const controller = new AbortController();
    this.request = controller;
    const timeout = this.environment.later(() => controller.abort(), 15_000);
    try {
      const result = await this.environment.read(`${this.currentUrl}&transport=poll`, controller.signal);
      if (generation !== this.generation || controller.signal.aborted) return;
      if (result.status === 401 || result.status === 403) {
        this.denied = true;
        this.disconnect();
        this.setStatus("paused");
        return;
      }
      const accepted = acceptLiveFrame(null, { epoch: "00000000-0000-4000-8000-000000000001", sequence: 1, resync: true, snapshot: result.snapshot });
      if (result.status === 200 && accepted) {
        this.apply(accepted.snapshot);
        this.setStatus("polling");
        if (!this.enabled) { this.environment.clear(this.reconnect); this.reconnect = undefined; }
        else if (!this.environment.source) { /* Polling-only browsers stay usable. */ }
        else if (this.reconnect === undefined) this.reconnect = this.environment.later(() => { this.reconnect = undefined; this.configure(); }, 30_000);
      }
    } catch { /* Keep stale/reconnecting status; never log response bodies. */ }
    finally {
      this.environment.clear(timeout);
      if (this.request === controller) this.request = null;
      if (generation === this.generation) this.schedulePoll(15_000);
    }
  }
}
