import { describe, expect, it } from "vitest";
import type { AccessSubject } from "@/lib/permissions";
import {
  authorizedSessionReturnPath,
  isRecognizedProtectedPath,
  mergeStoredReturnHash,
  safeInternalReturnPath,
  sessionReturnInternals,
} from "@/lib/session-return";

const owner: AccessSubject = {
  role: "PLATFORM_OWNER",
  accountKind: "PLATFORM",
  scopeType: "PLATFORM",
  isOwner: true,
};

const requester: AccessSubject = {
  role: "REQUESTER",
  accountKind: "COMPANY",
  scopeType: "BRANCH",
  companyId: "10000000-0000-4000-8000-000000000001",
  branchId: "20000000-0000-4000-8000-000000000001",
  isOwner: false,
};

describe("session return paths", () => {
  it("preserves a recognized path, query, and fragment", () => {
    expect(safeInternalReturnPath(
      "/requests?status=open&q=paper#request-table",
      "/dashboard",
    )).toBe("/requests?status=open&q=paper#request-table");
    expect(isRecognizedProtectedPath("/requests/abc")).toBe(true);
    expect(isRecognizedProtectedPath("/api/private")).toBe(false);
  });

  it.each([
    "https://evil.example/requests",
    "//evil.example/requests",
    "https://axora.management.evil.example/requests",
    "\\evil.example\\requests",
    "/api/private",
    "/login",
    "/_next/static/chunk.js",
    "/requests%5Cevil",
    "/requests?next=%5C%5Cevil.example",
    "/requests?notice=ok%0d%0aSet-Cookie%3Aforged",
    "/requests#tab%00hidden",
    "/requests\u0000?status=open",
  ])("rejects an external, malformed, or non-portal route: %s", (value) => {
    expect(safeInternalReturnPath(value, "/dashboard")).toBe("/dashboard");
  });

  it("bounds return paths before parsing", () => {
    const oversized = `/requests?q=${"x".repeat(
      sessionReturnInternals.maxLength,
    )}`;
    expect(safeInternalReturnPath(oversized, "/dashboard"))
      .toBe("/dashboard");
  });

  it("returns only routes permitted by the current role", () => {
    expect(authorizedSessionReturnPath(
      owner,
      "/users?tab=access#active",
      "/dashboard",
    )).toBe("/users?tab=access#active");
    expect(authorizedSessionReturnPath(
      requester,
      "/requests?status=open",
      "/dashboard",
    )).toBe("/requests?status=open");
    expect(authorizedSessionReturnPath(
      requester,
      "/users",
      "/dashboard",
    )).toBe("/dashboard");
    expect(isRecognizedProtectedPath("/supplier")).toBe(false);
  });

  it("restores a fragment only when path and query match", () => {
    expect(mergeStoredReturnHash(
      "/requests?status=open",
      "/requests?status=open#request-table",
    )).toBe("/requests?status=open#request-table");
    expect(mergeStoredReturnHash(
      "/requests?status=open",
      "/requests?status=closed#request-table",
    )).toBe("/requests?status=open");
    expect(mergeStoredReturnHash(
      "/requests?status=open#server-fragment",
      "/requests?status=open#browser-fragment",
    )).toBe("/requests?status=open#server-fragment");
  });
});
