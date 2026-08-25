import { randomUUID } from "node:crypto";
import type { QueryResultRow } from "pg";
import { z } from "zod";

import type { AuthenticatedSessionUser } from "./auth";
import { companyWalletInternals } from "./company-wallet";
import { getDemoStore } from "./demo-data";
import { isDemoMode, query, withAuditTransaction } from "./db";
import {
  moneyDecimalFromMinorUnits,
  moneyDecimalToMinorUnits,
  parseMoneyDecimal,
  safeParseMoneyDecimal,
  type MoneyDecimalString,
} from "./money-decimal";
import { canAccess } from "./permissions";
import {
  commandProcurementCart,
  consumeDemoProcurementCart,
  readDemoProcurementCartById,
  type ProcurementCartSnapshot,
} from "./procurement-cart";
import { withDemoCommercialDefaults } from "./procurement-rules";
import type { ProcurementRequest } from "./types";

const uuid = z.string().uuid();
const optionalText = z.preprocess(
  (value) => value === null || value === "" ? undefined : value,
  z.string().optional(),
);
const money = z.string().transform((value, context): MoneyDecimalString => {
  const parsed = safeParseMoneyDecimal(value, { allowNegative: false });
  if (!parsed.success) {
    context.addIssue({ code: "custom", message: parsed.error });
    return z.NEVER;
  }
  return parsed.value;
});
const positiveMoney = z.string().transform((value, context): MoneyDecimalString => {
  const parsed = safeParseMoneyDecimal(value, {
    allowNegative: false,
    allowZero: false,
  });
  if (!parsed.success) {
    context.addIssue({ code: "custom", message: parsed.error });
    return z.NEVER;
  }
  return parsed.value;
});

