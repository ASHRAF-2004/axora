import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderVersionedDocument } from "../server-tools/document-renderer.mjs";
import { loadTransactionalAttachment } from "../server-tools/email-sender.mjs";
import { renderTransactionalEmail } from "../server-tools/transactional-email.mjs";

const snapshot = {
  schemaVersion: 1, documentType: "FINAL_INVOICE", locale: "en",
  timezone: "Asia/Kuala_Lumpur", capturedAt: "2026-08-12T04:00:00.000Z",
  company: { companyName: "Synthetic Company" },
  invoice: {
    number: "AX-INV-2026-00000001", status: "PAID",
    issuedAt: "2026-08-12T04:00:00.000Z",
    paidAt: "2026-08-12T04:00:00.000Z", currency: "MYR", amount: "26.50",
  },
  request: { reference: "REQ-SYNTHETIC-001" },
  lines: [{
    sku: "SKU-1", name: "Synthetic item", quantity: "2",
    unitOfMeasure: "EA", unitPrice: "12.50", lineTotal: "25.00",
  }],
  totals: {
    subtotal: "25.00", discount: "0.00", tax: "1.50",
    delivery: "0.00", total: "26.50",
  },
};

describe("final invoice document and email", () => {
  const roots = [];
  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => (
      rm(root, { recursive: true, force: true })
    )));
  });

  it("renders a deterministic paid invoice without obsolete wording", async () => {
    const first = await renderVersionedDocument({ snapshot });
    const second = await renderVersionedDocument({ snapshot });
    expect(first.bytes.equals(second.bytes)).toBe(true);
    expect(first.bytes.subarray(0, 5).toString()).toBe("%PDF-");
    expect(first.bytes.toString("latin1")).not.toMatch(/cash on delivery|\bCOD\b/i);
  });

  it("renders localized HTML and plaintext invoice copy", async () => {
    const rendered = await renderTransactionalEmail({
      deliveryId: "10000000-0000-4000-8000-000000000001",
      messageKind: "INVOICE_FINALIZED", locale: "en",
      recipientEmail: "invoice-recipient@example.test",
      recipientName: "Invoice Recipient",
      invoice: {
        invoiceId: "20000000-0000-4000-8000-000000000001",
        invoiceNumber: "AX-INV-2026-00000001",
        requestId: "30000000-0000-4000-8000-000000000001",
        requestReference: "REQ-SYNTHETIC-001", companyName: "Synthetic Company",
        amount: "26.50", currency: "MYR",
        paidAt: "2026-08-12T04:00:00.000Z",
        issuedAt: "2026-08-12T04:00:00.000Z",
      },
    });
    expect(rendered.subject).toContain("AX-INV-2026-00000001");
    expect(rendered.html).toContain("Payment confirmed");
    expect(rendered.text).toContain("finalized invoice is attached");
    expect(`${rendered.html}${rendered.text}`).not.toMatch(/cash on delivery|\bCOD\b/i);
  });

  it("loads only the exact finalized PDF with checksum and size validation", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "axora-invoice-email-"));
    roots.push(root);
    const relative = "generated-documents/10000000-0000-4000-8000-000000000001/20000000-0000-4000-8000-000000000001/30000000-0000-4000-8000-000000000001.pdf";
    const target = path.join(root, ...relative.split("/"));
    await mkdir(path.dirname(target), { recursive: true });
    const pdf = Buffer.from(`%PDF-1.4\n${"x".repeat(100)}\n%%EOF`);
    await writeFile(target, pdf);
    const metadata = {
      storagePath: relative,
      fileName: "Axora-Invoice-AX-INV-2026-00000001.pdf",
      contentType: "application/pdf",
      checksum: createHash("sha256").update(pdf).digest("hex"),
      fileSize: pdf.length,
    };
    const attachment = await loadTransactionalAttachment(metadata, {
      env: { AXORA_UPLOADS_CONTAINER_DIR: root },
    });
    expect(attachment).toMatchObject({
      type: "application/pdf", disposition: "attachment",
    });
    expect(Buffer.from(attachment.content, "base64")).toEqual(pdf);
    await expect(loadTransactionalAttachment(
      { ...metadata, checksum: "0".repeat(64) },
      {
        env: { AXORA_UPLOADS_CONTAINER_DIR: root },
        readFileImpl: vi.fn().mockResolvedValue(pdf),
      },
    )).rejects.toThrow("email_attachment_unavailable");
  });
});
