import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

import App from "../index.js";
import { AXORA_EVENT_TYPES, AXORA_SCOPES } from "../constants.js";

const require = createRequire(import.meta.url);
const { prepareApp, validateApp } = require("zapier-platform-core/src/tools/schema");

describe("private-beta contract", () => {
  it("is valid against the exact pinned Zapier schema", () => {
    expect(validateApp(prepareApp(App))).toEqual([]);
  });

  it("publishes only the approved triggers, searches, and safe draft action", () => {
    expect(Object.keys(App.triggers)).toEqual([
      "new_request",
      "request_submitted",
      "request_approved",
      "invoice_finalized",
      "delivery_out_for_delivery",
      "delivery_completed",
    ]);
    expect(Object.keys(App.searches)).toEqual([
      "find_company",
      "find_request",
      "find_delivery",
      "find_invoice",
    ]);
    expect(Object.keys(App.creates)).toEqual(["create_request_draft"]);
    expect(AXORA_EVENT_TYPES).toHaveLength(6);
  });

  it("never requests a broad admin or financial-write scope", () => {
    expect(AXORA_SCOPES).toEqual([
      "companies:read",
      "requests:read",
      "requests:draft",
      "deliveries:read",
      "invoices:read",
      "webhooks:manage",
    ]);
    expect(AXORA_SCOPES.join(" ")).not.toMatch(
      /admin|wallet:write|payments:write|approvals:write|permissions:write|users:write/,
    );
  });

  it("uses only fictional, privacy-minimized samples", () => {
    const samples = [
      ...Object.values(App.triggers).map((item) => item.operation.sample),
      ...Object.values(App.searches).map((item) => item.operation.sample),
      ...Object.values(App.creates).map((item) => item.operation.sample),
    ];
    const serialized = JSON.stringify(samples);
    expect(serialized).toContain("FICTIONAL");
    expect(serialized).not.toMatch(
      /@|phone|password|access_token|refresh_token|supplier_cost|buying_cost|margin|latitude|longitude|proof/i,
    );
  });
});
