import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { findUnexpectedRetiredProviderReferences } from "./helpers/retired-provider-search.mjs";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));

describe("retired outbound provider repository gate", () => {
  it("allows the retired provider token only in immutable migration/forward-compatibility evidence", () => {
    expect(findUnexpectedRetiredProviderReferences(repositoryRoot)).toEqual([]);
  });
});
