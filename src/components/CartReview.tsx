"use client";

import { Minus, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  reconcileCompanyAdminDirectPurchaseAction,
  runCartCommandAction,
  runCompanyAdminDirectPurchaseAction,
} from "@/app/(portal)/cart/actions";
import { ProductImage } from "@/components/ProductImage";
import { cartMessages } from "@/lib/cart-i18n";
import { publishCartChanged, subscribeCartChanged } from "@/lib/cart-client-events";
import type {
  CompanyAdminDirectPurchaseResult,
  CompanyAdminDirectPurchaseWorkspace,
} from "@/lib/company-admin-direct-purchase";
import type { SupportedLocale } from "@/lib/i18n";
import {
  formatMoneyDecimal,
  moneyDecimalFromMinorUnits,
  moneyDecimalToMinorUnits,
  parseMoneyDecimal,
} from "@/lib/money-decimal";
import type { ProcurementCartSnapshot } from "@/lib/procurement-cart";
import type { ShoppingBranchContext } from "@/lib/shopping-context";

const MAX_QUANTITY = 1_000_000;
const PENDING_PURCHASE_KEY = "axora:company-admin-direct-purchase";
const COMMAND_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type PendingPurchase = {
  cartId: string;
  expectedCartVersion: number;
  commandId: string;
};

type PurchaseConfirmation = Omit<PendingPurchase, "commandId"> & {
  amount: CompanyAdminDirectPurchaseWorkspace["orderTotal"];
  currency: CompanyAdminDirectPurchaseWorkspace["currency"];
};

function quantityError(value: string, invalid: string, tooLarge: string) {
  if (!/^[0-9]+$/.test(value)) return invalid;
  const quantity = Number(value);
  if (!Number.isSafeInteger(quantity) || quantity > MAX_QUANTITY) return tooLarge;
  return quantity < 1 ? invalid : "";
}

function readPendingPurchase(storageKey: string): PendingPurchase | undefined {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(storageKey) ?? "null") as unknown;
    if (!parsed || typeof parsed !== "object") return undefined;
    const candidate = parsed as Partial<PendingPurchase>;
    if (typeof candidate.cartId !== "string" || candidate.cartId.length < 1
      || candidate.cartId.length > 160
      || !Number.isInteger(candidate.expectedCartVersion)
      || Number(candidate.expectedCartVersion) < 1
      || typeof candidate.commandId !== "string"
      || !COMMAND_ID_PATTERN.test(candidate.commandId)) {
      sessionStorage.removeItem(storageKey);
      return undefined;
    }
    return candidate as PendingPurchase;
  } catch {
    return undefined;
  }
}

function storePendingPurchase(storageKey: string, pending: PendingPurchase) {
  try {
    sessionStorage.setItem(storageKey, JSON.stringify(pending));
    return true;
  } catch {
    return false;
  }
}

function clearPendingPurchase(storageKey: string) {
  try {
    sessionStorage.removeItem(storageKey);
  } catch {
    // A committed result remains recoverable server-side even when the
    // browser withdraws storage access after the command was submitted.
  }
}

