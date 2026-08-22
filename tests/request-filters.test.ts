import { describe,expect,it } from "vitest";
import { catalogInternals } from "../src/lib/catalog";
import {
  hasActiveRequestFilters,
  normalizeRequestFilters,
  requestFiltersToSearchParams,
} from "../src/lib/request-filters";
import { requestReaderInternals } from "../src/lib/request-reader";

describe("permission-scoped procurement filters",() => {
  it("normalizes, bounds and round-trips search, status and pagination only",() => {
    const raw=new URLSearchParams();
    raw.set("q","  paper clips  ");
    raw.append("company","11111111-1111-4111-8111-111111111111");
    raw.append("company","not-a-uuid");
    raw.append("category","Office Supplies");
    raw.append("status","open");
    raw.set("neededFrom","2026-08-01");
    raw.set("neededTo","2026-08-31");
    raw.set("minAmount","25.50");
    raw.set("sort","amount-desc");
    raw.set("page","3");
    raw.set("pageSize","50");
    const filters=normalizeRequestFilters(raw);
    expect(filters).toMatchObject({query:"paper clips",companyIds:[],categories:[],statuses:["open"],sort:"submitted-desc",page:3,pageSize:25});
    expect(normalizeRequestFilters(requestFiltersToSearchParams(filters))).toEqual(filters);
    expect(hasActiveRequestFilters(filters)).toBe(true);
  });

  it("parameterizes search and ignores retired advanced filters",() => {
    const filters=normalizeRequestFilters(new URLSearchParams({
      q:"%' OR TRUE --",
      category:"Office Supplies",
      supplier:"22222222-2222-4222-8222-222222222222",
      submittedFrom:"2026-08-01",
      minAmount:"100",
    }));
    const spec=requestReaderInternals.buildRequestSearchSpec(filters,"Asia/Kuala_Lumpur");
    expect(filters).not.toHaveProperty("supplierIds");
    expect(spec.where).not.toContain("AT TIME ZONE");
    expect(spec.where).not.toContain("category_line.request_id=r.id");
    expect(spec.where).not.toContain("%' OR TRUE --");
    expect(spec.values).toContain("%' OR TRUE --");
    expect(requestReaderInternals.requestSearchFrom).toContain("axora_request_access_rows($1,$2,$3)");
    expect(requestReaderInternals.requestSearchFrom).toContain("axora_request_escalation_rows($1,$2,$3)");
    expect(requestReaderInternals.requestSearchFrom).not.toContain("public.request_approval_escalations");
  });

  it("rejects invalid catalogue sorts",() => {
    expect(catalogInternals.normalizeInput({sort:"DROP TABLE products" as never}).sort)
      .toBe("relevance");
  });
});
