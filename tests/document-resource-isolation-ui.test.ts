import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const repositoryFile = (path: string) =>
  readFile(new URL(`../${path}`, import.meta.url), "utf8");

describe("document resource isolation route integration", () => {
  it("routes the documents page through the protected register and upload action", async () => {
    const page = await repositoryFile(
      "src/app/(portal)/documents/page.tsx",
    );
    expect(page).toContain(
      'loadAuthorizedDocumentRegisters } from "@/lib/document-isolation"',
    );
    expect(page).toContain(
      'uploadAttachmentAction } from "./actions"',
    );
    expect(page).not.toContain(
      'uploadAttachmentAction } from "../operations/actions"',
    );
    expect(page).not.toContain("listAttachments(");
  });

  it("requires step-up and delegates uploads to the canonical document service", async () => {
    const action = await repositoryFile(
      "src/app/(portal)/documents/actions.ts",
    );
    expect(action).toContain('requirePermission("manage_documents")');
    expect(action).toContain('requireRecentStepUp(actor, "/documents")');
    expect(action).toContain("recordId: documentRecordIdSchema");
    expect(action).toContain("createAuthorizedAttachment(actor");
    expect(action).not.toContain("saveAttachment(");
    expect(action).not.toContain("INSERT INTO attachments");
  });

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

  it("keeps production access on capabilities instead of the raw attachment table", async () => {
    const service = await repositoryFile("src/lib/document-isolation.ts");
    expect(service).toContain("axora_attachment_access_rows");
    expect(service).toContain("axora_attachment_download");
    expect(service).toContain("axora_create_attachment");
    expect(service).toContain(
      "uuidSchema.safeParse(request.data.recordId).success",
    );
    expect(service).not.toMatch(/FROM\s+attachments\b/i);
    expect(service).not.toMatch(/INSERT\s+INTO\s+attachments\b/i);
  });
});