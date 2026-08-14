import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

describe("customer catalogue identifier isolation", () => {
  it("does not expose an internal product identifier in the customer contract", () => {
    const source = read("src/lib/catalog-contracts.ts");
    const start = source.indexOf("export interface CustomerCatalogProduct");
    const contract = source.slice(start, source.indexOf("}\n", start));
    expect(contract).toContain("publicRef: string");
    expect(contract).not.toMatch(/\n\s*(id|code|supplierId|defaultBuyCost|markup|margin):/);
  });

  it("keeps UUID image routes internal while customer routes use public references", () => {
    for (const file of [
      "src/app/api/products/[id]/image/route.ts",
      "src/app/api/products/[id]/images/route.ts",
      "src/app/api/products/[id]/images/[imageId]/route.ts",
    ]) {
      const source = read(file);
      expect(source).toContain('actor.accountKind !== "PLATFORM"');
    }
    for (const file of [
      "src/app/api/catalog/products/[publicRef]/image/route.ts",
      "src/app/api/catalog/products/[publicRef]/images/route.ts",
      "src/app/api/catalog/products/[publicRef]/images/[imageId]/route.ts",
    ]) {
      expect(fs.existsSync(path.join(root, file)), file).toBe(true);
    }
  });
});
