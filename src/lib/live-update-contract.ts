export const LIVE_TOPICS = ["notifications", "jobs", "drivers", "driver", "receiving", "budgets", "wallet", "requests", "approvals", "catalog"] as const;
export type LiveTopic = (typeof LIVE_TOPICS)[number];
export interface LiveContext { driverId?: string; companyId?: string; branchId?: string }
export interface LiveHint { version: string; unreadCount?: number }
export interface LiveSnapshot { topics: Partial<Record<LiveTopic, LiveHint>>; streamEnabled?: boolean }
export type LiveStatus = "current" | "reconnecting" | "polling" | "paused";

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
export function parseLiveSubscription(url: URL) {
  if (url.search.length > 512 || [...url.searchParams.keys()].some((key) => !["topics", "driverId", "companyId", "branchId", "transport"].includes(key))
    || [...new Set(url.searchParams.keys())].some((key) => url.searchParams.getAll(key).length !== 1)) throw new Error("Invalid subscription");
  const topics = (url.searchParams.get("topics") ?? "notifications").split(",");
  if (topics.length < 1 || topics.length > 4 || new Set(topics).size !== topics.length
    || topics.some((topic) => !(LIVE_TOPICS as readonly string[]).includes(topic))) throw new Error("Invalid subscription");
  const context: LiveContext = {};
  for (const key of ["driverId", "companyId", "branchId"] as const) {
    const value = url.searchParams.get(key);
    if (value !== null) {
      if (!uuid.test(value)) throw new Error("Invalid context");
      context[key] = value;
    }
  }
  if (Boolean(context.driverId) !== topics.includes("driver")
    || (context.companyId && !topics.includes("wallet"))
    || (context.branchId && !topics.includes("catalog"))) throw new Error("Invalid context");
  const transport = url.searchParams.get("transport");
  if (transport !== null && transport !== "poll") throw new Error("Invalid transport");
  return { topics: topics as LiveTopic[], context, polling: transport === "poll" };
}

/** Epoch is transport-local, not a persisted business event cursor. */
export function acceptLiveFrame(current: { epoch: string; sequence: number } | null, value: unknown) {
  if (!value || typeof value !== "object") return null;
  const frame = value as { epoch?: unknown; sequence?: unknown; resync?: unknown; snapshot?: unknown };
  if (typeof frame.epoch !== "string" || !uuid.test(frame.epoch)
    || !Number.isSafeInteger(frame.sequence) || Number(frame.sequence) < 1
    || !frame.snapshot || typeof frame.snapshot !== "object") return null;
  if ((!current || frame.epoch !== current.epoch) && (frame.resync !== true || frame.sequence !== 1)) return null;
  if (current?.epoch === frame.epoch && Number(frame.sequence) <= current.sequence) return null;
  const snapshot = frame.snapshot as LiveSnapshot;
  if ((snapshot.streamEnabled !== undefined && typeof snapshot.streamEnabled !== "boolean")
    || Object.keys(snapshot).some((key) => key !== "topics" && key !== "streamEnabled")
    || !snapshot.topics || typeof snapshot.topics !== "object" || Array.isArray(snapshot.topics)
    || Object.entries(snapshot.topics).some(([topic, hint]) => !(LIVE_TOPICS as readonly string[]).includes(topic)
      || !hint || typeof hint !== "object" || !/^[a-f0-9]{64}$/.test(hint.version)
      || Object.keys(hint).some((key) => key !== "version" && key !== "unreadCount")
      || (hint.unreadCount !== undefined && (topic !== "notifications" || !Number.isSafeInteger(hint.unreadCount) || hint.unreadCount < 0)))) return null;
  return { epoch: frame.epoch, sequence: Number(frame.sequence), snapshot };
}
