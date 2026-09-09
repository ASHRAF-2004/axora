import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { ProductActionForm } from "@/components/ProductActionForm";
import { requirePagePermission } from "@/lib/auth";
import { corePortalMessages } from "@/lib/core-portal-i18n";
import { PRODUCT_CATEGORIES, PRODUCT_UNITS } from "@/lib/product-options";
import { procurementRulesMessages } from "@/lib/procurement-rules-i18n";
import { catalogManagementAccessMessages } from "@/lib/product-editor-i18n";
import { createProductAction } from "../../masters/actions";
import { canManageCommercialCatalog } from "@/lib/permissions";

export default async function NewProductPage() {
  const actor = await requirePagePermission("manage_catalog");
  const locale = actor.preferredLocale ?? "en";
  const portalCopy = corePortalMessages(locale);
  const copy = portalCopy.products;
  const rules = procurementRulesMessages(locale);
  const accessCopy = catalogManagementAccessMessages(locale);
  const canManageCommercialPricing = canManageCommercialCatalog(actor);
  return <>
    <PageHeader eyebrow={copy.operationsEyebrow} title={copy.createTitle} description={copy.createBody} />
    <ProductActionForm action={createProductAction} submitLabel={canManageCommercialPricing ? copy.create : accessCopy.createDraft} draftId="create-product">
      <div className="form-grid">
        <label className="field-full">{copy.name}<input name="name" required /></label>
        <label>{copy.category}<select name="category">{PRODUCT_CATEGORIES.map((category) => <option key={category}>{category}</option>)}</select></label>
        <label>{copy.subcategory}<input name="subcategory" required /></label>
        <label>{copy.brand}<input name="brand" /></label><label>{copy.size}<input name="size" /></label>
        <label>{copy.unit}<select name="unit">{PRODUCT_UNITS.map((unit) => <option key={unit}>{unit}</option>)}</select></label>
        {canManageCommercialPricing ? <label>{copy.buyCost}<input name="defaultBuyPrice" type="number" min="0" step="0.01" required /></label> : null}
        <label>{rules.markup}<input name="customerMarkupPercentage" type="number" inputMode="decimal" min="0" max="100" step="0.01" defaultValue="10" required /><small>{rules.markupHelp}</small></label>
        <label>{rules.calculatedSellingPrice}<output>{rules.calculatedAfterSave}</output><small>{rules.calculatedSellingHelp}</small></label>
        {!canManageCommercialPricing ? <p className="callout callout-info field-full">{accessCopy.draftDescription}</p> : null}
        <label>{copy.deliverySla}<input name="deliverySlaDays" type="number" min="0" defaultValue="1" /></label>
        <label className="field-full">{copy.description}<textarea name="description" /></label>
        <label className="field-full">{copy.images}<input name="images" type="file" accept="image/jpeg,image/png,image/webp" multiple /><small>{copy.imagesHelp}</small></label>
        <label className="field-full">{copy.altText}<input name="imageAltText" placeholder={copy.altPlaceholder} maxLength={200} /><small>{copy.altHelp}</small></label>
      </div>
      <Link className="button button-secondary" href="/products">{portalCopy.common.back}</Link>
    </ProductActionForm>
  </>;
}