export function CartReview({
  initialCart,
  branch,
  locale,
  checkoutMode,
  directPurchase,
  purchaseRecoveryScope,
}: {
  initialCart: ProcurementCartSnapshot;
  branch: ShoppingBranchContext;
  locale: SupportedLocale;
  checkoutMode: "DIRECT" | "DIRECT_DENIED" | "REQUEST";
  directPurchase?: CompanyAdminDirectPurchaseWorkspace;
  purchaseRecoveryScope: string;
}) {
  const copy = cartMessages(locale);
  const router = useRouter();
  const [cart, setCart] = useState(initialCart);
  const workspace = directPurchase;
  const pendingPurchaseKey = `${PENDING_PURCHASE_KEY}:${purchaseRecoveryScope}`;
  const [drafts, setDrafts] = useState<Record<string, string>>(() => Object.fromEntries(
    initialCart.items.map((item) => [item.publicRef, String(item.quantity)]),
  ));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [statusAction, setStatusAction] = useState<"BUDGET" | "WALLET" | "BRANCH" | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [purchaseBusy, setPurchaseBusy] = useState(false);
  const [unknownOutcome, setUnknownOutcome] = useState(false);
  const [recoveryReady, setRecoveryReady] = useState(checkoutMode !== "DIRECT");
  const [pendingPurchase, setPendingPurchase] = useState<PendingPurchase>();
  const [confirmation, setConfirmation] = useState<PurchaseConfirmation>();
  const [purchaseResult, setPurchaseResult] = useState<CompanyAdminDirectPurchaseResult>();
  const cartRef = useRef(cart);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const placeOrderRef = useRef<HTMLButtonElement>(null);
  const recoveryStarted = useRef(false);

  const applyAuthoritative = useCallback((next: ProcurementCartSnapshot) => {
    // A replacement active Cart may restart at version 1 after the prior Cart
    // was consumed. Within one Cart identity, only a strictly newer snapshot
    // can replace the user's current keyboard draft.
    if (next.id === cartRef.current.id && next.version <= cartRef.current.version) return;
    cartRef.current = next;
    setCart(next);
    setDrafts(Object.fromEntries(next.items.map((item) => [item.publicRef, String(item.quantity)])));
    setErrors({});
  }, []);

  useEffect(() => {
    applyAuthoritative(initialCart);
  }, [applyAuthoritative, initialCart]);

  const readLatest = useCallback(async () => {
    const result = await runCartCommandAction({ branchId: branch.id, operation: "READ" });
    if (result.ok) applyAuthoritative(result.cart);
  }, [applyAuthoritative, branch.id]);

  useEffect(() => {
    void readLatest();
    return subscribeCartChanged((message) => {
      if (message.branchId === branch.id && message.version > cartRef.current.version) void readLatest();
    });
  }, [branch.id, readLatest]);

  useEffect(() => {
    const refresh = () => void readLatest();
    const pageShown = (event: PageTransitionEvent) => { if (event.persisted) refresh(); };
    const visible = () => { if (document.visibilityState === "visible") refresh(); };
    window.addEventListener("focus", refresh);
    window.addEventListener("pageshow", pageShown);
    window.addEventListener("popstate", refresh);
    window.addEventListener("online", refresh);
    document.addEventListener("visibilitychange", visible);
    return () => {
      window.removeEventListener("focus", refresh);
      window.removeEventListener("pageshow", pageShown);
      window.removeEventListener("popstate", refresh);
      window.removeEventListener("online", refresh);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [readLatest]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (dialogOpen && !dialog.open) dialog.showModal();
    if (!dialogOpen && dialog.open) dialog.close();
  }, [dialogOpen]);

  function closeDialog() {
    setDialogOpen(false);
    setConfirmation(undefined);
    window.setTimeout(() => placeOrderRef.current?.focus(), 0);
  }

  const handlePurchaseResult = useCallback((
    result: CompanyAdminDirectPurchaseResult,
  ) => {
    setPurchaseBusy(false);
    setUnknownOutcome(false);
    setStatusAction(null);
    if (result.status === "SUCCESS"
      || result.status === "ALREADY_PROCESSED"
      || result.status === "CART_ALREADY_PURCHASED") {
      clearPendingPurchase(pendingPurchaseKey);
      setPendingPurchase(undefined);
      setPurchaseResult(result);
      setStatus("");
      publishCartChanged({ branchId: branch.id, version: result.consumedCartVersion });
      router.refresh();
      return;
    }
    clearPendingPurchase(pendingPurchaseKey);
    setPendingPurchase(undefined);
    if (result.status === "PRICE_CHANGED") {
      applyAuthoritative(result.cart);
      setStatus(copy.priceChanged);
    } else if (result.status === "STALE_CART") {
      if (result.cart) applyAuthoritative(result.cart);
      setStatus(copy.stalePurchase);
    } else if (result.status === "INSUFFICIENT_BUDGET") {
      setStatus(copy.insufficientBudget(branch.code));
      setStatusAction("BUDGET");
    } else if (result.status === "INSUFFICIENT_WALLET") {
      setStatus(copy.insufficientWallet);
      setStatusAction("WALLET");
    } else if (result.status === "BRANCH_LOCATION_REQUIRED") {
      setStatus(copy.locationRequired);
      setStatusAction("BRANCH");
    } else if (result.status === "PRODUCT_UNAVAILABLE") {
      setStatus(copy.productUnavailable);
    } else {
      setStatus(copy.budgetUnavailable);
      setStatusAction("BUDGET");
    }
    router.refresh();
  }, [applyAuthoritative, branch.code, branch.id, copy, pendingPurchaseKey, router]);

  const reconcile = useCallback(async (pending: PendingPurchase) => {
    setPendingPurchase(pending);
    setPurchaseBusy(true);
    setStatus(copy.checking);
    try {
      const response = await reconcileCompanyAdminDirectPurchaseAction({
        commandId: pending.commandId,
      });
      if (response.ok && response.result.status !== "NOT_FOUND") {
        handlePurchaseResult(response.result);
        return;
      }
    } catch {
      // An interrupted reconciliation remains unknown and keeps the same
      // command identity available for another check or retry.
    }
    setPurchaseBusy(false);
    setUnknownOutcome(true);
    setStatus(copy.outcomeUnknown);
  }, [copy.checking, copy.outcomeUnknown, handlePurchaseResult]);

  useEffect(() => {
    if (checkoutMode !== "DIRECT" || recoveryStarted.current) return;
    recoveryStarted.current = true;
    const pending = readPendingPurchase(pendingPurchaseKey);
    if (!pending) {
      const readyTimer = window.setTimeout(() => setRecoveryReady(true), 0);
      return () => window.clearTimeout(readyTimer);
    }
    const reconcileTimer = window.setTimeout(() => {
      void reconcile(pending).finally(() => setRecoveryReady(true));
    }, 0);
    return () => window.clearTimeout(reconcileTimer);
  }, [checkoutMode, pendingPurchaseKey, reconcile]);

  async function submitPurchase(pending: PendingPurchase) {
    setDialogOpen(false);
    setConfirmation(undefined);
    setPurchaseBusy(true);
    setUnknownOutcome(false);
    setStatus(copy.placing);
    setStatusAction(null);
    try {
      const response = await runCompanyAdminDirectPurchaseAction({
        cartId: pending.cartId,
        expectedCartVersion: pending.expectedCartVersion,
        commandId: pending.commandId,
      });
      if (response.ok) {
        handlePurchaseResult(response.result);
        return;
      }
    } catch {
      // Reconcile below. A transport exception is not evidence of rollback.
    }
    await reconcile(pending);
  }

  function confirmPurchase() {
    if (!confirmation) {
      closeDialog();
      return;
    }
    const existing = pendingPurchase;
    const pending = existing?.cartId === confirmation.cartId
      && existing.expectedCartVersion === confirmation.expectedCartVersion
      ? existing
      : {
          cartId: confirmation.cartId,
          expectedCartVersion: confirmation.expectedCartVersion,
          commandId: crypto.randomUUID(),
        };
    if (!storePendingPurchase(pendingPurchaseKey, pending)) {
      setDialogOpen(false);
      setConfirmation(undefined);
      setStatus(copy.purchaseUnavailable);
      return;
    }
    setPendingPurchase(pending);
    void submitPurchase(pending);
  }

  async function mutate(productRef: string, operation: "SET" | "REMOVE", quantity?: number) {
    setBusy(productRef);
    setStatus("");
    setStatusAction(null);
    try {
      const result = await runCartCommandAction({
        branchId: branch.id, operation, productRef, ...(quantity ? { quantity } : {}),
        expectedVersion: cartRef.current.version, commandId: crypto.randomUUID(),
      });
      if (result.ok) {
        applyAuthoritative(result.cart);
        publishCartChanged({ branchId: branch.id, version: result.cart.version });
        router.refresh();
      } else if (result.code === "STALE_CART" && result.cart) {
        applyAuthoritative(result.cart); setStatus(copy.stale);
        router.refresh();
      } else {
        setStatus(copy.unavailable);
      }
    } catch {
      setStatus(copy.unconfirmed);
    } finally {
      setBusy(null);
    }
  }

  function commit(productRef: string, currentValue?: string) {
    const value = currentValue ?? drafts[productRef] ?? "";
    const error = quantityError(value, copy.invalidQuantity, copy.tooLarge);
    setErrors((current) => ({ ...current, [productRef]: error }));
    if (error) return;
    const item = cartRef.current.items.find((candidate) => candidate.publicRef === productRef);
    const quantity = Number(value);
    if (item && item.quantity !== quantity) void mutate(productRef, "SET", quantity);
  }

  if (purchaseResult && (purchaseResult.status === "SUCCESS"
    || purchaseResult.status === "ALREADY_PROCESSED"
    || purchaseResult.status === "CART_ALREADY_PURCHASED")) {
    return (
      <section className="cart-purchase-success" aria-labelledby="order-placed-title" role="status">
        <h2 id="order-placed-title">{copy.orderPlaced}</h2>
        <dl>
          <div><dt>{copy.order}</dt><dd translate="no">{purchaseResult.orderReference}</dd></div>
          <div><dt>{copy.paidFromWallet}</dt><dd className="financial-value">{formatMoneyDecimal(purchaseResult.amount, purchaseResult.currency, locale)}</dd></div>
          <div><dt>{copy.deliveringTo}</dt><dd>{purchaseResult.branchCode}</dd></div>
        </dl>
        <div className="form-actions">
          <Link className="button button-primary" href={`/requests/${purchaseResult.requestId}`}>{copy.viewOrder}</Link>
          <Link className="button button-secondary" href={`/requests/${purchaseResult.requestId}#invoice`}>{copy.viewInvoice}</Link>
          <Link className="button button-secondary" href="/deliveries">{copy.viewDelivery}</Link>
        </div>
      </section>
    );
  }

  const directWorkspaceCurrent = checkoutMode === "DIRECT"
    && workspace?.cartId === cart.id && workspace.cartVersion === cart.version;
  const interactionLocked = !recoveryReady || purchaseBusy || unknownOutcome;
  const hasUncommittedQuantity = cart.items.some((item) => (
    (drafts[item.publicRef] ?? String(item.quantity)) !== String(item.quantity)
  ));
  const displayedTotal = directWorkspaceCurrent
    ? workspace.orderTotal
    : moneyDecimalFromMinorUnits(cart.items.reduce(
        (sum, item) => sum + moneyDecimalToMinorUnits(parseMoneyDecimal(item.lineTotal)),
        0n,
      ));
  const currency = workspace?.currency ?? cart.items[0]?.currency ?? "MYR";

  return (
    <section className="cart-review" aria-label={copy.title}>
      <aside className="cart-delivery-context" aria-label={`${copy.deliverTo}: ${branch.name}`}>
        <span>{copy.deliverTo}</span><strong>{branch.code} · {branch.name}</strong>
        <small>{[branch.city, branch.address].filter(Boolean).join(" · ")}</small>
      </aside>
      <p className="sr-only" aria-live="polite">{busy ? copy.updating : purchaseBusy ? status : ""}</p>
      {status ? <div className={purchaseBusy ? "cart-purchase-status" : "request-section-error"} role={purchaseBusy ? "status" : "alert"}>
        <span>{status}</span>
        {statusAction === "BUDGET" ? <Link className="button button-secondary" href="/budgets">{copy.viewBudget}</Link> : null}
        {statusAction === "WALLET" ? <Link className="button button-secondary" href="/wallet">{copy.openWallet}</Link> : null}
        {statusAction === "BRANCH" ? <Link className="button button-secondary" href={`/branches/${encodeURIComponent(branch.id)}`}>{copy.manageBranch}</Link> : null}
        {unknownOutcome && pendingPurchase ? <span className="cart-recovery-actions">
          <button className="button button-secondary" type="button" disabled={purchaseBusy} onClick={() => void reconcile(pendingPurchase)}>{copy.checkStatus}</button>
          <button className="button button-primary" type="button" disabled={purchaseBusy} onClick={() => void submitPurchase(pendingPurchase)}>{copy.retrySafely}</button>
        </span> : null}
      </div> : null}
      {checkoutMode === "DIRECT_DENIED" ? <div className="request-section-error" role="alert">{copy.directDenied}</div> : null}
      {!cart.items.length ? <div className="cart-empty"><p>{copy.empty}</p><Link className="button button-primary" href={`/products?branch=${encodeURIComponent(branch.id)}`}>{copy.continueShopping}</Link></div> : (
        <>
          <div className="cart-lines">
            {cart.items.map((item) => {
              const inputId = `quantity-${item.publicRef}`;
              const errorId = `${inputId}-error`;
              return <article className="cart-line" key={item.publicRef}>
                <div className="cart-product-image"><ProductImage product={item} locale={locale} showControls={false} /></div>
                <div className="cart-product-copy"><h2>{item.name}</h2><p>{formatMoneyDecimal(item.unitPrice, item.currency, locale)} {copy.each}</p></div>
                <div className="cart-quantity">
                  <label htmlFor={inputId}>{copy.quantity}</label>
                  <div className="cart-quantity-control">
                    <button type="button" aria-label={copy.decrease(item.name)} disabled={interactionLocked || busy === item.publicRef || item.quantity <= 1} onClick={() => void mutate(item.publicRef, "SET", item.quantity - 1)}><Minus size={18} aria-hidden="true" /></button>
                    <input id={inputId} name={inputId} autoComplete="off" type="number" inputMode="numeric" min={1} max={MAX_QUANTITY} step={1} value={drafts[item.publicRef] ?? String(item.quantity)} disabled={interactionLocked} aria-invalid={Boolean(errors[item.publicRef])} aria-describedby={errors[item.publicRef] ? errorId : undefined} onChange={(event) => { setDrafts((current) => ({ ...current, [item.publicRef]: event.target.value })); setErrors((current) => ({ ...current, [item.publicRef]: "" })); }} onBlur={(event) => commit(item.publicRef, event.currentTarget.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); commit(item.publicRef, event.currentTarget.value); } }} />
                    <button type="button" aria-label={copy.increase(item.name)} disabled={interactionLocked || busy === item.publicRef || item.quantity >= MAX_QUANTITY} onClick={() => void mutate(item.publicRef, "SET", item.quantity + 1)}><Plus size={18} aria-hidden="true" /></button>
                  </div>
                  {errors[item.publicRef] ? <span id={errorId} className="request-field-error-message" role="alert">{errors[item.publicRef]}</span> : null}
                </div>
                <div className="cart-line-total"><span>{copy.subtotal}</span><strong className="financial-value">{formatMoneyDecimal(item.lineTotal, item.currency, locale)}</strong><button type="button" className="button button-danger" aria-label={copy.removeItem(item.name)} disabled={interactionLocked || busy === item.publicRef} onClick={() => void mutate(item.publicRef, "REMOVE")}><Trash2 size={17} aria-hidden="true" />{copy.remove}</button></div>
              </article>;
            })}
          </div>
          {directWorkspaceCurrent ? <section className="cart-financial-authority" aria-label={copy.total}>
            <dl>
              <div><dt>{copy.branchBudgetAvailable}</dt><dd className="financial-value">{formatMoneyDecimal(workspace.budgetAvailable, workspace.currency, locale)}</dd></div>
              <div><dt>{copy.walletAvailable}</dt><dd className="financial-value">{formatMoneyDecimal(workspace.walletAvailable, workspace.currency, locale)}</dd></div>
            </dl>
          </section> : null}
          <footer className="cart-total">
            <div><span>{copy.total}</span><strong className="financial-value">{formatMoneyDecimal(displayedTotal, currency, locale)}</strong></div>
            {checkoutMode === "DIRECT" ? <button ref={placeOrderRef} className="button button-primary" type="button" disabled={!recoveryReady || !directWorkspaceCurrent || purchaseBusy || unknownOutcome || busy !== null || hasUncommittedQuantity || Object.values(errors).some(Boolean)} onClick={() => {
              if (!workspace || !directWorkspaceCurrent) return;
              setStatus("");
              setStatusAction(null);
              setConfirmation({
                cartId: workspace.cartId,
                expectedCartVersion: workspace.cartVersion,
                amount: workspace.orderTotal,
                currency: workspace.currency,
              });
              setDialogOpen(true);
            }}>{purchaseBusy ? copy.placing : copy.placeOrder}</button> : null}
            {checkoutMode === "REQUEST" ? <Link className="button button-primary" href={`/requests/new?branch=${encodeURIComponent(branch.id)}`}>{copy.submitRequest}</Link> : null}
          </footer>
        </>
      )}
      {checkoutMode === "DIRECT" && confirmation ? <dialog
        ref={dialogRef}
        className="direct-purchase-dialog"
        aria-labelledby="direct-purchase-title"
        aria-describedby="direct-purchase-description"
        onCancel={(event) => { event.preventDefault(); closeDialog(); }}
        onClose={() => { if (dialogOpen) setDialogOpen(false); }}
      >
        <h2 id="direct-purchase-title">{copy.confirmTitle(branch.code)}</h2>
        <div id="direct-purchase-description" className="direct-purchase-confirmation-copy">
          <p><strong>{copy.total}: <span className="financial-value">{formatMoneyDecimal(confirmation.amount, confirmation.currency, locale)}</span></strong></p>
          <p>{copy.confirmCharge(branch.code)}</p>
        </div>
        <div className="direct-purchase-dialog-actions">
          <button className="button button-secondary" type="button" disabled={purchaseBusy} onClick={closeDialog}>{copy.cancel}</button>
          <button className="button button-primary" type="button" disabled={purchaseBusy} onClick={confirmPurchase}>{copy.placeOrder}</button>
        </div>
      </dialog> : null}
    </section>
  );
}
