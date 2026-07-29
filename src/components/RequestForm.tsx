"use client";

import { createRequestAction } from "@/app/(portal)/requests/actions";
import { useUxFeedback } from "@/components/UxFeedbackProvider";
import type { SessionUser } from "@/lib/auth";
import { formatCurrency, roundMoney } from "@/lib/domain";
import type { Branch, Company, Product } from "@/lib/types";
import {
  AlertCircle,
  CalendarDays,
  Check,
  Search,
  ShoppingCart,
  Trash2,
} from "lucide-react";
import {
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { ProductImage } from "./ProductImage";

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
  | "quantity";

type FormErrors = Partial<Record<RequestField, string>>;

function minimumWholeQuantity(product: Product) {
  return Math.max(Math.ceil(product.minimumOrderQuantity), 1);
}

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
  products,
  initialProductId,
}: {
  actor: SessionUser;
  companies: Company[];
  branches: Branch[];
  products: Product[];
  initialProductId?: string;
}) {
  const company =
    companies.find((item) => item.id === actor.companyId) ?? companies[0];

  const activeProducts = useMemo(
    () => products.filter((item) => item.status === "Active"),
    [products],
  );

  const initialProduct = activeProducts.find(
    (item) => item.id === initialProductId,
  );

  const today = localDateValue();
  const { notify } = useUxFeedback();

  const [selected, setSelected] = useState<SelectedLine[]>(
    initialProduct
      ? [
          {
            productId: initialProduct.id,
            quantity: minimumWholeQuantity(initialProduct),
            specification: "",
          },
        ]
      : [],
  );

  const [query, setQuery] = useState("");
  const [branchId, setBranchId] = useState(actor.branchId ?? "");
  const [department, setDepartment] = useState("");
  const [neededByDate, setNeededByDate] = useState(today);
  const [errors, setErrors] = useState<FormErrors>({});

  const formRef = useRef<HTMLFormElement | null>(null);
  const branchRef = useRef<HTMLSelectElement | null>(null);
  const departmentRef = useRef<HTMLInputElement | null>(null);
  const dateRef = useRef<HTMLInputElement | null>(null);
  const productsRef = useRef<HTMLDivElement | null>(null);

  const availableBranches = branches.filter(
    (item) =>
      item.status === "Active" && item.companyId === company?.id,
  );

  const visibleProducts = activeProducts.filter((product) => {
    const term = query.trim().toLowerCase();

    if (!term) return true;

    return [
      product.name,
      product.code,
      product.category,
      product.subcategory,
      product.brand,
    ].some((value) => value?.toLowerCase().includes(term));
  });

  const selectedBranch = availableBranches.find(
    (item) => item.id === branchId,
  );

  const estimatedTotal = selected.reduce((total, line) => {
    const product = activeProducts.find(
      (item) => item.id === line.productId,
    );

    return (
      total +
      roundMoney(
        line.quantity * (product?.defaultSellPrice ?? 0),
      )
    );
  }, 0);

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
          quantity: minimumWholeQuantity(product),
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
        "Select the branch that will receive these items.";
    }

    if (!department.trim()) {
      nextErrors.department =
        "Enter the department that needs these items.";
    }

    if (!neededByDate) {
      nextErrors.neededByDate =
        "Choose when the items are needed.";
    } else if (neededByDate < today) {
      nextErrors.neededByDate =
        "Choose today or a future date. Past dates are not allowed.";
    }

    if (!selected.length) {
      nextErrors.products =
        "Add at least one product before submitting the request.";
    }

    const invalidQuantity = selected.find((line) => {
      const product = activeProducts.find(
        (item) => item.id === line.productId,
      );

      if (!product) return true;

      return (
        !Number.isInteger(line.quantity) ||
        line.quantity < minimumWholeQuantity(product)
      );
    });

    if (invalidQuantity) {
      nextErrors.quantity =
        "Enter a valid whole-number quantity that meets the product minimum.";
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
      data-feedback-label="Submitting purchase request…"
    >
      <input
        name="companyId"
        type="hidden"
        value={company?.id ?? ""}
      />

      <div
        className="request-summary"
        style={{ marginBottom: 20 }}
      >
        <div className="summary-box">
          <span>Company</span>
          <strong>{company?.name ?? "Assigned company"}</strong>
        </div>

        <div className="summary-box">
          <span>Requester</span>
          <strong>{actor.name}</strong>
          <small>{actor.email}</small>
        </div>

        <div className="summary-box">
          <span>Selected items</span>
          <strong>{selected.length}</strong>
        </div>

        <div className="summary-box">
          <span>Estimated total</span>
          <strong>{formatCurrency(estimatedTotal)}</strong>
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
            <strong>Complete the highlighted fields</strong>
            <p>
              Review the messages below, correct the information,
              then submit again.
            </p>

            <ul>
              {Object.values(errors).map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}

      <div className="form-grid">
        <label>
          Branch
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
              Select branch
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
              The selected branch determines budget and approval.
            </span>
          )}
        </label>

        <label>
          Request type
          <select name="requestType" defaultValue="Standard">
            <option>Standard</option>
            <option>Ad-hoc</option>
            <option>Recurring</option>
          </select>
        </label>

        <label>
          Department
          <input
            ref={departmentRef}
            name="department"
            value={department}
            placeholder="Administration"
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
          Needed by
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
            aria-label="Quick date choices"
          >
            <button
              type="button"
              data-ux-silent="true"
              onClick={() => chooseDate(0)}
            >
              Today
            </button>

            <button
              type="button"
              data-ux-silent="true"
              onClick={() => chooseDate(7)}
            >
              In 7 days
            </button>

            <button
              type="button"
              data-ux-silent="true"
              onClick={() => chooseDate(30)}
            >
              In 30 days
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
              Past dates cannot be selected.
            </span>
          )}
        </label>

        <label>
          Priority
          <select name="urgency" defaultValue="Normal">
            <option>Low</option>
            <option>Normal</option>
            <option>High</option>
            <option>Urgent</option>
          </select>
        </label>

        <label className="field-full">
          Business justification / notes
          <textarea
            name="notes"
            placeholder="Explain why these items are needed"
          />
        </label>
      </div>

      {selectedBranch ? (
        <div className="callout" style={{ marginTop: 16 }}>
          <strong>{selectedBranch.name} budget</strong>
          <p>
            {selectedBranch.monthlyBudget == null
              ? "No monthly limit is configured. The branch approver will still review this request."
              : `${formatCurrency(
                  selectedBranch.remainingAmount ?? 0,
                )} available from ${formatCurrency(
                  selectedBranch.monthlyBudget,
                )} this month. Approval commits the request amount.`}
          </p>
        </div>
      ) : null}

      <div className="panel-header" style={{ marginTop: 24 }}>
        <div>
          <h2>Choose products</h2>
          <p>
            Search the Axora catalog, then add one or more items.
          </p>
        </div>

        <div className="toolbar-group">
          <Search aria-hidden="true" size={17} />

          <input
            aria-label="Search catalog"
            className="search-input"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search product or category"
          />
        </div>
      </div>

      <div
        ref={productsRef}
        tabIndex={-1}
        className={
          errors.products
            ? "metric-grid request-product-error"
            : "metric-grid"
        }
        aria-describedby={
          errors.products ? "products-error" : undefined
        }
      >
        {visibleProducts.map((product) => {
          const line = selected.find(
            (item) => item.productId === product.id,
          );

          return (
            <article
              className="panel"
              key={product.id}
              style={{ overflow: "hidden" }}
            >
              <ProductImage product={product} />

              <div className="panel-body">
                <h3 style={{ marginBottom: 4 }}>
                  {product.name}
                </h3>

                <p className="subtle">
                  {product.code} ·{" "}
                  {formatCurrency(product.defaultSellPrice)} /{" "}
                  {product.unit}
                </p>

                <button
                  className={
                    line
                      ? "button button-primary"
                      : "button button-secondary"
                  }
                  type="button"
                  data-ux-silent="true"
                  onClick={() => toggleProduct(product)}
                  style={{
                    width: "100%",
                    justifyContent: "center",
                  }}
                >
                  {line ? (
                    <>
                      <Check size={16} /> Added
                    </>
                  ) : (
                    <>
                      <ShoppingCart size={16} /> Add to request
                    </>
                  )}
                </button>

                {line ? (
                  <div
                    className="form-grid"
                    style={{ marginTop: 12 }}
                  >
                    <input
                      name="productId"
                      type="hidden"
                      value={product.id}
                    />

                    <label>
                      Quantity
                      <input
                        name="quantity"
                        type="number"
                        min={minimumWholeQuantity(product)}
                        step="1"
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

                    <label>
                      Specification
                      <input
                        name="specification"
                        value={line.specification}
                        onChange={(event) =>
                          updateLine(product.id, {
                            specification: event.target.value,
                          })
                        }
                        placeholder="Optional size / detail"
                      />
                    </label>
                  </div>
                ) : null}
              </div>
            </article>
          );
        })}
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
        <div className="panel" style={{ marginTop: 20 }}>
          <div className="panel-body">
            <h2>Request summary</h2>

            {selected.map((line) => {
              const product = activeProducts.find(
                (item) => item.id === line.productId,
              );

              if (!product) return null;

              return (
                <div
                  key={line.productId}
                  className="toolbar"
                  style={{
                    borderBottom:
                      "1px solid var(--slate-100)",
                  }}
                >
                  <span>
                    <strong>{product.name}</strong>
                    <br />
                    <small>
                      {line.quantity} ×{" "}
                      {formatCurrency(product.defaultSellPrice)}
                    </small>
                  </span>

                  <span>
                    <strong>
                      {formatCurrency(
                        roundMoney(
                          line.quantity *
                            product.defaultSellPrice,
                        ),
                      )}
                    </strong>

                    <button
                      type="button"
                      className="icon-button"
                      data-ux-silent="true"
                      aria-label={`Remove ${product.name}`}
                      onClick={() => toggleProduct(product)}
                    >
                      <Trash2 size={16} />
                    </button>
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="empty-state">
          <ShoppingCart size={30} />
          <strong>No products selected</strong>
          <p>Add at least one catalog item.</p>
        </div>
      )}

      <div className="form-actions request-submit-actions">
        <span>
          Submit when the request details are complete. Axora will
          explain anything that still needs attention.
        </span>

        <button
          className="button button-primary"
          type="submit"
        >
          Submit for company approval ·{" "}
          {formatCurrency(estimatedTotal)}
        </button>
      </div>
    </form>
  );
}
