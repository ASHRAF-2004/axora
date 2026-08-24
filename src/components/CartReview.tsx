"use client";

import { Minus, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { runCartCommandAction } from "@/app/(portal)/cart/actions";
import { ProductImage } from "@/components/ProductImage";
import { cartMessages } from "@/lib/cart-i18n";
import { publishCartChanged, subscribeCartChanged } from "@/lib/cart-client-events";
import { formatCurrency } from "@/lib/domain";
import type { SupportedLocale } from "@/lib/i18n";
import type { ProcurementCartSnapshot } from "@/lib/procurement-cart";
import type { ShoppingBranchContext } from "@/lib/shopping-context";

const MAX_QUANTITY = 1_000_000;

function quantityError(value: string, invalid: string, tooLarge: string) {
  if (!/^[0-9]+$/.test(value)) return invalid;
  const quantity = Number(value);
  if (!Number.isSafeInteger(quantity) || quantity > MAX_QUANTITY) return tooLarge;
  return quantity < 1 ? invalid : "";
}

export function CartReview({ initialCart, branch, locale }: {
  initialCart: ProcurementCartSnapshot;
  branch: ShoppingBranchContext;
  locale: SupportedLocale;
}) {
  const copy = cartMessages(locale);
  const [cart, setCart] = useState(initialCart);
  const [drafts, setDrafts] = useState<Record<string, string>>(() => Object.fromEntries(
    initialCart.items.map((item) => [item.publicRef, String(item.quantity)]),
  ));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const cartRef = useRef(cart);

  const applyAuthoritative = useCallback((next: ProcurementCartSnapshot) => {
    // Cart content is versioned atomically. Reapplying an equal-version read
    // can erase a keyboard draft while overlapping mount/focus reads settle;
    // only a strictly newer snapshot is new authoritative information.
    if (next.version <= cartRef.current.version) return;
    cartRef.current = next;
    setCart(next);
    setDrafts(Object.fromEntries(next.items.map((item) => [item.publicRef, String(item.quantity)])));
  }, []);

  const readLatest = useCallback(async () => {
    const result = await runCartCommandAction({ branchId: branch.id, operation: "READ" });
    if (result.ok) applyAuthoritative(result.cart);
  }, [applyAuthoritative, branch.id]);

  useEffect(() => {
    // A version broadcast or focus event can arrive before this client island
    // hydrates. Reconcile once on mount so an already-stale RSC snapshot cannot
    // survive merely because the invalidation hint was missed.
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

  async function mutate(productRef: string, operation: "SET" | "REMOVE", quantity?: number) {
    setBusy(productRef); setStatus("");
    try {
      const result = await runCartCommandAction({
        branchId: branch.id, operation, productRef, ...(quantity ? { quantity } : {}),
        expectedVersion: cartRef.current.version, commandId: crypto.randomUUID(),
      });
      if (result.ok) {
        applyAuthoritative(result.cart);
        publishCartChanged({ branchId: branch.id, version: result.cart.version });
      } else if (result.code === "STALE_CART" && result.cart) {
        applyAuthoritative(result.cart); setStatus(copy.stale);
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
    // Blur and Enter can run before React has flushed the preceding input
    // state update. The control value is the user's current edit and avoids a
    // valid first attempt being discarded because a render is one tick behind.
    const value = currentValue ?? drafts[productRef] ?? "";
    const error = quantityError(value, copy.invalidQuantity, copy.tooLarge);
    setErrors((current) => ({ ...current, [productRef]: error }));
    if (error) return;
    const item = cartRef.current.items.find((candidate) => candidate.publicRef === productRef);
    const quantity = Number(value);
    if (item && item.quantity !== quantity) void mutate(productRef, "SET", quantity);
  }

  const total = cart.items.reduce((sum, item) => sum + Number(item.lineTotal), 0);
  return (
    <section className="cart-review" aria-label={copy.title}>
      <aside className="cart-delivery-context" aria-label={`${copy.deliverTo}: ${branch.name}`}>
        <span>{copy.deliverTo}</span><strong>{branch.code} · {branch.name}</strong>
        <small>{[branch.city, branch.address].filter(Boolean).join(" · ")}</small>
      </aside>
      <p className="sr-only" aria-live="polite">{busy ? copy.updating : status}</p>
      {status ? <div className="request-section-error" role="alert">{status}</div> : null}
      {!cart.items.length ? <div className="cart-empty"><p>{copy.empty}</p><Link className="button button-primary" href={`/products?branch=${encodeURIComponent(branch.id)}`}>{copy.continueShopping}</Link></div> : (
        <>
          <div className="cart-lines">
            {cart.items.map((item) => {
              const inputId = `quantity-${item.publicRef}`;
              const errorId = `${inputId}-error`;
              return <article className="cart-line" key={item.publicRef}>
                <div className="cart-product-image"><ProductImage product={item} locale={locale} showControls={false} /></div>
                <div className="cart-product-copy"><h2>{item.name}</h2><p>{formatCurrency(Number(item.unitPrice), locale)} {copy.each}</p></div>
                <div className="cart-quantity">
                  <label htmlFor={inputId}>{copy.quantity}</label>
                  <div className="cart-quantity-control">
                    <button type="button" aria-label={copy.decrease(item.name)} disabled={busy === item.publicRef || item.quantity <= 1} onClick={() => void mutate(item.publicRef, "SET", item.quantity - 1)}><Minus size={18} /></button>
                    <input id={inputId} type="number" inputMode="numeric" min={1} max={MAX_QUANTITY} step={1} value={drafts[item.publicRef] ?? String(item.quantity)} aria-invalid={Boolean(errors[item.publicRef])} aria-describedby={errors[item.publicRef] ? errorId : undefined} onChange={(event) => { setDrafts((current) => ({ ...current, [item.publicRef]: event.target.value })); setErrors((current) => ({ ...current, [item.publicRef]: "" })); }} onBlur={(event) => commit(item.publicRef, event.currentTarget.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); commit(item.publicRef, event.currentTarget.value); } }} />
                    <button type="button" aria-label={copy.increase(item.name)} disabled={busy === item.publicRef || item.quantity >= MAX_QUANTITY} onClick={() => void mutate(item.publicRef, "SET", item.quantity + 1)}><Plus size={18} /></button>
                  </div>
                  {errors[item.publicRef] ? <span id={errorId} className="request-field-error-message" role="alert">{errors[item.publicRef]}</span> : null}
                </div>
                <div className="cart-line-total"><span>{copy.subtotal}</span><strong>{formatCurrency(Number(item.lineTotal), locale)}</strong><button type="button" className="button button-danger" aria-label={copy.removeItem(item.name)} disabled={busy === item.publicRef} onClick={() => void mutate(item.publicRef, "REMOVE")}><Trash2 size={17} />{copy.remove}</button></div>
              </article>;
            })}
          </div>
          <footer className="cart-total"><div><span>{copy.total}</span><strong>{formatCurrency(total, locale)}</strong></div><Link className="button button-primary" href={`/requests/new?branch=${encodeURIComponent(branch.id)}`}>{copy.continue}</Link></footer>
        </>
      )}
    </section>
  );
}
