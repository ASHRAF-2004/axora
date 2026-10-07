const attachedPools = new WeakSet();
const COMPONENTS = new Set([
  "app", "budget-worker", "document-worker",
  "company-deletion-cleanup-worker", "integration-worker",
]);

// pg-pool already removes the failed idle client before it emits this event.
// Handling it keeps the process alive; the next query obtains a fresh client.
// No transaction is retried, and exception text/connection metadata never logs.
export function attachPostgresPoolErrorHandler(pool, {
  component,
  onError,
  logError = (entry) => console.error(JSON.stringify(entry)),
}) {
  if (!COMPONENTS.has(component)) throw new Error("Invalid PostgreSQL pool component.");
  if (attachedPools.has(pool)) return false;
  attachedPools.add(pool);
  pool.on("error", (error) => {
    onError?.();
    const sqlState = error && typeof error === "object"
      && typeof error.code === "string" && /^[A-Z0-9]{5}$/.test(error.code)
      ? error.code : undefined;
    logError({
      event: "postgres_idle_client_error",
      component,
      ...(sqlState ? { sqlState } : {}),
    });
  });
  return true;
}
