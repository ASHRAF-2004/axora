import { describe, expect, it } from "vitest";
import { getDemoStore } from "@/lib/demo-data";

describe("sanitized in-memory demonstration data", () => {
  const store = getDemoStore();

  it("contains the planned master-data and request counts", () => {
    expect(store.companies).toHaveLength(3);
    expect(store.branches).toHaveLength(3);
    expect(store.suppliers).toHaveLength(10);
    expect(store.products).toHaveLength(25);
    expect(store.requests).toHaveLength(15);
    expect(store.requests.flatMap((request) => request.lines)).toHaveLength(17);
  });

  it("contains five controlled request scenarios for each pilot company", () => {
    const counts = store.requests.reduce<Record<string, number>>((result, request) => {
      result[request.companyName] = (result[request.companyName] ?? 0) + 1;
      return result;
    }, {});

    expect(counts).toEqual({ YourUni: 5, "Excel Language Centre": 5, Unibax: 5 });
  });

  it("keeps exactly one intentional product duplicate under review", () => {
    const names = new Map<string, number>();
    for (const product of store.products) {
      const normalized = product.name.trim().toLocaleLowerCase("en");
      names.set(normalized, (names.get(normalized) ?? 0) + 1);
    }

    expect([...names.entries()].filter(([, count]) => count > 1)).toEqual([["highlighters 4s", 2]]);
    expect(store.products.filter((product) => product.status === "Needs Review")).toHaveLength(1);
    expect(store.products.filter((product) => product.duplicateWarning)).toHaveLength(1);
  });

  it("uses reserved example domains and non-production contact numbers", () => {
    const emails = [
      ...store.companies.flatMap((company) => [company.mainContactEmail, company.billingContactEmail]),
      ...store.branches.map((branch) => branch.contactEmail),
      ...store.suppliers.map((supplier) => supplier.email),
    ];
    const phones = [
      ...store.companies.flatMap((company) => [company.mainContactPhone, company.billingContactPhone]),
      ...store.branches.map((branch) => branch.contactPhone),
      ...store.suppliers.map((supplier) => supplier.phone),
      ...store.requests.map((request) => request.requesterContact),
    ];

    expect(emails.every((email) => email.endsWith(".example"))).toBe(true);
    expect(phones.every((phone) => phone.includes("-000-"))).toBe(true);
  });

  it("uses unique order and request-line codes", () => {
    const orderCodes = store.requests.map((request) => request.orderCode);
    const lineCodes = store.requests.flatMap((request) => request.lines.map((line) => line.code));

    expect(new Set(orderCodes).size).toBe(orderCodes.length);
    expect(new Set(lineCodes).size).toBe(lineCodes.length);
  });
});
