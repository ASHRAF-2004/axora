import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

import { deliveryProofRouteInternals } from "@/app/api/driver/proof/route";

describe("delivery proof upload boundary", () => {
  it("bounds declared and streamed multipart bodies before form parsing", async () => {
    const route = await readFile(new URL(
      "../src/app/api/driver/proof/route.ts",
      import.meta.url,
    ), "utf8");
    expect(route).toContain("MAX_PROOF_BODY_BYTES = 6 * 1024 * 1024");
    expect(route).toContain("request.body.getReader()");
    expect(route).toContain("total > MAX_PROOF_BODY_BYTES");
    expect(route).toContain("ProofBodyTooLarge");
    expect(route).toContain("status: 413");

    const form = new FormData();
    form.set("jobId", "controlled-job");
    const parsed = await deliveryProofRouteInternals.boundedFormData(new Request(
      "http://localhost/api/driver/proof",
      { method: "POST", body: form },
    ));
    expect(parsed.get("jobId")).toBe("controlled-job");

    const declaredOversized = new Request("http://localhost/api/driver/proof", {
      method: "POST",
      headers: {
        "Content-Type": "multipart/form-data; boundary=controlled",
        "Content-Length": String(deliveryProofRouteInternals.maximumBodyBytes + 1),
      },
      body: "--controlled--\r\n",
    });
    await expect(deliveryProofRouteInternals.boundedFormData(declaredOversized))
      .rejects.toThrow();

    const streamedOversized = new Request("http://localhost/api/driver/proof", {
      method: "POST",
      headers: { "Content-Type": "multipart/form-data; boundary=controlled" },
      body: new Uint8Array(deliveryProofRouteInternals.maximumBodyBytes + 1),
    });
    await expect(deliveryProofRouteInternals.boundedFormData(streamedOversized))
      .rejects.toThrow();
  });
});