const cartItemSchema = z.object({
  publicRef: z.string().min(1),
  name: z.string().min(1),
  category: z.string().min(1),
  subcategory: z.string(),
  brand: optionalText,
  size: optionalText,
  unit: z.string().min(1),
  description: optionalText,
  unitPrice: z.string(),
  displayedUnitPrice: z.string(),
  priceRuleVersion: z.number().int().nonnegative(),
  displayedPriceRuleVersion: z.number().int().nonnegative(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  deliverySlaDays: z.number().int().nonnegative(),
  hasImage: z.boolean(),
  imageAltText: optionalText,
  quantity: z.number().int().min(1).max(1_000_000),
  specification: z.string(),
  available: z.boolean(),
  categoryAllowed: z.boolean(),
  repriced: z.boolean(),
  lineTotal: z.string(),
}).transform((item) => item as ProcurementCartSnapshot["items"][number]);

const cartSchema = z.object({
  id: z.string().min(1),
  companyId: z.string().min(1),
  branchId: z.string().min(1),
  departmentId: optionalText,
  version: z.number().int().positive(),
  status: z.enum(["ACTIVE", "SUBMITTED", "ABANDONED"]),
  items: z.array(cartItemSchema),
  updatedAt: z.string(),
}).transform((cart) => cart as ProcurementCartSnapshot);

const workspaceSchema = z.object({
  capturedAt: z.coerce.date(),
  companyId: z.string().min(1),
  branchId: z.string().min(1),
  branchCode: z.string().min(1),
  branchName: z.string().min(1),
  cartId: z.string().min(1),
  cartVersion: z.number().int().positive(),
  cart: cartSchema,
  subtotal: money,
  deliveryFee: money,
  taxAmount: money,
  orderTotal: money,
  currency: z.string().regex(/^[A-Z]{3}$/),
  budgetAvailable: money,
  walletAvailable: money,
  budgetReady: z.boolean(),
  locationReady: z.boolean(),
  priceChanged: z.boolean(),
});

const commonResult = {
  commandId: uuid,
  cartId: z.string().min(1),
  created: z.boolean(),
};
const purchaseReceiptFields = {
  consumedCartVersion: z.number().int().positive(),
  requestId: z.string().min(1),
  orderReference: z.string().min(1),
  invoiceId: z.string().min(1),
  invoiceNumber: z.string().min(1),
  paymentId: z.string().min(1),
  deliveryJobId: z.string().min(1),
  deliveryStatus: z.literal("AWAITING_ASSIGNMENT"),
  branchId: z.string().min(1),
  branchCode: z.string().min(1),
  branchName: z.string().min(1),
  amount: positiveMoney,
  currency: z.string().regex(/^[A-Z]{3}$/),
  correlationId: z.string().min(1),
};
const successResultSchema = z.object({
  ...commonResult,
  ...purchaseReceiptFields,
  status: z.enum(["SUCCESS", "ALREADY_PROCESSED"]),
});
const alreadyPurchasedSchema = z.object({
  ...commonResult,
  ...purchaseReceiptFields,
  status: z.literal("CART_ALREADY_PURCHASED"),
});
const staleSchema = z.object({
  ...commonResult,
  status: z.literal("STALE_CART"),
  expectedCartVersion: z.number().int().positive(),
  currentCartVersion: z.number().int().positive(),
  cart: cartSchema.optional(),
});
const priceChangedSchema = z.object({
  ...commonResult,
  status: z.literal("PRICE_CHANGED"),
  expectedCartVersion: z.number().int().positive(),
  currentCartVersion: z.number().int().positive(),
  cart: cartSchema,
});
const insufficientSchema = z.object({
  ...commonResult,
  status: z.enum(["INSUFFICIENT_BUDGET", "INSUFFICIENT_WALLET"]),
  requiredAmount: positiveMoney,
  availableAmount: money,
  currency: z.string().regex(/^[A-Z]{3}$/),
});
const simpleFailureSchema = z.object({
  ...commonResult,
  status: z.enum([
    "BRANCH_LOCATION_REQUIRED",
    "PRODUCT_UNAVAILABLE",
    "BUDGET_UNAVAILABLE",
  ]),
  branchId: z.string().optional(),
  currency: z.string().optional(),
});
const directPurchaseResultSchema = z.discriminatedUnion("status", [
  successResultSchema,
  alreadyPurchasedSchema,
  staleSchema,
  priceChangedSchema,
  insufficientSchema,
  simpleFailureSchema,
]);
const reconciliationSchema = z.union([
  directPurchaseResultSchema,
  z.object({ status: z.literal("NOT_FOUND"), commandId: uuid }),
]);

export const directPurchaseCommandSchema = z.object({
  cartId: z.string().trim().min(1).max(160),
  expectedCartVersion: z.number().int().positive(),
  commandId: uuid,
}).strict();

interface PayloadRow extends QueryResultRow { payload: unknown }

export type CompanyAdminDirectPurchaseWorkspace = z.infer<typeof workspaceSchema>;
export type CompanyAdminDirectPurchaseResult = z.infer<typeof directPurchaseResultSchema>;
export type CompanyAdminDirectPurchaseReconciliation = z.infer<typeof reconciliationSchema>;
export type CompanyAdminDirectPurchaseCommand = z.infer<typeof directPurchaseCommandSchema>;

export class CompanyAdminDirectPurchaseUnavailableError extends Error {
  constructor() {
    super("The direct purchase is unavailable.");
    this.name = "CompanyAdminDirectPurchaseUnavailableError";
  }
}

function assignmentId(actor: AuthenticatedSessionUser) {
  const parsed = uuid.safeParse(actor.roleAssignmentId);
  if (!parsed.success) throw new CompanyAdminDirectPurchaseUnavailableError();
  return parsed.data;
}

export function usesCompanyAdministratorDirectPurchase(
  actor: AuthenticatedSessionUser,
) {
  return actor.role === "COMPANY_ADMIN"
    && actor.accountKind === "COMPANY"
    && actor.scopeType === "COMPANY"
    && Boolean(actor.companyId)
    && !actor.isOwner;
}

function isExactCompanyAdministrator(actor: AuthenticatedSessionUser) {
  return usesCompanyAdministratorDirectPurchase(actor)
    && canAccess(actor, "direct_purchase");
}

export function canPlaceCompanyAdminDirectPurchase(
  actor: AuthenticatedSessionUser,
) {
  return isExactCompanyAdministrator(actor);
}

function requireExactCompanyAdministrator(actor: AuthenticatedSessionUser) {
  if (!isExactCompanyAdministrator(actor)) {
    throw new CompanyAdminDirectPurchaseUnavailableError();
  }
}

function productionUuid(value: string) {
  const parsed = uuid.safeParse(value);
  if (!parsed.success) throw new CompanyAdminDirectPurchaseUnavailableError();
  return parsed.data;
}

function addMoney(...values: MoneyDecimalString[]) {
  return moneyDecimalFromMinorUnits(values.reduce(
    (total, value) => total + moneyDecimalToMinorUnits(value),
    0n,
  ));
}

function percentageOfMoney(value: MoneyDecimalString, percentage: number) {
  const canonicalPercentage = percentage.toFixed(2);
  const [whole = "0", fraction = "00"] = canonicalPercentage.split(".");
  const percentageHundredths = BigInt(whole) * 100n + BigInt(fraction);
  const numerator = moneyDecimalToMinorUnits(value) * percentageHundredths;
  return moneyDecimalFromMinorUnits((numerator + 5_000n) / 10_000n);
}

function demoCurrentCart(cart: ProcurementCartSnapshot) {
  const current = structuredClone(cart);
  for (const item of current.items) {
    const source = getDemoStore().products.find((product) => (
      `demo-${product.name.normalize("NFKD").toLowerCase()
        .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64)}`
        === item.publicRef
    ));
    if (!source || source.status !== "Active") {
      item.available = false;
      continue;
    }
    const product = withDemoCommercialDefaults(source);
    const currentPrice = parseMoneyDecimal(product.defaultSellPrice.toFixed(2));
    const currentVersion = product.priceRuleVersion ?? 1;
    item.unitPrice = currentPrice;
    item.priceRuleVersion = currentVersion;
    item.currency = product.priceCurrency ?? "MYR";
    item.lineTotal = moneyDecimalFromMinorUnits(
      moneyDecimalToMinorUnits(currentPrice) * BigInt(item.quantity),
    );
    item.repriced = item.displayedUnitPrice !== currentPrice
      || item.displayedPriceRuleVersion !== currentVersion;
  }
  return current;
}

function demoWorkspace(
  actor: AuthenticatedSessionUser,
  cartId: string,
  expectedCartVersion: number,
): CompanyAdminDirectPurchaseWorkspace {
  requireExactCompanyAdministrator(actor);
  const rawCart = readDemoProcurementCartById(actor, cartId);
  if (rawCart.status !== "ACTIVE" || rawCart.version !== expectedCartVersion
    || rawCart.departmentId || rawCart.companyId !== actor.companyId) {
    throw new CompanyAdminDirectPurchaseUnavailableError();
  }
  const cart = demoCurrentCart(rawCart);
  const company = getDemoStore().companies.find((item) => item.id === cart.companyId);
  const branch = getDemoStore().branches.find((item) => (
    item.id === cart.branchId && item.companyId === cart.companyId
  ));
  if (!company || company.status !== "Active" || !branch || branch.status !== "Active") {
    throw new CompanyAdminDirectPurchaseUnavailableError();
  }
  const subtotal = moneyDecimalFromMinorUnits(cart.items.reduce(
    (total, item) => total + moneyDecimalToMinorUnits(parseMoneyDecimal(item.lineTotal)),
    0n,
  ));
  const deliveryFee = parseMoneyDecimal((company.estimatedDeliveryFee ?? 0).toFixed(2));
  const taxAmount = percentageOfMoney(subtotal, company.taxRate ?? 0);
  const orderTotal = addMoney(subtotal, deliveryFee, taxAmount);
  return workspaceSchema.parse({
    capturedAt: new Date(),
    companyId: cart.companyId,
    branchId: branch.id,
    branchCode: branch.branchCode,
    branchName: branch.name,
    cartId: cart.id,
    cartVersion: cart.version,
    cart,
    subtotal,
    deliveryFee,
    taxAmount,
    orderTotal,
    currency: "MYR",
    budgetAvailable: parseMoneyDecimal((branch.remainingAmount ?? 0).toFixed(2)),
    walletAvailable: companyWalletInternals.demoBalance(company.id),
    budgetReady: branch.monthlyBudget !== null && branch.monthlyBudget !== undefined,
    locationReady: branch.deliveryAddress.trim().length >= 3,
    priceChanged: cart.items.some((item) => item.repriced),
  });
}

type DemoCommand = {
  actorUserId: string;
  fingerprint: string;
  result: CompanyAdminDirectPurchaseResult;
};
type DemoDirectPurchaseState = {
  version: 1;
  commands: Map<string, DemoCommand>;
  purchaseByCart: Map<string, CompanyAdminDirectPurchaseResult>;
};

declare global {
  var __axoraDemoDirectPurchases: DemoDirectPurchaseState | undefined;
}

function demoState() {
  global.__axoraDemoDirectPurchases ??= {
    version: 1,
    commands: new Map(),
    purchaseByCart: new Map(),
  };
  return global.__axoraDemoDirectPurchases;
}

function demoFingerprint(actor: AuthenticatedSessionUser, input: CompanyAdminDirectPurchaseCommand) {
  return JSON.stringify([
    "COMPANY_ADMIN_DIRECT_PURCHASE",
    actor.id,
    actor.roleAssignmentId ?? null,
    input.cartId,
    input.expectedCartVersion,
  ]);
}

async function demoPlaceDirectPurchase(
  actor: AuthenticatedSessionUser,
  input: CompanyAdminDirectPurchaseCommand,
): Promise<CompanyAdminDirectPurchaseResult> {
  requireExactCompanyAdministrator(actor);
  const state = demoState();
  const fingerprint = demoFingerprint(actor, input);
  const existing = state.commands.get(input.commandId);
  if (existing) {
    if (existing.actorUserId !== actor.id || existing.fingerprint !== fingerprint) {
      throw new CompanyAdminDirectPurchaseUnavailableError();
    }
    return existing.result.status === "SUCCESS"
      ? directPurchaseResultSchema.parse({
          ...existing.result,
          status: "ALREADY_PROCESSED",
          created: false,
        })
      : existing.result;
  }
  const rawCart = readDemoProcurementCartById(actor, input.cartId);
  if (rawCart.status === "SUBMITTED") {
    const purchase = state.purchaseByCart.get(rawCart.id);
    if (purchase?.status === "SUCCESS") {
      const result = directPurchaseResultSchema.parse({
        ...purchase,
        status: "CART_ALREADY_PURCHASED",
        commandId: input.commandId,
        created: false,
      });
      state.commands.set(input.commandId, { actorUserId: actor.id, fingerprint, result });
      return result;
    }
  }
  if (rawCart.status !== "ACTIVE" || rawCart.version !== input.expectedCartVersion) {
    const result = directPurchaseResultSchema.parse({
      status: "STALE_CART",
      commandId: input.commandId,
      cartId: rawCart.id,
      expectedCartVersion: input.expectedCartVersion,
      currentCartVersion: rawCart.version,
      cart: rawCart,
      created: false,
    });
    state.commands.set(input.commandId, { actorUserId: actor.id, fingerprint, result });
    return result;
  }
  const workspace = demoWorkspace(actor, input.cartId, input.expectedCartVersion);
  if (!workspace.cart.items.length) {
    const result = directPurchaseResultSchema.parse({
      status: "STALE_CART",
      commandId: input.commandId,
      cartId: rawCart.id,
      expectedCartVersion: input.expectedCartVersion,
      currentCartVersion: rawCart.version,
      cart: rawCart,
      created: false,
    });
    state.commands.set(input.commandId, { actorUserId: actor.id, fingerprint, result });
    return result;
  }
  if (workspace.cart.items.some((item) => !item.available || !item.categoryAllowed)) {
    const result = directPurchaseResultSchema.parse({
      status: "PRODUCT_UNAVAILABLE",
      commandId: input.commandId,
      cartId: rawCart.id,
      created: false,
    });
    state.commands.set(input.commandId, { actorUserId: actor.id, fingerprint, result });
    return result;
  }
  if (workspace.priceChanged) {
    const cart = await commandProcurementCart(actor, {
      branchId: rawCart.branchId,
      operation: "ACKNOWLEDGE_PRICES",
      expectedVersion: rawCart.version,
      commandId: input.commandId,
    });
    const result = directPurchaseResultSchema.parse({
      status: "PRICE_CHANGED",
      commandId: input.commandId,
      cartId: cart.id,
      expectedCartVersion: input.expectedCartVersion,
      currentCartVersion: cart.version,
      cart,
      created: false,
    });
    state.commands.set(input.commandId, { actorUserId: actor.id, fingerprint, result });
    return result;
  }
  if (!workspace.locationReady) {
    const result = directPurchaseResultSchema.parse({
      status: "BRANCH_LOCATION_REQUIRED",
      commandId: input.commandId,
      cartId: rawCart.id,
      branchId: rawCart.branchId,
      created: false,
    });
    state.commands.set(input.commandId, { actorUserId: actor.id, fingerprint, result });
    return result;
  }
  if (!workspace.budgetReady) {
    const result = directPurchaseResultSchema.parse({
      status: "BUDGET_UNAVAILABLE",
      commandId: input.commandId,
      cartId: rawCart.id,
      currency: workspace.currency,
      created: false,
    });
    state.commands.set(input.commandId, { actorUserId: actor.id, fingerprint, result });
    return result;
  }
  if (moneyDecimalToMinorUnits(workspace.budgetAvailable)
    < moneyDecimalToMinorUnits(workspace.orderTotal)) {
    const result = directPurchaseResultSchema.parse({
      status: "INSUFFICIENT_BUDGET",
      commandId: input.commandId,
      cartId: rawCart.id,
      requiredAmount: workspace.orderTotal,
      availableAmount: workspace.budgetAvailable,
      currency: workspace.currency,
      created: false,
    });
    state.commands.set(input.commandId, { actorUserId: actor.id, fingerprint, result });
    return result;
  }
  if (moneyDecimalToMinorUnits(workspace.walletAvailable)
    < moneyDecimalToMinorUnits(workspace.orderTotal)) {
    const result = directPurchaseResultSchema.parse({
      status: "INSUFFICIENT_WALLET",
      commandId: input.commandId,
      cartId: rawCart.id,
      requiredAmount: workspace.orderTotal,
      availableAmount: workspace.walletAvailable,
      currency: workspace.currency,
      created: false,
    });
    state.commands.set(input.commandId, { actorUserId: actor.id, fingerprint, result });
    return result;
  }

  const store = getDemoStore();
  const company = store.companies.find((item) => item.id === rawCart.companyId)!;
  const branch = store.branches.find((item) => item.id === rawCart.branchId)!;
  const requestId = randomUUID();
  const invoiceId = randomUUID();
  const paymentId = randomUUID();
  const deliveryJobId = randomUUID();
  const orderReference = `ORD-DEMO-${requestId.slice(0, 8).toUpperCase()}`;
  const invoiceNumber = `AX-INV-DEMO-${invoiceId.slice(0, 8).toUpperCase()}`;
  const request: ProcurementRequest = {
    id: requestId,
    purchaseMode: "COMPANY_ADMIN_DIRECT",
    orderCode: orderReference,
    requestDate: new Date().toISOString().slice(0, 10),
    requestType: "Standard",
    companyId: company.id,
    companyName: company.name,
    branchId: branch.id,
    branchName: branch.name,
    department: "",
    requestedBy: actor.name,
    requesterContact: actor.email,
    neededByDate: new Date().toISOString().slice(0, 10),
    urgency: "Normal",
    status: "New Request",
    createdById: actor.id,
    approvalStatus: "Approved",
    approvalRevision: 2,
    subtotal: Number(workspace.subtotal),
    estimatedDeliveryFee: Number(workspace.deliveryFee),
    taxRate: company.taxRate,
    taxAmount: Number(workspace.taxAmount),
    estimatedTotal: Number(workspace.orderTotal),
    invoiceStatus: "Issued",
    paymentStatus: "Paid",
    invoiceNumber,
    lines: workspace.cart.items.map((item) => {
      const source = store.products.find((product) => (
        `demo-${product.name.normalize("NFKD").toLowerCase()
          .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64)}`
          === item.publicRef
      ))!;
      return {
        id: randomUUID(),
        code: `REQ-DEMO-${randomUUID().slice(0, 8).toUpperCase()}`,
        productId: source.id,
        productCode: source.code,
        productName: item.name,
        category: item.category,
        subcategory: item.subcategory,
        specification: item.specification || undefined,
        quantity: item.quantity,
        unit: item.unit,
        supplierConfirmationStatus: "Pending",
        unitBuyPrice: source.defaultBuyPrice,
        unitSellPrice: Number(item.unitPrice),
        deliveryCharge: 0,
        deliveryStatus: "Not Scheduled",
        quantityReceived: 0,
      };
    }),
  };
  const result = directPurchaseResultSchema.parse({
    status: "SUCCESS",
    commandId: input.commandId,
    cartId: rawCart.id,
    consumedCartVersion: rawCart.version + 1,
    requestId,
    orderReference,
    invoiceId,
    invoiceNumber,
    paymentId,
    deliveryJobId,
    deliveryStatus: "AWAITING_ASSIGNMENT",
    branchId: branch.id,
    branchCode: branch.branchCode,
    branchName: branch.name,
    amount: workspace.orderTotal,
    currency: workspace.currency,
    created: true,
    correlationId: randomUUID(),
  });

  // All validation is complete before these synchronous in-memory mutations.
  // No await boundary exists inside this commit section.
  companyWalletInternals.commitDemoDirectPurchaseDebit({
    companyId: company.id,
    amount: workspace.orderTotal,
    commandId: input.commandId,
    requestId,
    invoiceId,
    reference: invoiceNumber,
    actor,
  });
  branch.remainingAmount = Number(moneyDecimalFromMinorUnits(
    moneyDecimalToMinorUnits(workspace.budgetAvailable)
      - moneyDecimalToMinorUnits(workspace.orderTotal),
  ));
  branch.committedAmount = Number(moneyDecimalFromMinorUnits(
    moneyDecimalToMinorUnits(parseMoneyDecimal(branch.committedAmount.toFixed(2)))
      + moneyDecimalToMinorUnits(workspace.orderTotal),
  ));
  consumeDemoProcurementCart(actor, {
    cartId: rawCart.id,
    expectedVersion: rawCart.version,
    requestId,
  });
  store.requests.unshift(request);
  state.commands.set(input.commandId, { actorUserId: actor.id, fingerprint, result });
  state.purchaseByCart.set(rawCart.id, result);
  return result;
}

export async function getCompanyAdminDirectPurchaseWorkspace(
  actor: AuthenticatedSessionUser,
  cart: Pick<ProcurementCartSnapshot, "id" | "version">,
): Promise<CompanyAdminDirectPurchaseWorkspace> {
  requireExactCompanyAdministrator(actor);
  if (isDemoMode()) return demoWorkspace(actor, cart.id, cart.version);
  try {
    const result = await query<PayloadRow>(
      `SELECT public.axora_company_admin_direct_purchase_workspace(
         $1,$2,$3,$4,now()
       ) AS payload`,
      [actor.id, assignmentId(actor), productionUuid(cart.id), cart.version],
    );
    const parsed = workspaceSchema.safeParse(result.rows[0]?.payload);
    if (!parsed.success) throw new CompanyAdminDirectPurchaseUnavailableError();
    return parsed.data;
  } catch (error) {
    if (error instanceof CompanyAdminDirectPurchaseUnavailableError) throw error;
    throw new CompanyAdminDirectPurchaseUnavailableError();
  }
}

export async function placeCompanyAdminDirectPurchase(
  actor: AuthenticatedSessionUser,
  value: CompanyAdminDirectPurchaseCommand,
): Promise<CompanyAdminDirectPurchaseResult> {
  requireExactCompanyAdministrator(actor);
  const input = directPurchaseCommandSchema.parse(value);
  if (isDemoMode()) return demoPlaceDirectPurchase(actor, input);
  try {
    return await withAuditTransaction({
      actor,
      reason: "COMPANY_ADMIN_DIRECT_PURCHASE",
      reasonCode: "procurement.direct_purchase",
      commandId: input.commandId,
    }, async (client) => {
      const result = await client.query<PayloadRow>(
        `SELECT public.axora_company_admin_direct_purchase(
           $1,$2,$3,$4,$5,now()
         ) AS payload`,
        [actor.id, assignmentId(actor), productionUuid(input.cartId),
          input.expectedCartVersion, input.commandId],
      );
      const parsed = directPurchaseResultSchema.safeParse(result.rows[0]?.payload);
      if (!parsed.success) throw new CompanyAdminDirectPurchaseUnavailableError();
      return parsed.data;
    });
  } catch (error) {
    if (error instanceof CompanyAdminDirectPurchaseUnavailableError) throw error;
    throw new CompanyAdminDirectPurchaseUnavailableError();
  }
}

export async function reconcileCompanyAdminDirectPurchase(
  actor: AuthenticatedSessionUser,
  commandId: string,
): Promise<CompanyAdminDirectPurchaseReconciliation> {
  requireExactCompanyAdministrator(actor);
  const parsedCommandId = uuid.safeParse(commandId);
  if (!parsedCommandId.success) throw new CompanyAdminDirectPurchaseUnavailableError();
  if (isDemoMode()) {
    const existing = demoState().commands.get(parsedCommandId.data);
    if (!existing) return { status: "NOT_FOUND", commandId: parsedCommandId.data };
    if (existing.actorUserId !== actor.id) {
      throw new CompanyAdminDirectPurchaseUnavailableError();
    }
    return existing.result.status === "SUCCESS"
      ? reconciliationSchema.parse({
          ...existing.result,
          status: "ALREADY_PROCESSED",
          created: false,
        })
      : existing.result;
  }
  try {
    const result = await query<PayloadRow>(
      `SELECT public.axora_company_admin_direct_purchase_result(
         $1,$2,$3,now()
       ) AS payload`,
      [actor.id, assignmentId(actor), parsedCommandId.data],
    );
    const parsed = reconciliationSchema.safeParse(result.rows[0]?.payload);
    if (!parsed.success) throw new CompanyAdminDirectPurchaseUnavailableError();
    return parsed.data;
  } catch (error) {
    if (error instanceof CompanyAdminDirectPurchaseUnavailableError) throw error;
    throw new CompanyAdminDirectPurchaseUnavailableError();
  }
}

export const companyAdminDirectPurchaseInternals = {
  directPurchaseCommandSchema,
  directPurchaseResultSchema,
  reconciliationSchema,
  workspaceSchema,
  percentageOfMoney,
};
