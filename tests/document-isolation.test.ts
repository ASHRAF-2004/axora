import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  clientQuery: vi.fn(),
  isDemoMode: vi.fn(() => false),
  withAuditTransaction: vi.fn(),
  canAccess: vi.fn(() => true),
  listAuthorizedRequests: vi.fn(),
  listDeliveries: vi.fn(),
  listInvoices: vi.fn(),
  addDemoAudit: vi.fn(),
  getDemoOperations: vi.fn(() => ({
    quotations: [],
    approvals: [],
    deliveries: [],
    invoices: [],
    payments: [],
    audit: [],
    attachments: [],
  })),
}));

vi.mock("@/lib/db", () => ({
  query: mocks.query,
  isDemoMode: mocks.isDemoMode,
  withAuditTransaction: mocks.withAuditTransaction,
}));
vi.mock("@/lib/permissions", () => ({ canAccess: mocks.canAccess }));
vi.mock("@/lib/request-reader", () => ({
  listAuthorizedRequests: mocks.listAuthorizedRequests,
}));
vi.mock("@/lib/operations", () => ({
  listDeliveries: mocks.listDeliveries,
  listInvoices: mocks.listInvoices,
}));
vi.mock("@/lib/demo-operations", () => ({
  addDemoAudit: mocks.addDemoAudit,
  getDemoOperations: mocks.getDemoOperations,
}));

import type { AuthenticatedSessionUser } from "@/lib/auth";
import {
  createAuthorizedAttachment,
  DocumentAccessUnavailableError,
  documentIsolationInternals,
  listAuthorizedAttachments,
  loadAuthorizedAttachmentFile,
} from "@/lib/document-isolation";

const ids = {
  actor: "10000000-0000-4000-8000-000000000046",
  assignment: "20000000-0000-4000-8000-000000000046",
  attachment: "30000000-0000-4000-8000-000000000046",
  request: "40000000-0000-4000-8000-000000000046",
} as const;
const capturedAt = new Date("2026-08-07T12:00:00.000Z");
const pdfBytes = Buffer.from("%PDF-1.4\n%%EOF", "utf8");

const actor: AuthenticatedSessionUser = {
  id: ids.actor,
  email: "documents@example.test",
  name: "Document manager",
  role: "COMPANY_ADMIN",
  accountKind: "COMPANY",
  scopeType: "COMPANY",
  companyId: "50000000-0000-4000-8000-000000000046",
  roleAssignmentId: ids.assignment,
  isOwner: false,
  authVersion: 7,
};

const temporaryRoots: string[] = [];
const originalUploadRoot = process.env.AXORA_UPLOADS_CONTAINER_DIR;

async function temporaryRoot(prefix: string) {
  const root = await mkdtemp(path.join(tmpdir(), prefix));
  temporaryRoots.push(root);
  return root;
}

function accessRow() {
  return {
    capturedAt,
    id: ids.attachment,
    entityType: "request",
    recordId: ids.request,
    requestId: ids.request,
    fileName: "policy.pdf",
    contentType: "application/pdf",
    visibility: "CUSTOMER",
    createdAt: new Date("2026-08-07T11:30:00.000Z"),
    uploadedByName: "Document manager",
  };
}

function downloadRow(bytes: Buffer = pdfBytes) {
  return {
    capturedAt,
    attachmentId: ids.attachment,
    fileName: "policy.pdf",
    contentType: "application/pdf",
    storagePath: "db/policy.pdf",
    fileContent: bytes,
    visibility: "CUSTOMER",
  };
}

