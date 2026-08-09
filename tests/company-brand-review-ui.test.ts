import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

async function source(path: string) {
  return readFile(new URL("../" + path, import.meta.url), "utf8");
}

describe("company brand review presentation", () => {
  it("offers safe device, language, appearance, and workflow controls", async () => {
    const [preview, page] = await Promise.all([
      source("src/components/CompanyBrandPreview.tsx"),
      source("src/app/(portal)/companies/[companyId]/theme/page.tsx"),
    ]);
    expect(preview).toMatch(/desktop[\s\S]+tablet[\s\S]+mobile/);
    expect(preview).toMatch(/previewLocale[\s\S]+dir=/);
    expect(preview).toMatch(/pageConfiguration\.components/);
    expect(page).toMatch(/APPROVE[\s\S]+PUBLISH[\s\S]+REJECT/);
    expect(page).toMatch(/rollbackCompanyBrandThemeAction/);
    expect(preview + page).not.toMatch(/dangerouslySetInnerHTML|eval\(/);
  });

  it("uses logical responsive CSS and honors reduced motion", async () => {
    const [previewCss, pageCss] = await Promise.all([
      source("src/components/CompanyBrandPreview.module.css"),
      source("src/app/(portal)/companies/[companyId]/theme/ThemeReview.module.css"),
    ]);
    expect(previewCss + pageCss).toMatch(/inline-size/);
    expect(previewCss + pageCss).toMatch(/inset-inline-start/);
    expect(previewCss + pageCss).toMatch(/prefers-reduced-motion/);
    expect(previewCss + pageCss).toMatch(/max-width: 720px|max-width: 840px/);
  });
});
