import { formatCurrency } from "@/lib/domain";

export function RequestPricingSummary({
  subtotal,
  estimatedDeliveryFee,
  taxRate,
  taxAmount,
  estimatedTotal,
  totalLabel = "Estimated total",
}: {
  subtotal: number;
  estimatedDeliveryFee: number;
  taxRate: number;
  taxAmount: number;
  estimatedTotal: number;
  totalLabel?: string;
}) {
  return (
    <div
      className="request-payment-summary"
      aria-label="Request pricing breakdown"
    >
      <div>
        <span>Subtotal</span>
        <strong>{formatCurrency(subtotal)}</strong>
      </div>

      <div>
        <span>Estimated delivery fee</span>
        <strong>{formatCurrency(estimatedDeliveryFee)}</strong>
      </div>

      <div>
        <span>
          Tax / SST
          {taxRate > 0 ? ` (${taxRate}%)` : ""}
        </span>
        <strong>{formatCurrency(taxAmount)}</strong>
      </div>

      <div className="request-payment-total">
        <span>{totalLabel}</span>
        <strong>{formatCurrency(estimatedTotal)}</strong>
      </div>

      <p>
        Delivery remains an estimate until Axora completes sourcing
        and confirms the final charge.
      </p>
    </div>
  );
}
