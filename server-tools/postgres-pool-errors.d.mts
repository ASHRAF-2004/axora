export interface PostgresIdleClientErrorEntry {
  event: "postgres_idle_client_error";
  component: "app" | "budget-worker" | "document-worker"
    | "company-deletion-cleanup-worker" | "integration-worker";
  sqlState?: string;
}

export function attachPostgresPoolErrorHandler(
  pool: { on(event: "error", listener: (error: unknown) => void): unknown },
  options: {
    component: PostgresIdleClientErrorEntry["component"];
    onError?: () => void;
    logError?: (entry: PostgresIdleClientErrorEntry) => void;
  },
): boolean;
