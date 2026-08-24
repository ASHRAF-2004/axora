import { z } from "zod";

const mutationOperations = new Set(["ADD", "SET", "REMOVE", "ACKNOWLEDGE_PRICES"]);

export const procurementCartCommandSchema = z.strictObject({
  branchId: z.string().trim().min(1).max(160),
  operation: z.enum(["READ", "ADD", "SET", "REMOVE", "ACKNOWLEDGE_PRICES"]),
  productRef: z.string().trim().min(1).max(160).optional(),
  quantity: z.number().int().min(1).max(1_000_000).optional(),
  specification: z.string().trim().max(1_000).optional(),
  expectedVersion: z.number().int().positive().optional(),
  commandId: z.string().uuid().optional(),
}).superRefine((command, context) => {
  if ((command.operation === "ADD" || command.operation === "SET")
    && (command.productRef === undefined || command.quantity === undefined)) {
    context.addIssue({ code: "custom", message: "A product and valid quantity are required." });
  }
  if (command.operation === "REMOVE" && command.productRef === undefined) {
    context.addIssue({ code: "custom", message: "A product is required." });
  }
  if (mutationOperations.has(command.operation)
    && (command.expectedVersion === undefined || command.commandId === undefined)) {
    context.addIssue({ code: "custom", message: "A versioned command is required." });
  }
});

export type ProcurementCartCommand = z.infer<typeof procurementCartCommandSchema>;

export type ProcurementCartCommandCode =
  | "AUTH_REQUIRED"
  | "CART_FORBIDDEN"
  | "INVALID_COMMAND"
  | "INVALID_QUANTITY"
  | "REPRICED"
  | "STALE_CART"
  | "PRODUCT_NOT_ALLOWED"
  | "EMPTY_CART"
  | "CART_UNAVAILABLE";

export function procurementCartErrorCode(error: unknown): ProcurementCartCommandCode {
  if (error instanceof z.ZodError) {
    return error.issues.some((issue) => issue.path.includes("quantity"))
      ? "INVALID_QUANTITY" : "INVALID_COMMAND";
  }
  const code = error && typeof error === "object" && "code" in error
    ? String(error.code) : "";
  if (code === "P8202") return "REPRICED";
  if (code === "P8203") return "STALE_CART";
  if (code === "P8204") return "PRODUCT_NOT_ALLOWED";
  if (code === "P8205") return "EMPTY_CART";
  if (code === "23514") return "INVALID_QUANTITY";
  return "CART_UNAVAILABLE";
}
