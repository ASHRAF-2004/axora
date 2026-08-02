import { describe, expect, it } from "vitest";
import { uploadedContentMatchesMime } from "@/lib/file-content";

describe("uploaded file content validation", () => {
  it("accepts bounded signatures and safe UTF-8 text", () => {
    expect(uploadedContentMatchesMime("application/pdf", Buffer.from("%PDF-1.7\nbody\n%%EOF\n"))).toBe(true);
    expect(uploadedContentMatchesMime("image/jpeg", Buffer.from([0xff, 0xd8, 0xff, 0xd9]))).toBe(true);
    expect(uploadedContentMatchesMime("image/png", Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      Buffer.from("00000000IEND00000000"),
    ]))).toBe(true);
    expect(uploadedContentMatchesMime("text/csv", Buffer.from("item,quantity\nPaper,2\n"))).toBe(true);
  });

  it("rejects extension or MIME disguises, truncated files, and unsafe text", () => {
    expect(uploadedContentMatchesMime("application/pdf", Buffer.from("not a pdf"))).toBe(false);
    expect(uploadedContentMatchesMime("image/jpeg", Buffer.from([0xff, 0xd8, 0x00, 0x00]))).toBe(false);
    expect(uploadedContentMatchesMime("image/png", Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))).toBe(false);
    expect(uploadedContentMatchesMime("text/plain", Buffer.from([0x61, 0x00, 0x62]))).toBe(false);
    expect(uploadedContentMatchesMime("application/octet-stream", Buffer.from("data"))).toBe(false);
  });
});
