"use client";

import type { RequestBudgetChoice } from "@/lib/budget-ledger";

import { createRequestAction } from "@/app/(portal)/requests/actions";
import { useUxFeedback } from "@/components/UxFeedbackProvider";
import {
  readRequestCart,
  writeRequestCart,
  type RequestCartItem,
} from "@/lib/request-cart";
import type { SessionUser } from "@/lib/auth";
import { formatCurrency, roundMoney } from "@/lib/domain";
import type { SupportedLocale } from "@/lib/i18n";
import { corePortalMessages, localizedStatus } from "@/lib/core-portal-i18n";
import { budgetApprovalMessages } from "@/lib/budget-approval-i18n";
import type { Branch, Company, Product } from "@/lib/types";
import { readRequestDraft } from "@/lib/request-draft";
import {
  AlertCircle,
  CalendarDays,
  ShoppingCart,
  Trash2,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import Link from "next/link";
import {
  productPriceChanged,
} from "@/lib/procurement-rules";
import { procurementRulesMessages } from "@/lib/procurement-rules-i18n";

interface SelectedLine {
  productId: string;
  quantity: number;
  specification: string;
}

type RequestField =
  | "branch"
  | "department"
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
  locale = "en",
}: {
  actor: SessionUser;
  companies: Company[];
  branches: Branch[];
  budgetAccounts?: RequestBudgetChoice[];
  initialProduct?: Product;
  locale?: SupportedLocale;
}) {
  const company =
    companies.find((item) => item.id === actor.companyId) ?? companies[0];

  const today = localDateValue();
  const { notify } = useUxFeedback();
  const copy = corePortalMessages(locale).requestForm;
  const ruleCopy = procurementRulesMessages(locale);
  const draftCompanyId = actor.companyId ?? companies[0]?.id;
  const draftScope = useMemo(() => (
    draftCompanyId
      ? { userId: actor.id, companyId: draftCompanyId }
      : { userId: actor.id }
  ), [actor.id, draftCompanyId]);
  const draftState = useMemo(() => {
    if (typeof window === "undefined") return null;
    return readRequestDraft(draftScope);
  }, [draftScope]);

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

  const [knownProducts, setKnownProducts] = useState<Product[]>(
    initialProduct ? [initialProduct] : [],
  );

  const productById = useMemo(
    () =>
      new Map(
        knownProducts.map((product) => [product.id, product]),
      ),
    [knownProducts],
  );

  const [selected, setSelected] = useState<SelectedLine[]>(
    initialProduct
      ? [
          {
            productId: initialProduct.id,
            quantity: 1,
            specification: "",
          },
        ]
      : [],
  );
  const [cartHydrated, setCartHydrated] = useState(false);
  const [branchId, setBranchId] = useState(() => resolveDraftBranch(
    draftState?.branchId,
  ));
  const [department, setDepartment] = useState(draftState?.department ?? "");
  const [neededByDate, setNeededByDate] = useState(() => {
    if (draftState?.neededByDate && draftState.neededByDate >= today) {
      return draftState.neededByDate;
    }
    return today;
  });
  const [errors, setErrors] = useState<FormErrors>({});
  const [priceChanges, setPriceChanges] = useState<string[]>([]);
  const [pricesAcknowledged, setPricesAcknowledged] = useState(false);

  const formRef = useRef<HTMLFormElement | null>(null);
  const branchRef = useRef<HTMLSelectElement | null>(null);
  const departmentRef = useRef<HTMLInputElement | null>(null);
  const dateRef = useRef<HTMLInputElement | null>(null);
  const productsRef = useRef<HTMLDivElement | null>(null);

  const selectedBranch = availableBranches.find(
    (item) => item.id === branchId,
  );

  const subtotal = selected.reduce((total, line) => {
    const product = productById.get(line.productId);

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

  useEffect(() => {
    const controller = new AbortController();

    const timer = window.setTimeout(async () => {
      const cart = readRequestCart();
      const cartById = new Map(
        cart.map((item) => [item.product.id, item]),
      );

      const productIds = [
        ...new Set([
          ...cart.map((item) => item.product.id),
          ...(initialProduct ? [initialProduct.id] : []),
        ]),
      ];

      if (!productIds.length) {
        setKnownProducts([]);
        setSelected([]);
        setCartHydrated(true);
        return;
      }

      try {
        const response = await fetch("/api/catalog/cart", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ productIds }),
          signal: controller.signal,
        });

        const payload = await response.json() as {
          products?: Product[];
          error?: string;
        };

        if (!response.ok) {
          throw new Error(
            payload.error ?? "Unable to refresh the request cart.",
          );
        }

        const products = Array.isArray(payload.products)
          ? payload.products
          : [];

        const authoritativeById = new Map(
          products.map((product) => [product.id, product]),
        );

        const changedPrices = products
          .filter((product) => {
            const saved = cartById.get(product.id);
            return Boolean(saved && productPriceChanged(saved.product, product));
          })
          .map((product) => product.name);

        const lines = productIds.flatMap((productId) => {
          const product = authoritativeById.get(productId);
          if (!product) return [];

          const saved = cartById.get(productId);

          return [{
            productId,
            quantity: Math.max(Math.ceil(saved?.quantity ?? 1), 1),
            specification: saved?.specification ?? "",
          }];
        });

        setKnownProducts(products);
        setSelected(lines);
        setPriceChanges(changedPrices);
        setPricesAcknowledged(changedPrices.length === 0);
        setCartHydrated(true);

        const removedCount = productIds.length - products.length;

        if (removedCount > 0) {
          notify(
            `${removedCount} unavailable cart item${
              removedCount === 1 ? " was" : "s were"
            } removed.`,
            "error",
          );
        }
      } catch (error) {
        if (controller.signal.aborted) return;

        const fallbackProducts = initialProduct
          ? [initialProduct]
          : [];

        setKnownProducts(fallbackProducts);
        setSelected(
          initialProduct
            ? [{
                productId: initialProduct.id,
                quantity: 1,
                specification: "",
              }]
            : [],
        );
        setCartHydrated(true);

        notify(
          error instanceof Error
            ? error.message
            : "Unable to refresh the request cart.",
          "error",
        );
      }
    }, 0);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [initialProduct, notify]);

  useEffect(() => {
    if (!cartHydrated) return;

    const items = selected
      .map<RequestCartItem | null>((line) => {
        const product = productById.get(line.productId);
        if (!product) return null;

        return {
          product: {
            id: product.id,
            code: product.code,
            name: product.name,
            category: product.category,
            subcategory: product.subcategory,
            brand: product.brand,
            size: product.size,
            unit: product.unit,
            defaultSellPrice: product.defaultSellPrice,
            priceRuleVersion: product.priceRuleVersion,
            priceEffectiveFrom: product.priceEffectiveFrom,
            priceChangedAt: product.priceChangedAt,
            priceCurrency: product.priceCurrency,
            deliverySlaDays: product.deliverySlaDays,
            hasImage: product.hasImage,
            imageAltText: product.imageAltText,
          },
          quantity: line.quantity,
          specification: line.specification,
        };
      })
      .filter((item): item is RequestCartItem => item !== null);

    writeRequestCart(items);
  }, [cartHydrated, productById, selected]);

  function clearError(field: RequestField) {
    setErrors((current) => {
      if (!current[field]) return current;

      const next = { ...current };
      delete next[field];
      return next;
    });
  }

  function toggleProduct(product: Product) {
    clearError("products");

    setKnownProducts((current) =>
      current.some((item) => item.id === product.id)
        ? current
        : [...current, product],
    );

    setSelected((current) => {
      const alreadySelected = current.some(
        (item) => item.productId === product.id,
      );

      if (alreadySelected) {
        return current.filter(
          (item) => item.productId !== product.id,
        );
      }

      return [
        ...current,
        {
          productId: product.id,
          quantity: 1,
          specification: "",
        },
      ];
    });
  }

  function updateLine(
    productId: string,
    patch: Partial<SelectedLine>,
  ) {
    clearError("quantity");

    setSelected((current) =>
      current.map((item) =>
        item.productId === productId
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
      if (field === "department") target = departmentRef.current;
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

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    const nextErrors: FormErrors = {};

    if (!branchId) {
      nextErrors.branch =
        locale === "ar" ? "اختر الفرع الذي سيستلم هذه البنود." : locale === "ms" ? "Pilih cawangan yang akan menerima item ini." : "Select the branch that will receive these items.";
    }

    if (!department.trim()) {
      nextErrors.department =
        locale === "ar" ? "أدخل القسم الذي يحتاج إلى هذه البنود." : locale === "ms" ? "Masukkan jabatan yang memerlukan item ini." : "Enter the department that needs these items.";
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
      const product = productById.get(line.productId);

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
                setPricesAcknowledged(event.target.checked);
                if (event.target.checked) clearError("price");
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
            name="branchId"
            value={branchId}
            className={
              errors.branch ? "request-input-error" : undefined
            }
            aria-invalid={Boolean(errors.branch)}
            aria-describedby={
              errors.branch ? "branch-error" : undefined
            }
            onChange={(event) => {
              setBranchId(event.target.value);
              clearError("branch");
            }}
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
          {copy.requestType}
          <select name="requestType" defaultValue="Standard">
            <option value="Standard">{copy.standard}</option>
            <option value="Ad-hoc">{copy.adHoc}</option>
            <option value="Recurring">{copy.recurring}</option>
          </select>
        </label>

        <label>
          {copy.department}
          <input
            ref={departmentRef}
            name="department"
            value={department}
            placeholder={copy.departmentPlaceholder}
            className={
              errors.department
                ? "request-input-error"
                : undefined
            }
            aria-invalid={Boolean(errors.department)}
            aria-describedby={
              errors.department
                ? "department-error"
                : undefined
            }
            onChange={(event) => {
              setDepartment(event.target.value);
              clearError("department");
            }}
          />

          {errors.department ? (
            <span
              className="request-field-error-message"
              id="department-error"
            >
              <AlertCircle size={14} aria-hidden="true" />
              {errors.department}
            </span>
          ) : null}
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
          <select name="urgency" defaultValue="Normal">
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
                const product = productById.get(line.productId);

                if (!product) return null;

                return (
                  <article
                    key={line.productId}
                    className="request-cart-line"
                  >
                    <div className="request-cart-product">
                      <strong>{product.name}</strong>
                      <span>
                        {product.code} · {product.category}
                      </span>
                      <small>
                        {formatCurrency(product.defaultSellPrice, locale)} {copy.per}{" "}
                        {product.unit}
                      </small>
                    </div>

                    <input
                      name="productId"
                      type="hidden"
                      value={product.id}
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
                          updateLine(product.id, {
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
                          updateLine(product.id, {
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
                        onClick={() => toggleProduct(product)}
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
          disabled={!selectedBudget}
        >
          {exceedsBudget ? budgetCopy.sendForApproval : copy.submit} ·{" "}
          {formatCurrency(estimatedTotal, locale)}
        </button>
      </div>
    </form>
  );
}
