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

  it("allows tar extraction without weakening the remaining service sandbox", async () => {
    const backupUnit = await readFile(new URL(
      "../deploy/systemd/axora-backup.service",
      import.meta.url,
    ), "utf8");
    const directives = new Set(
      backupUnit.split("\n").map((line) => line.trim()).filter(Boolean),
    );

    expect(directives).toContain("RestrictSUIDSGID=no");
    expect(directives).not.toContain("RestrictSUIDSGID=yes");
    expect([...directives]).toEqual(expect.arrayContaining([
      "User=root",
      "Group=root",
      "UMask=0077",
      "NoNewPrivileges=yes",
      "PrivateTmp=yes",
      "PrivateDevices=yes",
      "ProtectClock=yes",
      "ProtectControlGroups=yes",
      "ProtectHome=yes",
      "ProtectHostname=yes",
      "ProtectKernelLogs=yes",
      "ProtectKernelModules=yes",
      "ProtectKernelTunables=yes",
      "ProtectSystem=strict",
      "ReadOnlyPaths=/etc/axora-production",
      "ReadWritePaths=/var/lib/axora-production /run/docker.sock -/mnt -/media",
      "LockPersonality=yes",
      "RestrictRealtime=yes",
      "SystemCallArchitectures=native",
    ]));
  });

  it("does not weaken the health service sandbox", async () => {
    const healthUnit = await readFile(new URL(
      "../deploy/systemd/axora-health.service",
      import.meta.url,
    ), "utf8");
    const directives = healthUnit.split("\n").map((line) => line.trim());

    expect(directives).toContain("RestrictSUIDSGID=yes");
    expect(directives).not.toContain("RestrictSUIDSGID=no");
  });
});
