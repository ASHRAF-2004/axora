import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

describe("real asynchronous operation status", () => {
  it("uses real avatar bytes, server processing, cancellation, timeout uncertainty, and scoped mutations", async () => {
    const [component, transport, route, domain] = await Promise.all([
      source("src/components/ProfileImageManager.tsx"),
      source("src/lib/profile-image-upload-client.ts"),
      source("src/app/api/profile/avatar/route.ts"),
      source("src/lib/profile-images.ts"),
    ]);
    expect(transport).toContain("xhr.upload.onprogress");
    expect(transport).toContain("xhr.upload.onload");
    expect(transport).toContain("xhr.ontimeout");
    expect(transport).toContain("xhr.abort()");
    expect(component).toContain('phase === "processing"');
    expect(component).toContain("requestRef.current?.cancel()");
    expect(component).not.toContain("setInterval");
    expect(component).not.toMatch(/setProgress\([^)]*92/);
    expect(route).toContain("getAccountLifecycleSession");
    expect(route).toContain("isSameOrigin(request)");
    expect(route).toContain("saveMyProfileImage");
    expect(route).toContain("removeMyProfileImage");
    expect(route).toContain("referenceId");
    expect(domain).toContain('status: z.enum(["ACTIVATED", "UNCHANGED"])');
  });

  it("never converts a watchdog or animated bar into user-facing completion", async () => {
    const [provider, css] = await Promise.all([
      source("src/components/UxFeedbackProvider.tsx"),
      source("src/app/globals.css"),
    ]);
    expect(provider).toContain("requestUncertain");
    expect(provider).toContain("navigationUncertain");
    expect(provider).toContain("frameworkPendingSeen");
    expect(provider).toContain("uxRequestPending");
    expect(provider).not.toContain("12000");
    expect(provider).not.toContain("8000");
    expect(css).toContain("ux-indeterminate");
    expect(css).not.toContain("@keyframes ux-progress");
    expect(css).not.toMatch(/data-ux-navigating="true"[^}]+width:\s*78%/s);
  });

  it("polls retained invoice document jobs without inventing client completion", async () => {
    const [controls, domain] = await Promise.all([
      source("src/components/GeneratedDocumentAsyncControls.tsx"),
      source("src/lib/generated-documents.ts"),
    ]);
    expect(controls).toContain("router.refresh()");
    expect(controls).toContain("document.visibilityState");
    expect(controls).toContain("navigator.onLine");
    expect(controls).toContain("useFormStatus");
    expect(domain).toContain("DocumentGenerationJobSummary");
  });

  it("preserves request-filter data and exposes retryable real failures", async () => {
    const filters = await source("src/components/RequestFilters.tsx");
    expect(filters).toContain("setLoadError(copy.loadError)");
    expect(filters).toContain("setRetryToken");
    expect(filters).toContain("loaded && !available.length");
    expect(filters).not.toMatch(/catch\([^)]*\)[\s\S]{0,120}setOptions\(\[\]\)/);
  });
});