describe("document isolation service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isDemoMode.mockReturnValue(false);
    mocks.canAccess.mockReturnValue(true);
    mocks.listAuthorizedRequests.mockResolvedValue([]);
    mocks.listDeliveries.mockResolvedValue([]);
    mocks.listInvoices.mockResolvedValue([]);
    mocks.withAuditTransaction.mockImplementation(async (
      _context: unknown,
      work: (client: { query: typeof mocks.clientQuery }) => Promise<unknown>,
    ) => work({ query: mocks.clientQuery }));
  });

  afterEach(async () => {
    if (originalUploadRoot === undefined) {
      delete process.env.AXORA_UPLOADS_CONTAINER_DIR;
    } else {
      process.env.AXORA_UPLOADS_CONTAINER_DIR = originalUploadRoot;
    }
    await Promise.all(temporaryRoots.splice(0).map((root) =>
      rm(root, { recursive: true, force: true })));
  });

  it("strictly validates minimized metadata from the live assignment capability", async () => {
    mocks.query.mockResolvedValueOnce({ rows: [accessRow()] });
    const attachments = await listAuthorizedAttachments(actor, capturedAt);
    expect(attachments).toEqual([{
      id: ids.attachment,
      entityType: "request",
      recordId: ids.request,
      fileName: "policy.pdf",
      contentType: "application/pdf",
      visibility: "CUSTOMER",
      createdAt: "2026-08-07T11:30:00.000Z",
      uploadedByName: "Document manager",
    }]);
    expect(mocks.query).toHaveBeenCalledWith(
      expect.stringContaining("axora_attachment_access_rows"),
      [ids.actor, ids.assignment, capturedAt],
    );

    mocks.query.mockResolvedValueOnce({
      rows: [{ ...accessRow(), passwordHash: "must-not-parse" }],
    });
    await expect(listAuthorizedAttachments(actor, capturedAt))
      .rejects.toBeInstanceOf(DocumentAccessUnavailableError);

    await expect(listAuthorizedAttachments(
      { ...actor, roleAssignmentId: undefined },
      capturedAt,
    )).rejects.toBeInstanceOf(DocumentAccessUnavailableError);
  });

  it("returns only validated bytes for an exact authorized attachment", async () => {
    mocks.clientQuery
      .mockResolvedValueOnce({ rows: [downloadRow()] })
      .mockResolvedValueOnce({ rows: [] });
    const file = await loadAuthorizedAttachmentFile(
      actor,
      ids.attachment,
      capturedAt,
    );
    expect(file).toMatchObject({
      fileName: "policy.pdf",
      contentType: "application/pdf",
      visibility: "CUSTOMER",
    });
    expect(file?.bytes).toEqual(pdfBytes);
    expect(mocks.clientQuery).toHaveBeenCalledWith(
      expect.stringContaining("axora_attachment_download"),
      [ids.actor, ids.assignment, ids.attachment, capturedAt],
    );
    expect(mocks.clientQuery).toHaveBeenCalledWith(
      expect.stringContaining("axora_record_accountability_access"),
      [ids.actor, ids.assignment, "ATTACHMENT_DOWNLOAD", ids.attachment, 1],
    );

    mocks.clientQuery.mockResolvedValueOnce({
      rows: [downloadRow(Buffer.from("not a pdf"))],
    });
    await expect(loadAuthorizedAttachmentFile(
      actor,
      ids.attachment,
      capturedAt,
    )).resolves.toBeNull();

    vi.clearAllMocks();
    await expect(loadAuthorizedAttachmentFile(
      actor,
      "not-a-uuid",
      capturedAt,
    )).resolves.toBeNull();
    expect(mocks.clientQuery).not.toHaveBeenCalled();
  });

  it("validates upload bytes and invokes only the protected creation function", async () => {
    mocks.clientQuery.mockResolvedValueOnce({
      rows: [{ attachmentId: ids.attachment, visibility: "CUSTOMER" }],
    });
    const file = new File(
      [pdfBytes],
      "Safety plan (final).pdf",
      { type: "application/pdf" },
    );
    const created = await createAuthorizedAttachment(actor, {
      entityType: "request",
      recordId: ids.request,
      file,
      visibility: "INTERNAL",
    }, capturedAt);
    expect(created).toEqual({
      attachmentId: ids.attachment,
      visibility: "CUSTOMER",
    });
    expect(mocks.withAuditTransaction).toHaveBeenCalledWith(
      {
        actor,
        reason: "Uploaded document Safety_plan__final_.pdf",
      },
      expect.any(Function),
    );
    expect(mocks.clientQuery).toHaveBeenCalledWith(
      expect.stringContaining("axora_create_attachment"),
      [
        ids.actor,
        ids.assignment,
        "request",
        ids.request,
        "Safety_plan__final_.pdf",
        "application/pdf",
        pdfBytes,
        "INTERNAL",
        capturedAt,
      ],
    );

    const spoofed = new File(
      ["not a pdf"],
      "spoofed.pdf",
      { type: "application/pdf" },
    );
    await expect(createAuthorizedAttachment(actor, {
      entityType: "request",
      recordId: ids.request,
      file: spoofed,
    }, capturedAt)).rejects.toThrow("does not match");
  });

  it("uses one generic denial for malformed creation results and permissions", async () => {
    mocks.canAccess.mockReturnValueOnce(false);
    await expect(createAuthorizedAttachment(actor, {
      entityType: "request",
      recordId: ids.request,
      file: new File([pdfBytes], "policy.pdf", { type: "application/pdf" }),
    }, capturedAt)).rejects.toBeInstanceOf(DocumentAccessUnavailableError);

    mocks.canAccess.mockReturnValue(true);
    mocks.clientQuery.mockResolvedValueOnce({ rows: [] });
    await expect(createAuthorizedAttachment(actor, {
      entityType: "request",
      recordId: ids.request,
      file: new File([pdfBytes], "policy.pdf", { type: "application/pdf" }),
    }, capturedAt)).rejects.toBeInstanceOf(DocumentAccessUnavailableError);
  });

  it("reads legacy files only inside the real configured upload root", async () => {
    const root = await temporaryRoot("axora-document-root-");
    process.env.AXORA_UPLOADS_CONTAINER_DIR = root;
    await writeFile(path.join(root, "safe.pdf"), pdfBytes);
    await expect(documentIsolationInternals.readLegacyAttachment(
      "safe.pdf",
      "application/pdf",
    )).resolves.toEqual(pdfBytes);

    const outsideRoot = await temporaryRoot("axora-document-outside-");
    const outside = path.join(outsideRoot, "outside.pdf");
    await writeFile(outside, pdfBytes);
    await symlink(outside, path.join(root, "linked.pdf"));
    await expect(documentIsolationInternals.readLegacyAttachment(
      "linked.pdf",
      "application/pdf",
    )).resolves.toBeNull();
    await expect(documentIsolationInternals.readLegacyAttachment(
      "../outside.pdf",
      "application/pdf",
    )).resolves.toBeNull();
  });
});
