const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function isSafeUtf8Text(bytes: Buffer) {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(text);
  } catch {
    return false;
  }
}

/**
 * Validate bytes rather than trusting a browser-supplied MIME value. This is
 * a narrow format allowlist; it deliberately makes no malware-scanning claim.
 */
export function uploadedContentMatchesMime(contentType: string, bytes: Buffer) {
  if (!bytes.length) return false;
  if (contentType === "application/pdf") {
    return bytes.length >= 8
      && bytes.subarray(0, 5).toString("ascii") === "%PDF-"
      && bytes.subarray(Math.max(0, bytes.length - 1_024)).includes(Buffer.from("%%EOF"));
  }
  if (contentType === "image/jpeg") {
    return bytes.length >= 4
      && bytes[0] === 0xff && bytes[1] === 0xd8
      && bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9;
  }
  if (contentType === "image/png") {
    return bytes.length >= 20
      && bytes.subarray(0, 8).equals(PNG_SIGNATURE)
      && bytes.subarray(bytes.length - 8, bytes.length - 4).toString("ascii") === "IEND";
  }
  if (contentType === "image/webp") {
    return bytes.length >= 12
      && bytes.subarray(0, 4).toString("ascii") === "RIFF"
      && bytes.subarray(8, 12).toString("ascii") === "WEBP";
  }
  if (contentType === "text/plain" || contentType === "text/csv") {
    return isSafeUtf8Text(bytes);
  }
  return false;
}
