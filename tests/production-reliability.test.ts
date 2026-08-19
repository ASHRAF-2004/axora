import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { safeErrorReference } from "@/lib/error-reference";

async function source(path: string) {
  return readFile(path, "utf8");
}

describe("production reliability contracts", () => {
  it("renders only a sanitized framework digest as the browser reference", () => {
    expect(safeErrorReference("3651452337")).toBe("AX-3651452337");
    expect(safeErrorReference("next.action-123")).toBe("AX-next.action-123");
    expect(safeErrorReference(" user@example.test ")).toBeUndefined();
    expect(safeErrorReference("token/value")).toBeUndefined();
    expect(safeErrorReference("line\nbreak")).toBeUndefined();
    expect(safeErrorReference("x".repeat(97))).toBeUndefined();
    expect(safeErrorReference(undefined)).toBeUndefined();
  });

  it("keeps unexpected recovery accurate, localized, and free of raw exception output", async () => {
    const boundary = await source("src/app/(portal)/error.tsx");
    expect(boundary).toContain("Something went wrong");
    expect(boundary).toContain("حدث خطأ ما");
    expect(boundary).toContain("Sesuatu tidak kena");
    expect(boundary).toContain("You're offline");
    expect(boundary).toContain("safeErrorReference(error.digest)");
    expect(boundary).toContain('data-testid="portal-error-boundary"');
    expect(boundary).not.toContain("This page could not be restored");
    expect(boundary).not.toContain("Check the connection");
    expect(boundary).not.toContain("error.message");
    expect(boundary).not.toContain("error.stack");
    expect(boundary).not.toContain("router.refresh()");
  });

  it("logs privacy-minimized request-error correlation data without browser secrets", async () => {
    const instrumentation = await source("src/instrumentation.ts");
    expect(instrumentation).toContain("onRequestError");
    expect(instrumentation).toContain('event: "next_request_error"');
    expect(instrumentation).toContain("deploymentRevision");
    expect(instrumentation).toContain("context.routePath");
    expect(instrumentation).toContain("safeErrorReference(error.digest)");
    expect(instrumentation).not.toContain("error.message");
    expect(instrumentation).not.toContain("error.stack");
    expect(instrumentation).not.toContain("request.headers");
    expect(instrumentation).not.toContain("request.path");
    expect(instrumentation).not.toContain("cookies");
  });

  it("builds Next with the exact immutable release revision as deploymentId", async () => {
    const dockerfile = await source("Dockerfile");
    const builderStart = dockerfile.indexOf("FROM base AS builder");
    const build = dockerfile.indexOf("npm run build", builderStart);
    const revision = dockerfile.indexOf("ARG AXORA_REVISION", builderStart);
    const deploymentId = dockerfile.indexOf("NEXT_DEPLOYMENT_ID=${AXORA_REVISION}", builderStart);

    expect(builderStart).toBeGreaterThanOrEqual(0);
    expect(revision).toBeGreaterThan(builderStart);
    expect(deploymentId).toBeGreaterThan(revision);
    expect(build).toBeGreaterThan(deploymentId);
    expect(dockerfile).toContain("AXORA_REVISION=${AXORA_REVISION}");
  });

  it("does not catch Next redirect control flow in Prompt 5 role/scope replacement", async () => {
    const actions = await source("src/app/(portal)/users/[id]/access/actions.ts");
    expect(actions).not.toContain('"digest" in error');
    expect(actions).toContain("let nextRoleAssignmentId = currentRoleAssignmentId");
    expect(actions).toContain("nextRoleAssignmentId = result.roleAssignmentId");
    expect(actions).toContain("refreshUserManagement(targetUserId);");
    expect(actions).toContain('"role-scope-updated"');
  });

  it("provides one reusable browser guard for generic recovery, page errors, failed requests and 5xx", async () => {
    const guard = await source("e2e/helpers/reliability.ts");
    expect(guard).toContain('page.on("pageerror"');
    expect(guard).toContain('message.type() === "error"');
    expect(guard).toContain("response.status() >= 500");
    expect(guard).toContain('page.on("requestfailed"');
    expect(guard).toContain('getByTestId("portal-error-boundary")');
  });
});
