import { formatCurrency } from "@/lib/domain";
import { corePortalMessages } from "@/lib/core-portal-i18n";
import type { SupportedLocale } from "@/lib/i18n";

export function RequestPricingSummary({
  subtotal,
  estimatedDeliveryFee,
  taxRate,
  taxAmount,
  estimatedTotal,
  totalLabel = "Estimated total",
  locale = "en",
}: {
  subtotal: number;
  estimatedDeliveryFee: number;
  taxRate: number;
  taxAmount: number;
  estimatedTotal: number;
  totalLabel?: string;
  locale?: SupportedLocale;
}) {
  const copy = corePortalMessages(locale).pricing;
  return (
    <div
      className="request-payment-summary"
      aria-label={copy.aria}
    >
      <div>
        <span>{copy.subtotal}</span>
        <strong>{formatCurrency(subtotal, locale)}</strong>
      </div>

      <div>
        <span>{copy.delivery}</span>
        <strong>{formatCurrency(estimatedDeliveryFee, locale)}</strong>
      </div>

      <div>
        <span>
          {copy.tax}
          {taxRate > 0 ? ` (${taxRate}%)` : ""}
        </span>
        <strong>{formatCurrency(taxAmount, locale)}</strong>
      </div>

      <div className="request-payment-total">
        <span>{totalLabel}</span>
        <strong>{formatCurrency(estimatedTotal, locale)}</strong>
      </div>

      <p>
        {copy.note}
      </p>
    </div>
  );
}
