"use client";

import type { RequestBudgetChoice } from "@/lib/budget-ledger";

import { createRequestAction } from "@/app/(portal)/requests/actions";
import { runCartCommandAction } from "@/app/(portal)/cart/actions";
import { publishCartChanged } from "@/lib/cart-client-events";
import { useUxFeedback } from "@/components/UxFeedbackProvider";
import type { SessionUser } from "@/lib/auth";
import { formatCurrency, roundMoney } from "@/lib/domain";
import type { SupportedLocale } from "@/lib/i18n";
import { corePortalMessages, localizedStatus } from "@/lib/core-portal-i18n";
import { budgetApprovalMessages } from "@/lib/budget-approval-i18n";
import type { Branch, Company } from "@/lib/types";
import type { CustomerCatalogProduct } from "@/lib/catalog-contracts";
import type { ProcurementCartSnapshot } from "@/lib/procurement-cart";
import { readRequestDraft } from "@/lib/request-draft";
import type { RequestDraftState } from "@/lib/request-draft";
import {
  AlertCircle,
  CalendarDays,
  ShoppingCart,
  Trash2,
} from "lucide-react";
import {
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import Link from "next/link";
import { procurementRulesMessages } from "@/lib/procurement-rules-i18n";
import { shopMessages } from "@/lib/shop-i18n";

interface SelectedLine {
  publicRef: string;
  quantity: number;
  specification: string;
}

type RequestField =
  | "branch"
  | "neededByDate"
  | "products"
  | "quantity"
  | "price";

type FormErrors = Partial<Record<RequestField, string>>;

function localDateValue(date = new Date()) {
  const localDate = new Date(
    date.getTime() - date.getTimezoneOffset() * 60_000,
  );

  return localDate.toISOString().slice(0, 10);
}

export function RequestForm({
  actor,
  companies,
  branches,
  budgetAccounts = [],
  initialProduct,
  initialCart,
  initialRequestDraft,
  integrationDraftId,
  locale = "en",
}: {
  actor: SessionUser;
  companies: Company[];
  branches: Branch[];
  budgetAccounts?: RequestBudgetChoice[];
  initialProduct?: CustomerCatalogProduct;
  initialCart: ProcurementCartSnapshot;
  initialRequestDraft?: Omit<RequestDraftState,"updatedAt">;
  integrationDraftId?: string;
  locale?: SupportedLocale;
}) {
  const company =
    companies.find((item) => item.id === actor.companyId) ?? companies[0];

  const today = localDateValue();
  const { notify } = useUxFeedback();
  const copy = corePortalMessages(locale).requestForm;
  const ruleCopy = procurementRulesMessages(locale);
  const cartCopy = shopMessages(locale);
  const draftCompanyId = actor.companyId ?? companies[0]?.id;
  const draftScope = useMemo(() => (
    draftCompanyId
      ? { userId: actor.id, companyId: draftCompanyId }
      : { userId: actor.id }
  ), [actor.id, draftCompanyId]);
  const draftState = useMemo(() => {
    if (initialRequestDraft) return initialRequestDraft;
    if (typeof window === "undefined") return null;
    return readRequestDraft(draftScope);
  }, [draftScope,initialRequestDraft]);

  const availableBranches = branches.filter(
    (item) =>
      item.status === "Active" && item.companyId === company?.id,
  );

  const resolveDraftBranch = (storedBranchId: string | undefined) => {
    if (
      storedBranchId
      && availableBranches.some((item) => item.id === storedBranchId)
    ) {
      return storedBranchId;
    }
    return actor.branchId ?? "";
  };

  const cartProducts = initialCart.items.map<CustomerCatalogProduct>((item) => ({
    publicRef: item.publicRef, name: item.name, category: item.category,
    subcategory: item.subcategory, brand: item.brand, size: item.size,
    unit: item.unit, description: item.description,
    defaultSellPrice: Number(item.unitPrice),
    priceRuleVersion: item.priceRuleVersion, priceCurrency: item.currency,
    deliverySlaDays: item.deliverySlaDays, hasImage: item.hasImage,
    imageAltText: item.imageAltText,
  }));
  if (initialProduct && !cartProducts.some((item) => item.publicRef === initialProduct.publicRef)) {
    cartProducts.push(initialProduct);
  }
  const [knownProducts, setKnownProducts] = useState<CustomerCatalogProduct[]>(cartProducts);

  const productByRef = useMemo(
    () =>
      new Map(
        knownProducts.map((product) => [product.publicRef, product]),
      ),
    [knownProducts],
  );

  const [selected, setSelected] = useState<SelectedLine[]>(initialCart.items.map((item) => ({
    publicRef: item.publicRef, quantity: item.quantity,
    specification: item.specification,
  })));
  const [cartVersion, setCartVersion] = useState(initialCart.version);
  const [cartBusy, setCartBusy] = useState(false);
  const [cartDirty, setCartDirty] = useState(false);
  const [branchId] = useState(initialCart.branchId || resolveDraftBranch(draftState?.branchId));
  const [neededByDate, setNeededByDate] = useState(() => {
    if (draftState?.neededByDate && draftState.neededByDate >= today) {
      return draftState.neededByDate;
    }
    return today;
  });
  const [errors, setErrors] = useState<FormErrors>({});
  const [priceChanges, setPriceChanges] = useState<string[]>(
    initialCart.items.filter((item) => item.repriced).map((item) => item.name),
  );
  const [pricesAcknowledged, setPricesAcknowledged] = useState(
    !initialCart.items.some((item) => item.repriced),
  );

  const formRef = useRef<HTMLFormElement | null>(null);
  const cartVersionRef = useRef(initialCart.version);
  const cartVersionInputRef = useRef<HTMLInputElement | null>(null);
  const cartSyncingRef = useRef(false);
  const cartSubmitReadyRef = useRef(false);
  const branchRef = useRef<HTMLSelectElement | null>(null);
  const dateRef = useRef<HTMLInputElement | null>(null);
  const productsRef = useRef<HTMLDivElement | null>(null);

  const selectedBranch = availableBranches.find(
    (item) => item.id === branchId,
  );

  const subtotal = selected.reduce((total, line) => {
    const product = productByRef.get(line.publicRef);

    return (
      total +
      roundMoney(
        line.quantity * (product?.defaultSellPrice ?? 0),
      )
    );
  }, 0);

  const estimatedDeliveryFee =
    company?.estimatedDeliveryFee ?? 0;
  const taxRate = company?.taxRate ?? 0;
  const taxAmount = roundMoney(subtotal * (taxRate / 100));
  const estimatedTotal = roundMoney(
    subtotal + estimatedDeliveryFee + taxAmount,
  );
  const budgetCopy = budgetApprovalMessages(locale);
  const selectedBudget = budgetAccounts.find((account) => (
    account.levelType === "DEPARTMENT"
    && account.departmentId === actor.departmentId
    && account.branchId === branchId
  )) ?? budgetAccounts.find((account) => (
    account.levelType === "BRANCH" && account.branchId === branchId
  ));
  const budgetAvailable = Number(selectedBudget?.available ?? 0);
  const exceedsBudget = Boolean(selectedBudget) && estimatedTotal > budgetAvailable;

  function clearError(field: RequestField) {
    setErrors((current) => {
      if (!current[field]) return current;

      const next = { ...current };
      delete next[field];
      return next;
    });
  }

  function applyCart(cart: ProcurementCartSnapshot) {
    cartVersionRef.current = cart.version;
    if (cartVersionInputRef.current) {
      cartVersionInputRef.current.value = String(cart.version);
    }
    setCartVersion(cart.version);
    setKnownProducts(cart.items.map((item) => ({
      publicRef: item.publicRef, name: item.name, category: item.category,
      subcategory: item.subcategory, brand: item.brand, size: item.size,
      unit: item.unit, description: item.description,
      defaultSellPrice: Number(item.unitPrice),
      priceRuleVersion: item.priceRuleVersion, priceCurrency: item.currency,
      deliverySlaDays: item.deliverySlaDays, hasImage: item.hasImage,
      imageAltText: item.imageAltText,
    })));
    setSelected(cart.items.map((item) => ({
      publicRef: item.publicRef, quantity: item.quantity,
      specification: item.specification,
    })));
    const changed = cart.items.filter((item) => item.repriced).map((item) => item.name);
    setPriceChanges(changed);
    if (!changed.length) setPricesAcknowledged(true);
  }

  async function runCartCommand(input: {
    operation: "SET" | "REMOVE" | "ACKNOWLEDGE_PRICES";
    productRef?: string;
    quantity?: number;
    specification?: string;
  }) {
    setCartBusy(true);
    try {
      let result;
      try {
        result = await runCartCommandAction({
          branchId, expectedVersion: cartVersionRef.current,
          commandId: crypto.randomUUID(), ...input,
        });
      } catch {
        throw new Error(cartCopy.cartUnconfirmed);
      }
      if (!result.ok) {
        if (result.code === "STALE_CART" && result.cart) applyCart(result.cart);
        throw new Error(cartCopy.cartError(result.code));
      }
      applyCart(result.cart);
      publishCartChanged({ branchId, version: result.cart.version });
      return result.cart;
    } finally {
      setCartBusy(false);
    }
  }

  async function removeProduct(product: CustomerCatalogProduct) {
    clearError("products");
    try {
      await runCartCommand({ operation: "REMOVE", productRef: product.publicRef });
    } catch (error) {
      notify(error instanceof Error ? error.message : "Unable to update the cart.", "error");
    }
  }

  function updateLine(
    publicRef: string,
    patch: Partial<SelectedLine>,
  ) {
    clearError("quantity");
    setCartDirty(true);

    setSelected((current) =>
      current.map((item) =>
        item.publicRef === publicRef
          ? { ...item, ...patch }
          : item,
      ),
    );
  }

  function chooseDate(daysFromToday: number) {
    const date = new Date();
    date.setDate(date.getDate() + daysFromToday);

    setNeededByDate(localDateValue(date));
    clearError("neededByDate");
    dateRef.current?.focus();
  }

  function focusFirstError(field: RequestField) {
    requestAnimationFrame(() => {
      let target: HTMLElement | null = null;

      if (field === "branch") target = branchRef.current;
      if (field === "neededByDate") target = dateRef.current;

      if (field === "products") {
        target = productsRef.current;
      }

      if (field === "quantity") {
        target =
          formRef.current?.querySelector<HTMLInputElement>(
            'input[name="quantity"]',
          ) ?? null;
      }

      target?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });

      target?.focus({ preventScroll: true });
    });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    const nextErrors: FormErrors = {};

    if (!branchId) {
      nextErrors.branch =
        locale === "ar" ? "اختر الفرع الذي سيستلم هذه البنود." : locale === "ms" ? "Pilih cawangan yang akan menerima item ini." : "Select the branch that will receive these items.";
    }

    if (!neededByDate) {
      nextErrors.neededByDate =
        locale === "ar" ? "اختر تاريخ الحاجة إلى البنود." : locale === "ms" ? "Pilih tarikh item diperlukan." : "Choose when the items are needed.";
    } else if (neededByDate < today) {
      nextErrors.neededByDate =
        locale === "ar" ? "اختر اليوم أو تاريخاً لاحقاً؛ التواريخ السابقة غير مسموحة." : locale === "ms" ? "Pilih hari ini atau tarikh akan datang; tarikh lampau tidak dibenarkan." : "Choose today or a future date. Past dates are not allowed.";
    }

    if (!selected.length) {
      nextErrors.products =
        locale === "ar" ? "أضف منتجاً واحداً على الأقل قبل إرسال الطلب." : locale === "ms" ? "Tambah sekurang-kurangnya satu produk sebelum menghantar permintaan." : "Add at least one product before submitting the request.";
    }

    const invalidQuantity = selected.find((line) => {
      const product = productByRef.get(line.publicRef);

      if (!product) return true;

      return !Number.isSafeInteger(line.quantity) || line.quantity < 1;
    });

    if (invalidQuantity) {
      nextErrors.quantity = locale === "ar"
        ? "استخدم كمية صحيحة لا تقل عن 1."
        : locale === "ms"
          ? "Gunakan kuantiti nombor bulat sekurang-kurangnya 1."
          : "Use a whole quantity of at least 1.";
    }

    if (priceChanges.length && !pricesAcknowledged) {
      nextErrors.price = ruleCopy.acknowledgePricesError;
    }

    const firstError = Object.entries(nextErrors)[0] as
      | [RequestField, string]
      | undefined;

    if (!firstError) {
      setErrors({});
      if (cartSubmitReadyRef.current) {
        cartSubmitReadyRef.current = false;
        return;
      }
      if (!cartDirty) return;
      event.preventDefault();
      if (cartSyncingRef.current) return;
      cartSyncingRef.current = true;
      const form = event.currentTarget;
      const submitter = event.nativeEvent instanceof SubmitEvent
        && event.nativeEvent.submitter instanceof HTMLButtonElement
        ? event.nativeEvent.submitter : undefined;
      try {
        for (const line of selected) {
          await runCartCommand({
            operation: "SET", productRef: line.publicRef,
            quantity: line.quantity, specification: line.specification,
          });
        }
        setCartDirty(false);
        cartSubmitReadyRef.current = true;
        form.requestSubmit(submitter);
      } catch (error) {
        notify(error instanceof Error
          ? error.message : "Unable to update the cart.", "error");
      } finally {
        cartSyncingRef.current = false;
      }
      return;
    }

    event.preventDefault();
    setErrors(nextErrors);
    notify(firstError[1], "error");
    focusFirstError(firstError[0]);
  }

  return (
    <form
      ref={formRef}
      action={createRequestAction}
      className="panel form-panel"
      style={{ position: "static" }}
      noValidate
      onSubmit={handleSubmit}
      data-feedback-label={copy.submitting}
    >
      <input
        name="companyId"
        type="hidden"
        value={company?.id ?? ""}
      />
      <input name="branchId" type="hidden" value={branchId} />
      <input name="cartId" type="hidden" value={initialCart.id} />
      <input ref={cartVersionInputRef} name="cartVersion" type="hidden" value={cartVersion} />
      {integrationDraftId ? <input name="integrationDraftId" type="hidden" value={integrationDraftId} /> : null}

      <div
        className="request-summary"
        style={{ marginBlockEnd: 20 }}
      >
        <div className="summary-box">
          <span>{copy.company}</span>
          <strong>{company?.name ?? copy.assignedCompany}</strong>
        </div>

        <div className="summary-box">
          <span>{copy.requester}</span>
          <strong>{actor.name}</strong>
          <small>{actor.email}</small>
        </div>

        <div className="summary-box">
          <span>{copy.selectedItems}</span>
          <strong>{selected.length}</strong>
        </div>

        <div className="summary-box">
          <span>{copy.estimatedTotal}</span>
          <strong>{formatCurrency(estimatedTotal, locale)}</strong>
        </div>
      </div>

      {Object.keys(errors).length ? (
        <div
          className="request-error-summary"
          role="alert"
          aria-live="assertive"
        >
          <AlertCircle size={21} aria-hidden="true" />

          <div>
            <strong>{copy.errorTitle}</strong>
            <p>{copy.errorBody}</p>

            <ul>
              {Object.values(errors).map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}

      {priceChanges.length ? (
        <div className="callout" role="status" style={{ marginBlockEnd: 18 }}>
          <strong>{ruleCopy.priceChangedTitle}</strong>
          <p>{ruleCopy.priceChangedBody(priceChanges.length)}</p>
          <label>
            <input
              type="checkbox"
              checked={pricesAcknowledged}
              onChange={(event) => {
                const checked = event.target.checked;
                setPricesAcknowledged(checked);
                if (checked) {
                  clearError("price");
                  void runCartCommand({ operation: "ACKNOWLEDGE_PRICES" })
                    .catch((error: unknown) => {
                      setPricesAcknowledged(false);
                      notify(error instanceof Error ? error.message : "Unable to update the cart.", "error");
                    });
                }
              }}
            />
            {ruleCopy.acknowledgePrices}
          </label>
        </div>
      ) : null}

      <div className="form-grid">
        <label>
          {copy.branch}
          <select
            ref={branchRef}
            value={branchId}
            disabled
            className={
              errors.branch ? "request-input-error" : undefined
            }
            aria-invalid={Boolean(errors.branch)}
            aria-describedby={
              errors.branch ? "branch-error" : undefined
            }
          >
            <option value="" disabled>
              {copy.selectBranch}
            </option>

            {availableBranches.map((item) => (
              <option key={item.id} value={item.id}>
                {item.code} · {item.name}
              </option>
            ))}
          </select>

          {errors.branch ? (
            <span
              className="request-field-error-message"
              id="branch-error"
            >
              <AlertCircle size={14} aria-hidden="true" />
              {errors.branch}
            </span>
          ) : (
            <span className="form-hint">
              {copy.branchHint}
            </span>
          )}
        </label>

        <label>
          {copy.neededBy}
          <div className="request-date-control">
            <CalendarDays size={18} aria-hidden="true" />

            <input
              ref={dateRef}
              name="neededByDate"
              type="date"
              min={today}
              value={neededByDate}
              className={
                errors.neededByDate
                  ? "request-input-error"
                  : undefined
              }
              aria-invalid={Boolean(errors.neededByDate)}
              aria-describedby={
                errors.neededByDate
                  ? "needed-date-error"
                  : "needed-date-hint"
              }
              onChange={(event) => {
                setNeededByDate(event.target.value);
                clearError("neededByDate");
              }}
            />
          </div>

          <div
            className="request-date-shortcuts"
            aria-label={copy.quickDates}
          >
            <button
              type="button"
              data-ux-silent="true"
              onClick={() => chooseDate(0)}
            >
              {copy.today}
            </button>

            <button
              type="button"
              data-ux-silent="true"
              onClick={() => chooseDate(7)}
            >
              {copy.sevenDays}
            </button>

            <button
              type="button"
              data-ux-silent="true"
              onClick={() => chooseDate(30)}
            >
              {copy.thirtyDays}
            </button>
          </div>

          {errors.neededByDate ? (
            <span
              className="request-field-error-message"
              id="needed-date-error"
            >
              <AlertCircle size={14} aria-hidden="true" />
              {errors.neededByDate}
            </span>
          ) : (
            <span className="form-hint" id="needed-date-hint">
              {copy.pastDate}
            </span>
          )}
        </label>

        <label>
          {copy.priority}
          <select name="urgency" defaultValue={draftState?.urgency ?? "Normal"}>
            <option value="Low">{localizedStatus("Low", locale)}</option>
            <option value="Normal">{localizedStatus("Normal", locale)}</option>
            <option value="High">{localizedStatus("High", locale)}</option>
            <option value="Urgent">{localizedStatus("Urgent", locale)}</option>
          </select>
        </label>

        <label className="field-full">
          {copy.notes}
          <textarea
            name="notes"
            placeholder={copy.notesPlaceholder}
            defaultValue={draftState?.notes ?? ""}
          />
        </label>
      </div>

      {selectedBranch ? (
        <div className="callout" style={{ marginBlockStart: 16 }}>
          <strong>{selectedBudget?.name ?? copy.branchBudget(selectedBranch.name)}</strong>
          {selectedBudget ? (
            <p>
              {budgetCopy.available}: {formatCurrency(budgetAvailable, locale)} · {budgetCopy.period}: {selectedBudget.periodName}
              {exceedsBudget ? ` · ${budgetCopy.exceededBy}: ${formatCurrency(estimatedTotal-budgetAvailable, locale)}` : ""}
            </p>
          ) : <p>{copy.noMonthlyLimit}</p>}
        </div>
      ) : null}

      <div className="request-cart-review-heading">
        <div>
          <span>{copy.review}</span>
          <h2>{copy.cartItems}</h2>
          <p>{copy.adjust}</p>
        </div>

        <Link className="button button-secondary" href="/products">
          {copy.continueShopping}
        </Link>
      </div>

      {errors.products ? (
        <div
          className="request-section-error"
          id="products-error"
          role="alert"
        >
          <AlertCircle size={16} aria-hidden="true" />
          {errors.products}
        </div>
      ) : null}

      {errors.quantity ? (
        <div className="request-section-error" role="alert">
          <AlertCircle size={16} aria-hidden="true" />
          {errors.quantity}
        </div>
      ) : null}

      {selected.length ? (
        <div className="panel request-cart-panel">
          <div className="panel-body">
            <div className="request-cart-heading">
              <div>
                <span>{copy.cart}</span>
                <h2>{copy.selectedItems}</h2>
              </div>

              <strong>
                {selected.length}{" "}
                {selected.length === 1 ? copy.item : copy.items}
              </strong>
            </div>

            <div className="request-cart-lines">
              {selected.map((line) => {
                const product = productByRef.get(line.publicRef);

                if (!product) return null;

                return (
                  <article
                    key={line.publicRef}
                    className="request-cart-line"
                  >
                    <div className="request-cart-product">
                      <strong>{product.name}</strong>
                      <span>
                        {product.publicRef} · {product.category}
                      </span>
                      <small>
                        {formatCurrency(product.defaultSellPrice, locale)} {copy.per}{" "}
                        {product.unit}
                      </small>
                    </div>

                    <input
                      name="publicRef"
                      type="hidden"
                      value={product.publicRef}
                    />

                    <label className="request-cart-quantity">
                      {copy.quantity}
                      <input
                        name="quantity"
                        type="number"
                        min={1}
                        step={1}
                        value={line.quantity}
                        className={
                          errors.quantity
                            ? "request-input-error"
                            : undefined
                        }
                        aria-invalid={Boolean(errors.quantity)}
                        onChange={(event) =>
                          updateLine(product.publicRef, {
                            quantity: Number(event.target.value),
                          })
                        }
                      />
                    </label>

                    <label className="request-cart-specification">
                      {copy.specification}
                      <input
                        name="specification"
                        value={line.specification}
                        onChange={(event) =>
                          updateLine(product.publicRef, {
                            specification: event.target.value,
                          })
                        }
                        placeholder={copy.specificationPlaceholder}
                      />
                    </label>

                    <div className="request-cart-line-total">
                      <span>{copy.lineTotal}</span>
                      <strong>
                        {formatCurrency(
                          roundMoney(
                            line.quantity *
                              product.defaultSellPrice,
                          ), locale,
                        )}
                      </strong>

                      <button
                        type="button"
                        className="icon-button"
                        data-ux-silent="true"
                        aria-label={copy.remove(product.name)}
                        onClick={() => void removeProduct(product)}
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>

            <div className="request-payment-summary">
              <div>
                <span>{corePortalMessages(locale).pricing.subtotal}</span>
                <strong>{formatCurrency(subtotal, locale)}</strong>
              </div>

              <div>
                <span>{corePortalMessages(locale).pricing.delivery}</span>
                <strong>
                  {formatCurrency(estimatedDeliveryFee, locale)}
                </strong>
              </div>

              <div>
                <span>
                  {corePortalMessages(locale).pricing.tax}
                  {taxRate > 0 ? ` (${taxRate}%)` : ""}
                </span>
                <strong>{formatCurrency(taxAmount, locale)}</strong>
              </div>

              <div className="request-payment-total">
                <span>{copy.estimatedTotal}</span>
                <strong>{formatCurrency(estimatedTotal, locale)}</strong>
              </div>

              <p>{corePortalMessages(locale).pricing.note}</p>
            </div>
          </div>
        </div>
      ) : (
        <div className="empty-state">
          <ShoppingCart size={30} />
          <strong>{copy.empty}</strong>
          <p>{copy.emptyBody}</p>
        </div>
      )}

      <div className="form-actions request-submit-actions">
        <span>
          {copy.submitHelp}
        </span>

        {exceedsBudget ? (
          <button className="button button-secondary" type="button">
            {budgetCopy.keepInCart}
          </button>
        ) : null}
        <button
          className="button button-primary"
          type="submit"
          disabled={!selectedBudget || cartBusy}
        >
          {exceedsBudget ? budgetCopy.sendForApproval : copy.submit} ·{" "}
          {formatCurrency(estimatedTotal, locale)}
        </button>
      </div>
    </form>
  );
}
