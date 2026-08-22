import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { ProductActionForm } from "@/components/ProductActionForm";
import { requirePagePermission } from "@/lib/auth";
import { corePortalMessages } from "@/lib/core-portal-i18n";
import { PRODUCT_CATEGORIES, PRODUCT_UNITS } from "@/lib/product-options";
import { procurementRulesMessages } from "@/lib/procurement-rules-i18n";
import { createProductAction } from "../../masters/actions";

export default async function NewProductPage() {
  const actor = await requirePagePermission("manage_catalog");
  const locale = actor.preferredLocale ?? "en";
  const copy = corePortalMessages(locale).products;
  const rules = procurementRulesMessages(locale);
  return <>
    <PageHeader eyebrow={copy.operationsEyebrow} title={copy.createTitle} description={copy.createBody} />
    <ProductActionForm action={createProductAction} submitLabel={copy.create} draftId="create-product">
      <div className="form-grid">
        <label className="field-full">{copy.name}<input name="name" required /></label>
        <label>{copy.category}<select name="category">{PRODUCT_CATEGORIES.map((category) => <option key={category}>{category}</option>)}</select></label>
        <label>{copy.subcategory}<input name="subcategory" required /></label>
        <label>{copy.brand}<input name="brand" /></label><label>{copy.size}<input name="size" /></label>
        <label>{copy.unit}<select name="unit">{PRODUCT_UNITS.map((unit) => <option key={unit}>{unit}</option>)}</select></label>
        <label>{copy.buyCost}<input name="defaultBuyPrice" type="number" min="0" step="0.01" required /></label>
        <label>{rules.calculatedSellingPrice}<output>{rules.automaticMarkup}</output><small>{rules.calculatedSellingHelp}</small></label>
        <label>{copy.deliverySla}<input name="deliverySlaDays" type="number" min="0" defaultValue="1" /></label>
        <label className="field-full">{copy.description}<textarea name="description" /></label>
        <label className="field-full">{copy.images}<input name="images" type="file" accept="image/jpeg,image/png,image/webp" multiple /><small>{copy.imagesHelp}</small></label>
        <label className="field-full">{copy.altText}<input name="imageAltText" placeholder={copy.altPlaceholder} maxLength={200} /><small>{copy.altHelp}</small></label>
      </div>
      <Link className="button button-secondary" href="/products">Back</Link>
    </ProductActionForm>
  </>;
}
