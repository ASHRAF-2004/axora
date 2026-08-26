const DELIVERY_STORAGE_PREFIXES = [
  "axora:delivery-commands:v2",
  "axora:delivery-claim:v1",
  "axora:delivery-reconciliation:v1",
  "axora:driver",
  "axora:delivery-location:v1",
  "axora:delivery-location-device:v1",
  "axora:delivery-location-paused:v1",
  "axora:delivery-device",
] as const;

export function clearDeliveryBrowserState(userId: string) {
  if (typeof window === "undefined" || !userId) return;
  const storage = window.localStorage;
  const encodedUserId = encodeURIComponent(userId);
  const exactKeys = [
    `axora:delivery-commands:v2:${userId}`,
    `axora:delivery-claim:v1:${userId}`,
    `axora:delivery-reconciliation:v1:${userId}`,
    `axora:driver:${userId}:event-queue:v1`,
    `axora:delivery-location:v1:${userId}`,
    `axora:delivery-location-device:v1:${userId}`,
    `axora:delivery-location-paused:v1:${userId}`,
    `axora:delivery-device:${userId}`,
  ];
  for (const key of exactKeys) storage.removeItem(key);

  // Retained clients may have encoded a scoped identity. Remove only keys
  // demonstrably bound to this user; never clear unrelated browser storage.
  for (let index = storage.length - 1; index >= 0; index -= 1) {
    const key = storage.key(index);
    if (!key || !DELIVERY_STORAGE_PREFIXES.some((prefix) => key.startsWith(prefix))) {
      continue;
    }
    if (key.includes(`:${userId}:`) || key.includes(`:${encodedUserId}:`)) {
      storage.removeItem(key);
    }
  }
}

export const deliveryBrowserStateInternals = { DELIVERY_STORAGE_PREFIXES };
