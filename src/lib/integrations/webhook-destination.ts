import { lookup as dnsLookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";

export class WebhookDestinationError extends Error {
  constructor(public readonly category: "INVALID_URL" | "SSRF_BLOCKED" | "DNS_ERROR") {
    super("The webhook destination is unavailable.");
    this.name = "WebhookDestinationError";
  }
}

export interface WebhookResolvedAddress {
  address: string;
  family: 4 | 6;
}

export type WebhookResolver = (
  hostname: string,
) => Promise<readonly WebhookResolvedAddress[]>;

const DNS_TIMEOUT_MS = 3_000;

async function boundedResolution(
  resolver: WebhookResolver,
  hostname: string,
) {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      resolver(hostname),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new WebhookDestinationError("DNS_ERROR")),
          DNS_TIMEOUT_MS,
        );
        timer.unref();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

const forbiddenIpv4Addresses = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10],
  ["127.0.0.0", 8], ["168.63.129.16", 32], ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.31.196.0", 24],
  ["192.52.193.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16],
  ["192.175.48.0", 24], ["198.18.0.0", 15], ["198.51.100.0", 24],
  ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) forbiddenIpv4Addresses.addSubnet(network, prefix, "ipv4");
const forbiddenIpv6Addresses = new BlockList();
for (const [network, prefix] of [
  ["::", 96], ["::1", 128], ["::ffff:0:0", 96], ["64:ff9b::", 96],
  ["64:ff9b:1::", 48],
  ["100::", 64], ["2001::", 32], ["2001:2::", 48],
  ["2001:10::", 28], ["2001:20::", 28], ["2001:30::", 28],
  ["2001:db8::", 32], ["2002::", 16], ["fc00::", 7],
  ["3fff::", 20], ["5f00::", 16], ["fe80::", 10], ["fec0::", 10],
  ["ff00::", 8],
] as const) forbiddenIpv6Addresses.addSubnet(network, prefix, "ipv6");

function unbracket(hostname: string) {
  return hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname;
}

export function isPublicWebhookAddress(address: string, family = isIP(address)) {
  if (family !== 4 && family !== 6) return false;
  try {
    return family === 4
      ? !forbiddenIpv4Addresses.check(address, "ipv4")
      : !forbiddenIpv6Addresses.check(address, "ipv6");
  } catch {
    return false;
  }
}

function hostnameIsInternal(hostname: string) {
  const normalized = hostname.toLowerCase().replace(/\.$/, "");
  return !normalized.includes(".")
    || normalized === "localhost"
    || normalized.endsWith(".localhost")
    || normalized.endsWith(".local")
    || normalized.endsWith(".internal")
    || normalized.endsWith(".home")
    || normalized.endsWith(".lan")
    || normalized.endsWith(".test")
    || normalized.endsWith(".invalid")
    || normalized.endsWith(".example");
}

export function parseWebhookDestination(value: string) {
  if (value.length < 9 || value.length > 2048 || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new WebhookDestinationError("INVALID_URL");
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new WebhookDestinationError("INVALID_URL");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.hash
    || (url.port && url.port !== "443")) {
    throw new WebhookDestinationError("INVALID_URL");
  }
  const originalHostname = unbracket(url.hostname).toLowerCase();
  const hostname = originalHostname.replace(/\.$/, "");
  if (hostname !== originalHostname) url.hostname = hostname;
  const family = isIP(hostname);
  if ((!family && hostnameIsInternal(hostname))
    || (family && !isPublicWebhookAddress(hostname, family))) {
    throw new WebhookDestinationError("SSRF_BLOCKED");
  }
  return { url, hostname, family: family as 0 | 4 | 6 };
}

export async function defaultWebhookResolver(hostname: string) {
  try {
    const addresses = await dnsLookup(hostname, { all: true, verbatim: true });
    return addresses.flatMap((entry): WebhookResolvedAddress[] =>
      entry.family === 4 || entry.family === 6
        ? [{ address: entry.address, family: entry.family }]
        : []);
  } catch {
    throw new WebhookDestinationError("DNS_ERROR");
  }
}

export async function resolveWebhookDestination(
  value: string,
  resolver: WebhookResolver = defaultWebhookResolver,
) {
  const parsed = parseWebhookDestination(value);
  const addresses = parsed.family
    ? [{ address: parsed.hostname, family: parsed.family } as WebhookResolvedAddress]
    : await boundedResolution(resolver,parsed.hostname);
  if (!addresses.length || addresses.length > 16
    || addresses.some((entry) => !isPublicWebhookAddress(entry.address, entry.family))) {
    throw new WebhookDestinationError("SSRF_BLOCKED");
  }
  const unique = [...new Map(addresses.map((entry) => [
    `${entry.family}:${entry.address}`,
    { address: entry.address, family: entry.family },
  ])).values()].sort((left, right) =>
    left.family - right.family || left.address.localeCompare(right.address));
  return {
    url: parsed.url,
    hostname: parsed.hostname,
    endpointOrigin: parsed.url.origin,
    addresses: unique,
  };
}
