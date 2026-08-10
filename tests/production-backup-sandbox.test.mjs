import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("production backup disposable upload restore", () => {
  it("strips archived setgid modes inside the hardened systemd sandbox", async () => {
    const source = await readFile(new URL(
      "../scripts/production/backup.sh",
      import.meta.url,
    ), "utf8");
    expect(source).toContain("--no-same-owner");
    expect(source).toContain("--no-same-permissions");
    expect(source).toContain("--mode='u+rwX,go-rwx'");
    expect(source).toContain("Restored uploads archive differs in file content.");
    expect(source).toContain("Restored uploads archive differs in directory layout.");
  });
});
