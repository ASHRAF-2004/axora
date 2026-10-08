import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionUser } from "@/lib/auth";
import { procurementRulesMessages } from "@/lib/procurement-rules-i18n";

const mocks = vi.hoisted(() => ({ actor: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requirePagePermission: mocks.actor }));
vi.mock("@/app/(portal)/masters/actions", () => ({
  addProductImagesAction: vi.fn(),
  removeProductImageAction: vi.fn(),
  setPrimaryProductImageAction: vi.fn(),
  updateProductAction: vi.fn(),
  updateProductImageAltTextAction: vi.fn(),
}));
vi.mock("@/components/ProductActionForm", () => ({
  ProductActionForm: ({ children }: { children: ReactNode }) =>
    createElement("form", { className: "panel form-panel" }, children),
}));

import EditProductPage from "@/app/(portal)/products/[id]/edit/page";

const owner = {
  id: "demo-admin", email: "owner@axora.e2e", name: "Axora demo administrator",
  role: "PLATFORM_OWNER", accountKind: "PLATFORM", scopeType: "PLATFORM", isOwner: true,
  roleAssignmentId: "86000000-0000-4000-8000-000000000004", authVersion: 1,
} satisfies SessionUser;

async function render(actor: SessionUser) {
  mocks.actor.mockResolvedValue(actor);
  return renderToStaticMarkup(await EditProductPage({ params: Promise.resolve({ id: "pr-1" }) }));
}

describe("product editor with existing commercial history", () => {
  beforeEach(() => {
    vi.stubEnv("DEMO_MODE", "true");
    mocks.actor.mockReset();
  });

  for (const locale of ["en", "ar", "ms"] as const) {
    it(`renders actual history in a labelled keyboard-scroll region in ${locale}`, async () => {
      const html = await render({ ...owner, preferredLocale: locale });
      expect(mocks.actor).toHaveBeenCalledWith("manage_catalog");
      expect(html).toContain('class="split-layout product-editor-layout"');
      expect(html).toContain(`<h2 id="product-commercial-history-heading">${procurementRulesMessages(locale).history}</h2>`);
      expect(html).toContain('class="data-table-wrap" role="region" aria-labelledby="product-commercial-history-heading" tabindex="0"');
      expect(html).toContain('<table class="data-table">');
      expect(html).toContain("<tbody><tr>");
    });
  }

  it("retains the no-assignment history guard rather than inventing an access context", async () => {
    const html = await render({ ...owner, roleAssignmentId: undefined });
    expect(html).toContain(procurementRulesMessages("en").historyEmpty);
    expect(html).not.toContain('<table class="data-table">');
    expect(html).not.toContain('role="region"');
  });

  it("does not render confidential history for a catalog-authorized CAM", async () => {
    const html = await render({
      ...owner, id: "20222222-2222-4222-8222-222222222222", email: "cam.fixture@axora.invalid",
      role: "CLIENT_ACCOUNT_MANAGER", isOwner: false, effectivePermissions: ["view_catalog", "manage_catalog"],
    });
    expect(html).not.toContain(procurementRulesMessages("en").history);
    expect(html).not.toContain('id="product-commercial-history-heading"');
    expect(html).not.toContain('name="defaultBuyPrice"');
  });
});
