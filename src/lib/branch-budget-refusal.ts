import { safeParseMoneyDecimal } from "@/lib/money-decimal";

export type BranchBudgetRefusalCode = "INVALID" | "FORBIDDEN" | "UNAVAILABLE"
  | "CEILING_EXCEEDED" | "BUDGET_UNAVAILABLE" | "COMMAND_MISMATCH";
export type BranchBudgetLimits = { ceiling: string; allocated: string; headroom: string };

/** Accept only this capability's public reason contract, never arbitrary SQL text. */
export function branchBudgetRefusal(error: unknown): { code: BranchBudgetRefusalCode; limits?: BranchBudgetLimits } {
  if (!error || typeof error !== "object" || !("code" in error)) return { code: "UNAVAILABLE" };
  const code = error.code;
  if (code === "AX001") return { code: "INVALID" };
  if (code === "AX002") return { code: "FORBIDDEN" };
  if (code === "AX003") return { code: "BUDGET_UNAVAILABLE" };
  if (code === "AX005") return { code: "COMMAND_MISMATCH" };
  if (code !== "AX004") return { code: "UNAVAILABLE" };
  // Only an authorized ceiling refusal supplies these numeric values. Invalid
  // or unexpected DETAIL is omitted rather than rendered/logged as SQL text.
  if (!("detail" in error) || typeof error.detail !== "string" || error.detail.length > 300) {
    return { code: "CEILING_EXCEEDED" };
  }
  try {
    const details = JSON.parse(error.detail) as Record<string,unknown>;
    const ceiling = safeParseMoneyDecimal(details.ceiling);
    const allocated = safeParseMoneyDecimal(details.allocated);
    const headroom = safeParseMoneyDecimal(details.headroom);
    return ceiling.success && allocated.success && headroom.success
      ? { code: "CEILING_EXCEEDED",limits: { ceiling: ceiling.value,allocated: allocated.value,headroom: headroom.value } }
      : { code: "CEILING_EXCEEDED" };
  } catch { return { code: "CEILING_EXCEEDED" }; }
}
