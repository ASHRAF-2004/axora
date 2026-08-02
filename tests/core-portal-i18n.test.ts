import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { RequestPricingSummary } from "@/components/RequestPricingSummary";
import { RouteLoadingScreen } from "@/components/RouteLoadingScreen";
import { CORE_PORTAL_MESSAGES, localizedStatus } from "@/lib/core-portal-i18n";
import { REQUEST_DETAIL_MESSAGES } from "@/lib/request-detail-i18n";
import { SHOP_MESSAGES } from "@/lib/shop-i18n";
import { PRODUCT_EDITOR_MESSAGES } from "@/lib/product-editor-i18n";
import { USER_FORM_MESSAGES } from "@/lib/user-form-i18n";
import { UserCreateForm } from "@/components/UserCreateForm";

describe("core portal internationalization", () => {
  it("keeps the EN, AR and MS catalogs structurally aligned", () => {
    expect(Object.keys(CORE_PORTAL_MESSAGES)).toEqual(["en", "ar", "ms"]);
    const sections = Object.keys(CORE_PORTAL_MESSAGES.en).sort();
    expect(Object.keys(CORE_PORTAL_MESSAGES.ar).sort()).toEqual(sections);
    expect(Object.keys(CORE_PORTAL_MESSAGES.ms).sort()).toEqual(sections);

    for (const locale of ["en", "ar", "ms"] as const) {
      const copy = CORE_PORTAL_MESSAGES[locale];
      expect(Object.keys(copy.dashboard.metrics)).toEqual(Object.keys(CORE_PORTAL_MESSAGES.en.dashboard.metrics));
      expect(Object.keys(copy.dashboard.role)).toEqual(Object.keys(CORE_PORTAL_MESSAGES.en.dashboard.role));
      expect(Object.keys(copy.requestForm)).toEqual(Object.keys(CORE_PORTAL_MESSAGES.en.requestForm));
      expect(copy.requests.create).toBeTruthy();
      expect(copy.approvals.rejectionReason).toBeTruthy();
      expect(copy.branches.setBudget).toBeTruthy();
      expect(copy.products.shopTitle).toBeTruthy();
      expect(copy.users.resend).toBeTruthy();
    }
  });

  it("localizes presentation values without changing canonical workflow values", () => {
    const canonical = "Out for Delivery";
    expect(localizedStatus(canonical, "ar")).toBe("خرج للتسليم");
    expect(localizedStatus(canonical, "ms")).toBe("Dalam penghantaran");
    expect(canonical).toBe("Out for Delivery");
    expect(localizedStatus("UNRECOGNIZED_CANONICAL_VALUE", "ar")).toBe("UNRECOGNIZED_CANONICAL_VALUE");
    expect(REQUEST_DETAIL_MESSAGES.ar.workflow["delivery.completed"]).toBe("اكتمل التسليم");
    expect(Object.keys(REQUEST_DETAIL_MESSAGES.ms.workflow)).toEqual(Object.keys(REQUEST_DETAIL_MESSAGES.en.workflow));
    expect(SHOP_MESSAGES.ar.add).toBe("إضافة إلى السلة");
    expect(Object.keys(SHOP_MESSAGES.ms)).toEqual(Object.keys(SHOP_MESSAGES.en));
    expect(PRODUCT_EDITOR_MESSAGES.ar.save).toBe("حفظ تغييرات المنتج");
    expect(Object.keys(PRODUCT_EDITOR_MESSAGES.ms)).toEqual(Object.keys(PRODUCT_EDITOR_MESSAGES.en));
    expect(USER_FORM_MESSAGES.ar.roles.REQUESTER?.label).toBe("مقدم طلب شراء");
    expect(Object.keys(USER_FORM_MESSAGES.ms.roles)).toEqual(Object.keys(USER_FORM_MESSAGES.en.roles));
  });

  it("renders Arabic pricing and loading UI without English fallback copy", () => {
    const pricing = renderToStaticMarkup(createElement(RequestPricingSummary, { subtotal: 100, estimatedDeliveryFee: 10, taxRate: 0, taxAmount: 0, estimatedTotal: 110, locale: "ar" }));
    expect(pricing).toContain("المجموع الفرعي");
    expect(pricing).toContain("رسوم التسليم التقديرية");
    expect(pricing).not.toContain("Estimated delivery fee");

    const loading = renderToStaticMarkup(createElement(RouteLoadingScreen, { locale: "ar" }));
    expect(loading).toContain("جارٍ تحميل أكسورا");
    expect(loading).not.toContain("Please wait while Axora prepares");
  });

  it("renders localized user creation while preserving canonical role values", () => {
    const html = renderToStaticMarkup(createElement(UserCreateForm, {
      actorIsOwner: false,
      actorCompanyId: "10000000-0000-4000-8000-000000000001",
      branches: [],
      companies: [],
      suppliers: [],
      defaultLocale: "ar",
      roleOptions: [{ value: "REQUESTER", label: "Purchase requester", description: "Canonical fallback", category: "Company", accountKind: "COMPANY", allowedScopes: ["BRANCH"] }],
    }));
    expect(html).toContain("مقدم طلب شراء");
    expect(html).toContain("إنشاء الحساب وإرسال الدعوة");
    expect(html).toContain('value="REQUESTER"');
    expect(html).not.toContain("Canonical fallback");
  });

  it("keeps touched request and shop surfaces free of physical inline positioning", async () => {
    const { readFile } = await import("node:fs/promises");
    const files = [
      "src/components/RequestForm.tsx",
      "src/components/ProductImage.tsx",
      "src/app/(portal)/requests/[id]/page.tsx",
      "src/app/(portal)/branches/page.tsx",
      "src/app/(portal)/approvals/page.tsx",
      "src/app/(portal)/products/[id]/edit/page.tsx",
    ];
    for (const file of files) {
      const source = await readFile(file, "utf8");
      expect(source).not.toMatch(/\b(?:marginLeft|marginRight|paddingLeft|paddingRight|left|right):/);
    }
  });
});
