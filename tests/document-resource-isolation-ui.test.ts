import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const repositoryFile = (path: string) =>
  readFile(new URL(`../${path}`, import.meta.url), "utf8");

describe("document resource isolation route integration", () => {
  it("reauthorizes every direct download with the authenticated actor", async () => {
    const route = await repositoryFile(
      "src/app/api/attachments/[id]/route.ts",
    );
    expect(route).toContain(
      'loadAuthorizedAttachmentFile } from "@/lib/document-isolation"',
    );
    expect(route).toContain(
      "loadAuthorizedAttachmentFile(actor, (await params).id)",
    );
    expect(route).not.toContain("loadAttachmentFile(");
    expect(route).toContain('"Cache-Control": "private, no-store"');
    expect(route).toContain('"X-Content-Type-Options": "nosniff"');
  });

  it("keeps retained historical attachment access on capabilities instead of raw tables", async () => {
    const service = await repositoryFile("src/lib/document-isolation.ts");
    const registers = await repositoryFile(
      "src/lib/document-register-isolation.ts",
    );
    expect(service).toContain("axora_attachment_access_rows");
    expect(service).toContain("axora_attachment_download");
    expect(service).toContain("axora_create_attachment");
    expect(service).toContain(
      "uuidSchema.safeParse(request.data.recordId).success",
    );
    expect(service).not.toMatch(/FROM\s+attachments\b/i);
    expect(service).not.toMatch(/INSERT\s+INTO\s+attachments\b/i);
    expect(registers).toContain("listAuthorizedInvoices(actor)");
    expect(registers).toContain("listAuthorizedDeliveries(actor)");
  });
});
