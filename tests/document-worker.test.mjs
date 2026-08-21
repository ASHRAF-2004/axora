import { mkdtemp, readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  pollDocumentJobsOnce,
  processDocumentJob,
  writeGeneratedDocument,
} from "../server-tools/document-worker.mjs";

const temporaryRoots = [];
const ids = {
  company: "11111111-1111-4111-8111-111111111111",
  request: "22222222-2222-4222-8222-222222222222",
  job: "33333333-3333-4333-8333-333333333333",
};
const pdf = Buffer.concat([
  Buffer.from("%PDF-1.7\n"),
  Buffer.alloc(256, 65),
  Buffer.from("\n%%EOF"),
]);

async function temporaryRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), "axora-document-worker-"));
  temporaryRoots.push(root);
  return root;
}

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function job(overrides = {}) {
  return {
    job_id: ids.job,
    company_id: ids.company,
    request_id: ids.request,
    document_type: "APPROVED_REQUEST",
    request_reference: "REQ-001",
    input_snapshot: { documentType: "APPROVED_REQUEST", request: { reference: "REQ-001" } },
    company_logo_content: null,
    company_logo_content_type: null,
    ...overrides,
  };
}

describe("private generated-document worker", () => {
  it("writes only validated PDFs below the immutable tenant/request/job path", async () => {
    const rootOverride = await temporaryRoot();
    const previousUmask = process.umask(0o077);
    try {
      const output = await writeGeneratedDocument({ job: job(), bytes: pdf, rootOverride });
      expect(output.relativePath).toBe(
        `generated-documents/${ids.company}/${ids.request}/${ids.job}.pdf`,
      );
      expect(output.fileName).toBe("purchase-request-REQ-001.pdf");
      expect(output.fileSize).toBe(pdf.length);
      expect((await readFile(path.join(rootOverride, ...output.relativePath.split("/")))).equals(pdf)).toBe(true);
      expect((await stat(path.join(rootOverride, ...output.relativePath.split("/")))).mode & 0o777).toBe(0o640);

      await expect(writeGeneratedDocument({
        job: job({ company_id: "../another-tenant" }),
        bytes: pdf,
        rootOverride,
      })).rejects.toThrow(/scope/i);
      await expect(writeGeneratedDocument({ job: job(), bytes: Buffer.from("not a pdf"), rootOverride }))
        .rejects.toThrow(/invalid/i);
    } finally {
      process.umask(previousUmask);
    }
  });

  it("records completion without coupling document failure to the procurement transaction", async () => {
    const complete = vi.fn();
    const fail = vi.fn();
    const result = await processDocumentJob(job(), {
      render: vi.fn().mockResolvedValue({ bytes: pdf, pageCount: 2 }),
      storeFile: vi.fn().mockResolvedValue({
        relativePath: `generated-documents/${ids.company}/${ids.request}/${ids.job}.pdf`,
        fileName: "approved-request-REQ-001.pdf",
        fileSize: pdf.length,
        checksum: "a".repeat(64),
      }),
      jobStore: { complete, fail },
    });
    expect(result).toMatchObject({ status: "COMPLETED", jobId: ids.job, pageCount: 2 });
    expect(complete).toHaveBeenCalledOnce();
    expect(fail).not.toHaveBeenCalled();
  });

  it("marks failed jobs and removes a generated file when database completion fails", async () => {
    const rootOverride = await temporaryRoot();
    const stored = await writeGeneratedDocument({ job: job(), bytes: pdf, rootOverride });
    const fail = vi.fn();
    const result = await processDocumentJob(job(), {
      rootOverride,
      render: vi.fn().mockResolvedValue({ bytes: pdf, pageCount: 1 }),
      storeFile: vi.fn().mockResolvedValue(stored),
      jobStore: {
        complete: vi.fn().mockRejectedValue(new Error("completion unavailable")),
        fail,
      },
    });
    expect(result.status).toBe("FAILED");
    expect(fail).toHaveBeenCalledOnce();
    await expect(stat(path.join(rootOverride, ...stored.relativePath.split("/")))).rejects.toThrow();
  });

  it("claims a bounded batch and processes each job once", async () => {
    const jobs = [job(), job({ job_id: "44444444-4444-4444-8444-444444444444" })];
    const claim = vi.fn()
      .mockResolvedValueOnce(jobs[0])
      .mockResolvedValueOnce(jobs[1]);
    const complete = vi.fn();
    const fail = vi.fn();
    const workerId = "55555555-5555-4555-8555-555555555555";
    const results = await pollDocumentJobsOnce({ claim, complete, fail }, {
      concurrency: 2,
      workerId,
      render: vi.fn().mockResolvedValue({ bytes: pdf, pageCount: 1 }),
      storeFile: vi.fn().mockResolvedValue({
        relativePath: `generated-documents/${ids.company}/${ids.request}/${ids.job}.pdf`,
        fileName: "approved-request-REQ-001.pdf",
        fileSize: pdf.length,
        checksum: "a".repeat(64),
      }),
    });
    expect(claim).toHaveBeenCalledTimes(2);
    expect(claim).toHaveBeenNthCalledWith(1, workerId, 180, expect.any(Date));
    expect(complete).toHaveBeenCalledTimes(2);
    expect(fail).not.toHaveBeenCalled();
    expect(results).toHaveLength(2);
  });
});
