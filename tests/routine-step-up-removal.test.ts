import { readFile, readdir } from "node:fs/promises";
import { describe, expect, it } from "vitest";

async function actionFiles(directory: URL): Promise<URL[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const url = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, directory);
    if (entry.isDirectory()) return actionFiles(url);
    return entry.name === "actions.ts" ? [url] : [];
  }));
  return nested.flat();
}

describe("routine authenticated actions", () => {
  it("does not redirect normal portal mutations through password step-up", async () => {
    const files = await actionFiles(new URL("../src/app/(portal)/", import.meta.url));
    const sources = await Promise.all(files.map((file) => readFile(file, "utf8")));
    expect(sources.join("\n")).not.toContain("requireRecentStepUp");
    expect(sources.join("\n")).not.toContain("reauthenticateSensitiveAction");
  });

  it("retains current-password verification for credential changes", async () => {
    const action = await readFile(new URL("../src/app/(portal)/account/actions.ts", import.meta.url), "utf8");
    const security = await readFile(new URL("../src/lib/account-security.ts", import.meta.url), "utf8");
    expect(action).toContain("changeOwnPassword(actor, currentPassword, newPassword)");
    expect(security).toContain("verifyPassword(currentPassword");
  });
});
