import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("production ingress upload limits", () => {
  it("permits validated driver evidence without widening ordinary request bodies", async () => {
    const caddy = await readFile(
      new URL("../caddy/Caddyfile.production", import.meta.url),
      "utf8",
    );

    expect(caddy).toMatch(
      /@driver_evidence_upload path \/api\/driver\/evidence\s+request_body @driver_evidence_upload \{\s+# [^\n]+\s+max_size 6MB\s+\}/,
    );
    expect(caddy).toMatch(
      /@standard_body not path [^\n]*\/api\/driver\/evidence/,
    );
    expect(caddy).toMatch(/request_body @standard_body \{\s+max_size 4MB\s+\}/);
  });
});
