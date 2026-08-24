export const CART_CHANGED_EVENT = "axora:authoritative-cart-changed";
const CART_CHANNEL = "axora-authoritative-cart-v1";

export interface CartChangedMessage {
  branchId: string;
  version: number;
}

function validMessage(value: unknown): value is CartChangedMessage {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<CartChangedMessage>;
  return typeof candidate.branchId === "string"
    && candidate.branchId.length > 0
    && candidate.branchId.length <= 160
    && Number.isSafeInteger(candidate.version)
    && Number(candidate.version) > 0;
}

export function publishCartChanged(message: CartChangedMessage) {
  if (typeof window === "undefined" || !validMessage(message)) return;
  window.dispatchEvent(new CustomEvent(CART_CHANGED_EVENT, { detail: message }));
  if (!("BroadcastChannel" in window)) return;
  const channel = new BroadcastChannel(CART_CHANNEL);
  channel.postMessage(message);
  channel.close();
}

export function subscribeCartChanged(listener: (message: CartChangedMessage) => void) {
  if (typeof window === "undefined") return () => undefined;
  const local = (event: Event) => {
    const detail = (event as CustomEvent<unknown>).detail;
    if (validMessage(detail)) listener(detail);
  };
  window.addEventListener(CART_CHANGED_EVENT, local);
  const channel = "BroadcastChannel" in window ? new BroadcastChannel(CART_CHANNEL) : null;
  if (channel) channel.onmessage = (event) => {
    if (validMessage(event.data)) listener(event.data);
  };
  return () => {
    window.removeEventListener(CART_CHANGED_EVENT, local);
    channel?.close();
  };
}
