import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("production route stabilization migration", () => {
  it("uses narrow capabilities for escalation reads and nullable profile policy scope", async () => {
    const [migration, grants] = await Promise.all([
      readFile(new URL(
        "../database/migrations/073_production_route_stabilization.sql",
        import.meta.url,
      ), "utf8"),
      readFile(new URL("../database/admin/apply-app-grants.sql", import.meta.url), "utf8"),
    ]);
    expect(migration).toContain("axora_request_escalation_rows");
    expect(migration).toContain("SECURITY DEFINER");
    expect(migration).toContain("axora_request_access_rows");
    expect(migration).toContain(
      "REVOKE ALL ON TABLE public.request_approval_escalations FROM axora_app",
    );
    expect(migration).toContain("selected_company_id uuid");
    expect(migration).not.toContain("company_row record");
    expect(grants).toContain(
      "GRANT EXECUTE ON FUNCTION public.axora_request_escalation_rows(uuid,uuid,timestamptz) TO axora_app",
    );
  });
});
