import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const files = {
  domain: new URL("../src/lib/generated-documents.ts", import.meta.url),
  route: new URL("../src/app/api/generated-documents/[id]/route.ts", import.meta.url),
};

describe("retained generated invoice downloads", () => {
  it("keeps document generation inside audited capability transactions", async () => {
    const domain = await readFile(files.domain, "utf8");
    expect(domain).toContain("withAuditTransaction");
    expect(domain).toContain("axora_request_document_regeneration");
  });

  it("returns non-revealing misses and never serves storage paths directly", async () => {
    const source = await readFile(files.route, "utf8");
    expect(source).toContain("getSession");
    expect(source).toContain("loadGeneratedDocumentFile");
    expect(source).toMatch(/status:\s*404/);
    expect(source).toContain('"Cache-Control": "private, no-store"');
    expect(source).toContain("Content-Disposition");
    expect(source).not.toContain("sendFile(");
  });

});
