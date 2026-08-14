import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

describe("immersive world V2 capability regressions", () => {
  it("re-grants the exact visitor capabilities used by the application", () => {
    const migration = read("database/migrations/083_immersive_world_preferences_and_visitor_readiness.sql");

    expect(migration).toContain("axora_public_visitor_snapshot_v2(text,text,text,text)");
    expect(migration).toContain("axora_claim_public_visitor(text,text,text,text,text,text,text,timestamptz,text)");
    expect(migration).not.toContain("axora_public_visitor_snapshot_v2(text,text)'");
    expect(migration).not.toContain("axora_claim_public_visitor_v2");
  });

  it("reads retained driver locations through the owning tracking session", () => {
    const migration = read("database/migrations/084_driver_self_claim_and_management.sql");

    expect(migration).toContain("tracking_session.driver_user_id=account.id");
    expect(migration).toContain("point.recorded_at");
    expect(migration).not.toContain("point.driver_user_id=account.id");
    expect(migration).not.toMatch(/\bpoint\.captured_at\b/);
  });
});
