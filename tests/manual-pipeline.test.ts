import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const publicDir = join(root, "public", "manuals");
const outputDir = join(root, "output", "pdf");
const names = [
  "axora-company-user-manual-ar.pdf",
  "axora-company-user-manual-en.pdf",
  "axora-owner-admin-manual-ar.pdf",
  "axora-owner-admin-manual-en.pdf",
];

function sha256(path: string) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

describe("production manual publication", () => {
  it("publishes only the four stable filenames", () => {
    expect(readdirSync(publicDir).filter((name) => name.endsWith(".pdf")).sort()).toEqual(names);
  });

  it("publishes the exact deterministic build output", () => {
    for (const name of names) {
      const built = join(outputDir, name);
      const published = join(publicDir, name);
      expect(statSync(published).size).toBeGreaterThan(50_000);
      expect(readFileSync(published).subarray(0, 5).toString()).toBe("%PDF-");
      expect(sha256(published)).toBe(sha256(built));
    }
  });

  it("uses the approved logo derivative and immutable core palette", () => {
    const source = readFileSync(join(root, "scripts", "manuals", "generate_user_manuals.py"), "utf8");
    expect(source).toContain('LOGO = ROOT / "public" / "brand" / "axora-logo-dark-background.png"');
    expect(source).toContain('NAVY = HexColor("#0B2D52")');
    expect(source).toContain('AMBER = HexColor("#E8A33D")');
    expect(source).toContain('white');
    expect(source).not.toMatch(/drawString\([^\n]*["']AXORA["']/);
  });

  it("keeps current secure workflow guidance in the source copy", () => {
    const source = readFileSync(join(root, "scripts", "manuals", "generate_user_manuals.py"), "utf8");
    expect(source).toContain("one-time invitation link");
    expect(source).toContain("Self-approval is blocked");
    expect(source).not.toContain("Supplier User");
    expect(source).toContain("Delivery Guy");
    expect(source).toContain("Human Resources Management");
    expect(source).toContain("Client Account Manager");
    expect(source).not.toMatch(/sourcing team|supplier selection|three-way matching|Delivery Driver|Receiving User/i);
    expect(source).not.toMatch(/\b(?:sidebar|temporary password|initial password|interactive-experience)\b/i);
  });
});
