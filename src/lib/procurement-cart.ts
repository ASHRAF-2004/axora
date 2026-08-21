import { randomUUID } from "node:crypto";
import type { PoolClient, QueryResultRow } from "pg";
import { z } from "zod";
import type { AuthenticatedSessionUser, SessionUser } from "./auth";
import { getDemoStore } from "./demo-data";
import { isDemoMode, query, withAuditTransaction } from "./db";
import { withDemoCommercialDefaults } from "./procurement-rules";

const uuid = z.string().uuid();

export type ProcurementCartIssue =
  | "UNAVAILABLE"
  | "CATEGORY_NOT_ALLOWED"
  | "REPRICED";

export interface ProcurementCartItem {
  publicRef: string;
  name: string;
  category: string;
  subcategory: string;
  brand?: string;
  size?: string;
  unit: string;
  description?: string;
  unitPrice: string;
  displayedUnitPrice: string;
  priceRuleVersion: number;
  displayedPriceRuleVersion: number;
  currency: string;
  deliverySlaDays: number;
  hasImage: boolean;
  imageAltText?: string;
  quantity: number;
  specification: string;
  available: boolean;
  categoryAllowed: boolean;
  repriced: boolean;
  lineTotal: string;
}

export interface ProcurementCartSnapshot {
  id: string;
  companyId: string;
  branchId: string;
  departmentId?: string;
  version: number;
  status: "ACTIVE" | "SUBMITTED" | "ABANDONED";
  items: ProcurementCartItem[];
  updatedAt: string;
}

export interface CatalogPurchasingScope {
  companyId: string;
  branchId: string;
  departmentId?: string;
  allowedCategories: string[];
}

interface ValueRow<T> extends QueryResultRow { value: T | null }

interface DemoCartState {
  carts: Map<string, ProcurementCartSnapshot>;
  commands: Map<string, { fingerprint: string; snapshot: ProcurementCartSnapshot }>;
}

declare global {
  var __axoraDemoProcurementCarts: DemoCartState | undefined;
}

function assignmentId(actor: { roleAssignmentId?: string }) {
  if (!actor.roleAssignmentId) throw new Error("The purchasing scope is unavailable.");
  return actor.roleAssignmentId;
}

function demoState() {
  global.__axoraDemoProcurementCarts ??= { carts: new Map(), commands: new Map() };
  return global.__axoraDemoProcurementCarts;
}

function demoScope(actor: SessionUser, branchId: string) {
  const branch = getDemoStore().branches.find((item) => item.id === branchId);
  if (!branch || actor.accountKind !== "COMPANY"
    || (actor.companyId && actor.companyId !== branch.companyId)
    || (actor.branchId && actor.branchId !== branch.id)) {
    throw new Error("The purchasing scope is unavailable.");
  }
  return { branch, departmentId: actor.scopeType === "DEPARTMENT" ? actor.departmentId : undefined };
}

function demoCart(actor: AuthenticatedSessionUser, branchId: string) {
  const { branch, departmentId } = demoScope(actor, branchId);
  const key = [actor.id, branch.companyId, branch.id, departmentId ?? ""].join(":");
  const state = demoState();
  const existing = state.carts.get(key);
  if (existing?.status === "ACTIVE") return existing;
  const created: ProcurementCartSnapshot = {
    id: randomUUID(), companyId: branch.companyId, branchId: branch.id,
    ...(departmentId ? { departmentId } : {}), version: 1, status: "ACTIVE",
    items: [], updatedAt: new Date().toISOString(),
  };
  state.carts.set(key, created);
  return created;
}

function cloneCart(cart: ProcurementCartSnapshot): ProcurementCartSnapshot {
  return structuredClone(cart);
}

export async function getCatalogPurchasingScope(
  actor: SessionUser,
  branchId: string,
): Promise<CatalogPurchasingScope | null> {
  if (isDemoMode()) {
    const { branch, departmentId } = demoScope(actor, branchId);
    return {
      companyId: branch.companyId, branchId: branch.id,
      ...(departmentId ? { departmentId } : {}),
      allowedCategories: [...new Set(getDemoStore().products
        .filter((product) => product.status === "Active"
          && (!product.companyId || product.companyId === branch.companyId))
        .map((product) => product.category))].sort(),
    };
  }
  if (!uuid.safeParse(branchId).success) return null;
  const result = await query<ValueRow<CatalogPurchasingScope>>(
    "SELECT public.axora_catalog_purchasing_scope($1,$2,$3,$4) AS value",
    [actor.id, assignmentId(actor), branchId, new Date()],
  );
  return result.rows[0]?.value ?? null;
}

