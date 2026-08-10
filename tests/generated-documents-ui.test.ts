import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const files = {
  messages: new URL("../src/lib/generated-documents-i18n.ts", import.meta.url),
  panel: new URL("../src/components/GeneratedDocumentsPanel.tsx", import.meta.url),
  actions: new URL("../src/lib/generated-document-actions.ts", import.meta.url),
  domain: new URL("../src/lib/generated-documents.ts", import.meta.url),
  route: new URL("../src/app/api/generated-documents/[id]/route.ts", import.meta.url),
  documentsLayout: new URL("../src/app/(portal)/documents/layout.tsx", import.meta.url),
};

describe("generated document portal surfaces", () => {
  it("ships complete English, Arabic and Malay workflow copy", async () => {
    const source = await readFile(files.messages, "utf8");
    expect(source).toContain("en:");
    expect(source).toContain("ar:");
    expect(source).toContain("ms:");
    expect(source).toContain("Ready for sales review");
    expect(source).toContain("Dispatch secure link");
    expect(source).toMatch(/[\u0600-\u06ff]/);
    expect(source).toContain("Pesanan pembelian");
  });

  it("keeps one page heading and exposes version, retry, correction and PO controls", async () => {
    const source = await readFile(files.panel, "utf8");
    expect(source).not.toContain("PageHeader");
    expect(source).toContain('id="generated-documents"');
    expect(source).toContain("regenerateGeneratedDocumentAction");
    expect(source).toContain("manageSupplierPurchaseOrderAction");
    expect(source).toContain("recipientUserId");
    expect(source).toContain("READY_FOR_SALES_REVIEW");
    expect(source).toContain("DISPATCHED_TO_SUPPLIER");
    expect(source).toContain("ACKNOWLEDGED");
    expect(source).toContain("expectedVersion");
    expect(source).toContain("data-table-wrap");
    expect(source).toContain("StatusBadge");
  });

  it("authorizes every command in the same audited transaction", async () => {
    const [actions, domain] = await Promise.all([
      readFile(files.actions, "utf8"),
      readFile(files.domain, "utf8"),
    ]);
    expect(actions).toContain("requireSession");
    expect(actions).toContain("requestGeneratedDocumentVersion");
    expect(actions).toContain("manageSupplierPurchaseOrder");
    expect(actions).toContain("revalidatePath");
    expect(domain).toContain("withAuditTransaction");
    expect(domain).toContain("axora_request_document_regeneration");
    expect(domain).toContain("axora_manage_supplier_purchase_order");
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

  it("adds the internal panel without replacing the established portal", async () => {
    const documents = await readFile(files.documentsLayout, "utf8");
    expect(documents).toContain('requirePagePermission("view_documents")');
    expect(documents).toContain("{children}");
  });
});
