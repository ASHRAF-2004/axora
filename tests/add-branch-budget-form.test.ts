import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach,describe,expect,it,vi } from "vitest";
import type { AddBranchBudgetActionState } from "@/app/(portal)/branches/actions";
import { branchBudgetRefusalMessages } from "@/lib/branch-budget-refusal-i18n";

const mocks = vi.hoisted(() => ({ state: { status: "idle",message: "" } as AddBranchBudgetActionState,
  open: true,pending: false,amount: "500",command: "bf000000-0000-4000-8000-000000000005" }));
vi.mock("react", async (original) => ({ ...await original<typeof import("react")>(),
  useState: (initial: unknown) => [typeof initial === "boolean" ? mocks.open : typeof initial === "function" ? mocks.command : mocks.amount,vi.fn()],
  useActionState: () => [mocks.state,vi.fn(),mocks.pending],useEffect: vi.fn(),useRef: () => ({ current: null }),
}));
vi.mock("@/app/(portal)/branches/actions", () => ({ addBranchBudgetAction: vi.fn() }));
import { AddBranchBudgetForm } from "@/components/AddBranchBudgetForm";

const copy = { add: "Add budget",amount: "Amount",help: "Authorization only",cancel: "Back",adding: "Adding…",
  success: "Budget updated",invalid: "Valid positive MYR amount required",unavailable: "Unavailable" };
function render(locale: "en" | "ar" | "ms" = "en") {
  return renderToStaticMarkup(createElement(AddBranchBudgetForm,{ branchId: "bf000000-0000-4000-8000-000000000004",locale,copy }));
}

describe("Add Budget refusal presentation", () => {
  beforeEach(() => { mocks.state = { status: "idle",message: "" }; mocks.open = true; mocks.pending = false; });
  it.each(["en","ar","ms"] as const)("renders %s ceiling reason/authorized limits and preserves input with alert semantics", (locale) => {
    mocks.state = { status: "error",message: "CEILING_EXCEEDED",code: "CEILING_EXCEEDED",
      limits: { ceiling: "2000.00",allocated: "2000.00",headroom: "0.00" } };
    const html = render(locale);
    const messages = branchBudgetRefusalMessages(locale);
    expect(html).toContain(messages.CEILING_EXCEEDED);
    expect(html).toContain(messages.ceiling); expect(html).toContain(messages.headroom);
    expect(html).toContain('role="alert"'); expect(html).toContain('tabindex="-1"');
    expect(html).toContain('aria-invalid="true"'); expect(html).toContain('value="500"');
    expect(html).toContain(mocks.command); expect(html).toContain("<bdi>");
    expect(html).not.toContain("Check available company funds");
  });
  it("uses the precise invalid-amount copy without unrelated limit disclosures", () => {
    mocks.state = { status: "error",message: "INVALID",code: "INVALID" };
    expect(render()).toContain(copy.invalid);
    expect(render()).not.toContain("Company authorization limit");
  });
  it("disables the completed command to prevent accidental resubmission", () => {
    mocks.state = { status: "success",message: "BUDGET_ADDED" };
    const html = render();
    expect(html).toContain('role="status"'); expect(html).toContain(copy.success);
    expect(html).toContain('type="submit" disabled=""'); expect(html).toContain('disabled="" aria-invalid="false"');
  });
  it("renders only the new-request opener after the command form is closed", () => {
    mocks.open = false;
    mocks.state = { status: "success",message: "BUDGET_ADDED" };
    const html = render();
    expect(html).toContain(copy.add); expect(html).not.toContain("<form"); expect(html).not.toContain(copy.success);
  });
});