export async function commandProcurementCart(
  actor: AuthenticatedSessionUser,
  input: {
    branchId: string;
    operation: "READ" | "ADD" | "SET" | "REMOVE" | "ACKNOWLEDGE_PRICES";
    productRef?: string;
    quantity?: number;
    specification?: string;
    expectedVersion?: number;
    commandId?: string;
  },
): Promise<ProcurementCartSnapshot> {
  const parsed = z.object({
    branchId: z.string().trim().min(1).max(160),
    operation: z.enum(["READ", "ADD", "SET", "REMOVE", "ACKNOWLEDGE_PRICES"]),
    productRef: z.string().trim().max(160).optional().default(""),
    quantity: z.coerce.number().int().min(1).max(1_000_000).optional(),
    specification: z.string().trim().max(1_000).optional().default(""),
    expectedVersion: z.coerce.number().int().positive().optional(),
    commandId: uuid.optional().default(() => randomUUID()),
  }).parse(input);
  if (!isDemoMode() && !uuid.safeParse(parsed.branchId).success) {
    throw new Error("The purchasing scope is unavailable.");
  }
  if (isDemoMode()) {
    const state = demoState();
    const fingerprint = JSON.stringify(parsed);
    const replay = state.commands.get(parsed.commandId);
    if (replay) {
      if (replay.fingerprint !== fingerprint) throw new Error("The cart command is unavailable.");
      return cloneCart(replay.snapshot);
    }
    const cart = demoCart(actor, parsed.branchId);
    if (parsed.expectedVersion && parsed.expectedVersion !== cart.version) {
      throw new Error("The cart changed before this command was recorded.");
    }
    if (["ADD", "SET", "REMOVE"].includes(parsed.operation)) {
      const source = getDemoStore().products.find((product) => (
        `demo-${product.name.normalize("NFKD").toLowerCase()
          .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64)}`
          === parsed.productRef
      ));
      if (!source || source.status !== "Active") throw new Error("The product is unavailable.");
      const product = withDemoCommercialDefaults(source);
      const index = cart.items.findIndex((item) => item.publicRef === parsed.productRef);
      if (parsed.operation === "REMOVE") {
        if (index >= 0) cart.items.splice(index, 1);
      } else {
        const quantity = parsed.operation === "ADD" && index >= 0
          ? cart.items[index].quantity + (parsed.quantity ?? 1)
          : parsed.quantity ?? 1;
        const item: ProcurementCartItem = {
          publicRef: parsed.productRef, name: product.name, category: product.category,
          subcategory: product.subcategory, brand: product.brand, size: product.size,
          unit: product.unit, description: product.description,
          unitPrice: product.defaultSellPrice.toFixed(2),
          displayedUnitPrice: product.defaultSellPrice.toFixed(2),
          priceRuleVersion: product.priceRuleVersion ?? 1,
          displayedPriceRuleVersion: product.priceRuleVersion ?? 1,
          currency: product.priceCurrency ?? "MYR", deliverySlaDays: product.deliverySlaDays,
          hasImage: product.hasImage, imageAltText: product.imageAltText,
          quantity, specification: parsed.specification, available: true,
          categoryAllowed: true, repriced: false,
          lineTotal: (quantity * product.defaultSellPrice).toFixed(2),
        };
        if (index >= 0) cart.items[index] = item; else cart.items.push(item);
      }
    }
    if (parsed.operation !== "READ") {
      cart.version += 1;
      cart.updatedAt = new Date().toISOString();
    }
    const result = cloneCart(cart);
    state.commands.set(parsed.commandId, { fingerprint, snapshot: result });
    return result;
  }
  return withAuditTransaction(
    { actor, reason: `Procurement cart ${parsed.operation.toLowerCase()}` },
    async (client) => {
      const result = await client.query<ValueRow<ProcurementCartSnapshot>>(
        `SELECT public.axora_procurement_cart_command(
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10
        ) AS value`,
        [actor.id, assignmentId(actor), parsed.branchId, parsed.operation,
          parsed.productRef || null, parsed.quantity ?? null, parsed.specification,
          parsed.expectedVersion ?? null, parsed.commandId, new Date()],
      );
      const cart = result.rows[0]?.value;
      if (!cart) throw new Error("The cart is unavailable.");
      return cart;
    },
  );
}

export async function lockProcurementCartForSubmission(
  client: PoolClient,
  actor: AuthenticatedSessionUser,
  cartId: string,
  expectedVersion: number,
) {
  const result = await client.query<ValueRow<{
    cartId: string; version: number; companyId: string; branchId: string;
    departmentId?: string;
    lines: Array<{ productId: string; quantity: number; specification: string }>;
  }>>(
    "SELECT public.axora_lock_procurement_cart_for_submission($1,$2,$3,$4,$5) AS value",
    [actor.id, assignmentId(actor), cartId, expectedVersion, new Date()],
  );
  const value = result.rows[0]?.value;
  if (!value) throw new Error("The cart is unavailable.");
  return value;
}

export async function consumeProcurementCart(
  client: PoolClient,
  actor: AuthenticatedSessionUser,
  input: { cartId: string; expectedVersion: number; requestId: string; commandId: string },
) {
  await client.query(
    "SELECT public.axora_consume_procurement_cart($1,$2,$3,$4,$5,$6,$7)",
    [actor.id, assignmentId(actor), input.cartId, input.expectedVersion,
      input.requestId, input.commandId, new Date()],
  );
}

export function consumeDemoProcurementCart(
  actor: AuthenticatedSessionUser,
  input: { cartId: string; expectedVersion: number; requestId: string },
) {
  if (!isDemoMode()) throw new Error("Demo cart access is unavailable.");
  const cart = [...demoState().carts.values()].find((candidate) => (
    candidate.id === input.cartId && candidate.status === "ACTIVE"
  ));
  if (!cart || cart.version !== input.expectedVersion
    || cart.companyId !== actor.companyId
    || (actor.branchId && cart.branchId !== actor.branchId)) {
    throw new Error("The cart changed before submission.");
  }
  cart.status = "SUBMITTED";
  cart.version += 1;
  cart.updatedAt = new Date().toISOString();
}
